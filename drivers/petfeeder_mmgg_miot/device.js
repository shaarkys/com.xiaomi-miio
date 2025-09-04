'use strict';

/**
 * Pet Feeder MIoT (Wi-Fi)
 * Target model: xiaomi.feeder.iv2001 (CN)
 *
 * Features:
 *  • Eaten food (today/total)
 *  • Food-out and Heap statuses
 *  • Status (mode) text
 *  • Desiccant level (%) + time (days) + low alarm
 *
 * Engineering notes:
 *  • No dependency on base boot sequence (we do not call bootSequence()).
 *  • Guarded, self-contained polling loop with clear diagnostic logs.
 *  • Defensive MIoT handling (code -4001 / undefined) — never throws.
 *  • Extended probe (optional) to discover working siid/piid at runtime.
 *  • Backwards compatible; adds capabilities if missing.
 */

const Homey = require('homey');
const DeviceBase = require('../wifi_device.js'); // your base Wi-Fi device class
const miio = require('miio');

// ───────────────────────────────────────────────────────────────────────────────
// Model mapping (restored) — preset selector with wildcard for mmgg.feeder.*
// ───────────────────────────────────────────────────────────────────────────────

const MODEL_TO_PRESET = {
    'mmgg.feeder.fi1': 'default',
    'mmgg.feeder.inland': 'default',
    'mmgg.feeder.spec': 'default',
    'xiaomi.feeder.pi2001': 'pi2001',
    'xiaomi.feeder.iv2001': 'iv2001'
};

function resolvePresetId(model) {
    if (MODEL_TO_PRESET[model]) return MODEL_TO_PRESET[model];
    if (typeof model === 'string' && model.startsWith('mmgg.feeder.')) return 'default';
    return 'iv2001'; // safe default for our implementation
}

// ───────────────────────────────────────────────────────────────────────────────
// MIoT defaults & probe candidates
// ───────────────────────────────────────────────────────────────────────────────

const BASE_GET_PROPS = [
    { did: 'error', siid: 2, piid: 1 },
    { did: 'foodlevel', siid: 2, piid: 6 }
];

const IV2001_DEFAULTS = {
    eaten_food_today: { siid: 2, piid: 22 }, // [Unverified]
    eaten_food_total: { siid: 2, piid: 23 }, // [Unverified]
    food_out_status: { siid: 2, piid: 24 }, // [Unverified]
    heap_status: { siid: 2, piid: 25 }, // [Unverified]
    status_mode: { siid: 2, piid: 26 }, // [Unverified]
    desiccant_level: { siid: 7, piid: 1 }, // [Unverified]
    desiccant_time: { siid: 7, piid: 2 } // [Unverified]
};

const PROBE_CANDIDATES = {
    eaten_food_today: [
        { siid: 2, piid: 22 },
        { siid: 2, piid: 23 }
    ],
    eaten_food_total: [
        { siid: 2, piid: 23 },
        { siid: 2, piid: 22 }
    ],
    food_out_status: Array.from({ length: 11 }, (_, i) => ({ siid: 2, piid: 20 + i })), // 2/20..2/30
    heap_status: Array.from({ length: 11 }, (_, i) => ({ siid: 2, piid: 20 + i })),
    status_mode: [{ siid: 2, piid: 4 }, { siid: 2, piid: 5 }, { siid: 2, piid: 9 }, { siid: 2, piid: 10 }, ...Array.from({ length: 11 }, (_, i) => ({ siid: 2, piid: 20 + i }))],
    desiccant_level: [
        { siid: 6, piid: 1 },
        { siid: 6, piid: 2 },
        { siid: 6, piid: 3 },
        { siid: 6, piid: 4 },
        { siid: 7, piid: 1 },
        { siid: 7, piid: 2 },
        { siid: 7, piid: 3 },
        { siid: 7, piid: 4 },
        { siid: 8, piid: 1 },
        { siid: 8, piid: 2 },
        { siid: 8, piid: 3 },
        { siid: 8, piid: 4 },
        { siid: 9, piid: 1 },
        { siid: 9, piid: 2 },
        { siid: 9, piid: 3 },
        { siid: 9, piid: 4 }
    ],
    desiccant_time: [
        { siid: 6, piid: 1 },
        { siid: 6, piid: 2 },
        { siid: 6, piid: 3 },
        { siid: 6, piid: 4 },
        { siid: 7, piid: 1 },
        { siid: 7, piid: 2 },
        { siid: 7, piid: 3 },
        { siid: 7, piid: 4 },
        { siid: 8, piid: 1 },
        { siid: 8, piid: 2 },
        { siid: 8, piid: 3 },
        { siid: 8, piid: 4 },
        { siid: 9, piid: 1 },
        { siid: 9, piid: 2 },
        { siid: 9, piid: 3 },
        { siid: 9, piid: 4 }
    ]
};

// Human-readable mode mapping (conservative)
const MODE_MAP = new Map([
    [0, 'unknown'],
    [1, 'idle'],
    [2, 'feeding'],
    [3, 'paused'],
    [4, 'fault']
]);

// ───────────────────────────────────────────────────────────────────────────────
// Small helpers
// ───────────────────────────────────────────────────────────────────────────────

function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

function daysFromHoursMaybe(v) {
    const n = toNumber(v);
    if (n === undefined) return undefined;
    return n > 1000 ? Math.round(n / 24) : Math.round(n);
}

// ───────────────────────────────────────────────────────────────────────────────
// Device class
// ───────────────────────────────────────────────────────────────────────────────

class PetFeederMiotDevice extends DeviceBase {
    // Local warn that never throws (SDK doesn’t expose this.warn())
    _warn(...args) {
        try {
            this.log('[WARN]', ...args);
        } catch (_) {}
    }

    async onInit() {
        try {
            this.log('[IV2001] onInit');

            // Resolve model→preset (kept for completeness; we operate fine on any feeder)
            const model = this.getStoreValue('model') || this.getData()?.model || 'xiaomi.feeder.iv2001';
            this._presetId = resolvePresetId(model);
            this.log('[IV2001] resolved preset =', this._presetId);

            // Ensure capabilities exist (upgrade-safe)
            await this._ensureCapabilities();

            // Settings defaults
            const s = this.getSettings() || {};
            const patch = {};
            if (typeof s.desiccant_alarm_threshold !== 'number') patch.desiccant_alarm_threshold = 20;
            if (typeof s.iv2001_extended_probe !== 'boolean') patch.iv2001_extended_probe = false;
            if (Object.keys(patch).length) {
                await this.setSettings(patch).catch((e) => this._warn('[SETTINGS] default patch failed:', e?.message));
            }

            // Flow triggers
            this._flow = {
                feederStatusChanged: this.homey.flow.getDeviceTriggerCard('feeder_status_changed'),
                eatenFoodChanged: this.homey.flow.getDeviceTriggerCard('eaten_food_changed'),
                desiccantLow: this.homey.flow.getDeviceTriggerCard('desiccant_low')
            };

            // State
            this._state = {
                once: new Set(),
                lastMode: 'unknown',
                lastTotalG: undefined,
                lastTodayG: undefined,
                desiccantAlarm: false,
                todayBaseline: { ymd: this._ymdNow(), totalAtMidnight: undefined }
            };

            // Read-only guard (prevents “Missing Capability Listener” warnings)
            if (this.hasCapability('petfeeder_foodlevel')) {
                this.registerCapabilityListener('petfeeder_foodlevel', async () => {
                    throw new Error('petfeeder_foodlevel is read-only');
                });
            }

            // Establish MIoT connection ourselves (we do not use bootSequence/pollDevice)
            // Do not await here to avoid blocking init on long probes/timeouts
            this._initMiio();

            // Start our own guarded poller.
            const pollSeconds = Math.max(5, Number(this.getSettings().polling) || 15);
            this._pollMs = pollSeconds * 1000;
            if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
            this._pollTimer = this.homey.setInterval(() => this._pollOnce(), this._pollMs);
            this.homey.setTimeout(() => this._pollOnce(), 1000);

            this.log('[IV2001] init complete, preset =', this._presetId);
        } catch (err) {
            this.error('[IV2001] onInit error:', err?.message || err);
        }
    }

    async onUninit() {
        try {
            if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
        } catch (_) {}
        if (super.onUninit) return super.onUninit();
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        try {
            if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
                if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
                await this._initMiio();
                const pollSeconds = Math.max(5, Number(newSettings.polling) || Number(this.getSettings().polling) || 15);
                this._pollMs = pollSeconds * 1000;
                this._pollTimer = this.homey.setInterval(() => this._pollOnce(), this._pollMs);
            }
        } catch (e) {
            this._warn('[IV2001] onSettings error:', e?.message);
        }
        return true;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Polling
    // ───────────────────────────────────────────────────────────────────────────

    async _pollOnce() {
        if (this._polling) return;
        this._polling = true;

        try {
            if (!this.miio) {
                // Connection not ready yet; do not try to "fix" here. Base will init miio.
                this._onceWarn('[IV2001] miio not ready; skipping this poll');
                return;
            }

            // Build default read set
            const req = [
                ...BASE_GET_PROPS,
                { did: 'eaten_food_today', siid: IV2001_DEFAULTS.eaten_food_today.siid, piid: IV2001_DEFAULTS.eaten_food_today.piid },
                { did: 'eaten_food_total', siid: IV2001_DEFAULTS.eaten_food_total.siid, piid: IV2001_DEFAULTS.eaten_food_total.piid },
                { did: 'food_out_status', siid: IV2001_DEFAULTS.food_out_status.siid, piid: IV2001_DEFAULTS.food_out_status.piid },
                { did: 'heap_status', siid: IV2001_DEFAULTS.heap_status.siid, piid: IV2001_DEFAULTS.heap_status.piid },
                { did: 'status_mode', siid: IV2001_DEFAULTS.status_mode.siid, piid: IV2001_DEFAULTS.status_mode.piid },
                { did: 'desiccant_level', siid: IV2001_DEFAULTS.desiccant_level.siid, piid: IV2001_DEFAULTS.desiccant_level.piid },
                { did: 'desiccant_time', siid: IV2001_DEFAULTS.desiccant_time.siid, piid: IV2001_DEFAULTS.desiccant_time.piid }
            ];

            this.log(`[IV2001] poll start (req=${req.length}, interval=${this._pollMs}ms)`);
            const res = await this._safeGetProps(req);
            const got = this._indexResults(req, res);

            // Short one-time debug of available default props
            if (!this._state.once.has('debug_dump_defaults')) {
                this._state.once.add('debug_dump_defaults');
                const summary = Object.entries(got)
                    .filter(([, r]) => r && r.code === 0)
                    .map(([k, r]) => `${k}@${r.siid}/${r.piid}=${JSON.stringify(r.value)}`);
                this.log('[DEBUG] available defaults:', summary.join(', ') || 'none');
            }

            // Optional probe to fill missing values only
            if (this.getSettings().iv2001_extended_probe === true) {
                const probeAdd = await this._probeMissing(got);
                Object.assign(got, probeAdd);
            }

            // Publish values
            await this._updateFaultAndFoodLevel(got);
            await this._updateEatenFood(got);
            await this._updateFoodOutAndHeap(got);
            await this._updateStatusMode(got);
            await this._updateDesiccant(got);

            this.log('[IV2001] poll done');
        } catch (e) {
            this._warn('[IV2001] poll error:', e?.message);
        } finally {
            this._polling = false;
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Update blocks
    // ───────────────────────────────────────────────────────────────────────────

    async _updateFaultAndFoodLevel(g) {
        const e = g.error,
            f = g.foodlevel;

        if (e && e.code === 0) {
            this.log('[FAULT] device code =', e.value);
        } else if (e && e.code === -4001) {
            this._onceWarn('[FAULT] unsupported (-4001)');
        }

        if (this.hasCapability('petfeeder_foodlevel')) {
            if (f && f.code === 0 && typeof f.value !== 'undefined') {
                await this._setCap('petfeeder_foodlevel', f.value);
            } else if (f && f.code === -4001) {
                this._onceWarn('[FOODLEVEL] unsupported (-4001)');
            }
        }
    }

    async _updateEatenFood(g) {
        const today = g.eaten_food_today;
        const total = g.eaten_food_total;

        let todayG, totalG;

        if (total && total.code === 0) totalG = toNumber(total.value);
        else if (total && total.code === -4001) this._onceWarn('[EATEN] total unsupported (-4001)');

        if (today && today.code === 0) todayG = toNumber(today.value);
        else if (today && today.code === -4001) this._onceWarn('[EATEN] today unsupported (-4001)');

        // Derive "today" from total delta when needed
        if (todayG === undefined && typeof totalG === 'number') {
            const ymd = this._ymdNow();
            if (this._state.todayBaseline.ymd !== ymd) {
                this._state.todayBaseline.ymd = ymd;
                this._state.todayBaseline.totalAtMidnight = totalG;
                this.log('[EATEN] baseline set totalAtMidnight =', totalG);
            }
            if (typeof this._state.todayBaseline.totalAtMidnight === 'number') {
                todayG = Math.max(0, Math.round(totalG - this._state.todayBaseline.totalAtMidnight));
            }
        }

        if (this.hasCapability('petfeeder_eaten_food_total') && typeof totalG === 'number') {
            const prevT = this._state.lastTotalG;
            await this._setCap('petfeeder_eaten_food_total', totalG);
            this._state.lastTotalG = totalG;
            if (typeof prevT === 'number' && prevT !== totalG) {
                const delta = totalG - prevT;
                await this._triggerEatenChanged(todayG, totalG, delta);
            }
        }

        if (this.hasCapability('petfeeder_eaten_food_today') && typeof todayG === 'number') {
            const prev = this._state.lastTodayG;
            await this._setCap('petfeeder_eaten_food_today', todayG);
            this._state.lastTodayG = todayG;
            if (typeof prev === 'number' && prev !== todayG && typeof this._state.lastTotalG !== 'number') {
                await this._triggerEatenChanged(todayG, this._state.lastTotalG, todayG - prev);
            }
        }
    }

    async _updateFoodOutAndHeap(g) {
        const mapFlag = (raw, which) => {
            const v = toNumber(raw);
            if (v === 0) return 'ok';
            if (v === 1) return which === 'food' ? 'food_out' : 'heap_detected';
            this._warn(`[${which === 'food' ? 'FOODOUT' : 'HEAP'}] unexpected value:`, raw);
            return 'ok';
        };

        const out = g.food_out_status;
        if (this.hasCapability('petfeeder_food_out_status')) {
            if (out && out.code === 0) await this._setCap('petfeeder_food_out_status', mapFlag(out.value, 'food'));
            else if (out && out.code === -4001) this._onceWarn('[FOODOUT] unsupported (-4001)');
        }

        const heap = g.heap_status;
        if (this.hasCapability('petfeeder_heap_status')) {
            if (heap && heap.code === 0) await this._setCap('petfeeder_heap_status', mapFlag(heap.value, 'heap'));
            else if (heap && heap.code === -4001) this._onceWarn('[HEAP] unsupported (-4001)');
        }
    }

    async _updateStatusMode(g) {
        const m = g.status_mode;
        if (!this.hasCapability('petfeeder_status_mode')) return;

        if (m && m.code === 0) {
            const text = MODE_MAP.get(toNumber(m.value)) || 'unknown';
            const prev = this._state.lastMode;
            await this._setCap('petfeeder_status_mode', text);
            if (text !== prev) {
                await this._flow.feederStatusChanged?.trigger(this, { new_status: text, previous_status: prev || 'unknown' }, {});
                this.log('[MODE] change:', prev, '→', text);
                this._state.lastMode = text;
            }
        } else if (m && m.code === -4001) {
            this._onceWarn('[MODE] unsupported (-4001)');
        }
    }

    async _updateDesiccant(g) {
        const lvl = g.desiccant_level;
        const tim = g.desiccant_time;

        let pct, days;
        if (lvl && lvl.code === 0) pct = Math.max(0, Math.min(100, Math.round(toNumber(lvl.value))));
        else if (lvl && lvl.code === -4001) this._onceWarn('[DESICCANT] level unsupported (-4001)');

        if (tim && tim.code === 0) days = daysFromHoursMaybe(tim.value);
        else if (tim && tim.code === -4001) this._onceWarn('[DESICCANT] time unsupported (-4001)');

        if (typeof pct === 'number' && this.hasCapability('measure_desiccant')) {
            await this._setCap('measure_desiccant', pct);
        }
        if (typeof days === 'number' && this.hasCapability('measure_desiccant_time')) {
            await this._setCap('measure_desiccant_time', days);
        }

        if (this.hasCapability('alarm_desiccant_low') && typeof pct === 'number') {
            const thr = Number(this.getSettings().desiccant_alarm_threshold) || 20;
            const alarm = pct < thr;
            if (alarm !== this._state.desiccantAlarm) {
                await this._setCap('alarm_desiccant_low', alarm);
                this._state.desiccantAlarm = alarm;
                if (alarm) {
                    await this._flow.desiccantLow?.trigger(this, { level_percent: pct }, {});
                    this.log('[DESICCANT] alarm ON at', pct, '% (<', thr, ')');
                } else {
                    this.log('[DESICCANT] alarm OFF at', pct, '% (>=', thr, ')');
                }
            }
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Probe (fills only missing values)
    // ───────────────────────────────────────────────────────────────────────────

    async _probeMissing(current) {
        const req = [];
        const add = (label, arr) => {
            const have = current[label];
            const missing = !have || have.code !== 0 || typeof have.value === 'undefined';
            if (!missing) return;
            for (const cand of arr) {
                req.push({ did: `probe_${label}_${cand.siid}_${cand.piid}`, siid: cand.siid, piid: cand.piid });
            }
        };

        add('eaten_food_today', PROBE_CANDIDATES.eaten_food_today);
        add('eaten_food_total', PROBE_CANDIDATES.eaten_food_total);
        add('food_out_status', PROBE_CANDIDATES.food_out_status);
        add('heap_status', PROBE_CANDIDATES.heap_status);
        add('status_mode', PROBE_CANDIDATES.status_mode);
        add('desiccant_level', PROBE_CANDIDATES.desiccant_level);
        add('desiccant_time', PROBE_CANDIDATES.desiccant_time);

        if (!req.length) return {};

        this.log('[PROBE] sweep start, candidates =', req.length);
        const res = await this._safeGetProps(req);

        const out = {};
        for (let i = 0; i < res.length; i++) {
            const r = res[i] || {};
            const q = req[i];
            if (r.code !== 0 || typeof r.value === 'undefined') continue;
            const m = /^probe_([^_]+)_(\d+)_(\d+)$/.exec(q.did);
            if (!m) continue;
            const label = m[1];

            if (!out[label]) {
                out[label] = { code: 0, value: r.value, siid: q.siid, piid: q.piid };
                this.log(`[PROBE] hit ${label}: siid=${q.siid} piid=${q.piid} value=${JSON.stringify(r.value)}`);
            }
        }
        if (!Object.keys(out).length) this.log('[PROBE] no hits');
        return out;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // MIoT helpers & capability setters
    // ───────────────────────────────────────────────────────────────────────────

    async _initMiio() {
        try {
            // Dispose any previous instance
            try {
                this.miio?.destroy();
            } catch (_) {}

            const address = this.getSetting('address');
            const token = this.getSetting('token');
            if (!address || !token) {
                this._onceWarn('[IV2001] missing address/token settings');
                return;
            }

            this.miio = await miio.device({ address, token });
            if (!this.getAvailable()) {
                await this.setAvailable().catch(() => {});
            }
            this.log('[IV2001] miio ready');

            // One-time extended probe dump on connect if enabled (run in background)
            if (this.getSettings().iv2001_extended_probe === true) {
                this.homey.setTimeout(() => {
                    this._runInitialProbe().catch((e) => this._warn('[PROBE] summary error:', e?.message));
                }, 0);
            }
        } catch (error) {
            this._warn('[IV2001] miio init failed:', error?.message);
            // Retry later
            this.homey.setTimeout(() => this._initMiio(), 10000);
        }
    }

    async _runInitialProbe() {
        const add = await this._probeMissing({});
        const hits = Object.entries(add).map(([label, r]) => `${label}@${r.siid}/${r.piid}=${JSON.stringify(r.value)}`);
        this.log('[PROBE] summary:', hits.join(', ') || 'no hits');
    }

    async _safeGetProps(requestArray) {
        try {
            if (!Array.isArray(requestArray) || requestArray.length === 0) return [];

            // Use small batches to avoid timeouts or rate limits
            const CHUNK_SIZE = 14;
            const results = [];
            for (let i = 0; i < requestArray.length; i += CHUNK_SIZE) {
                const batch = requestArray.slice(i, i + CHUNK_SIZE);
                try {
                    const res = await this.miio.call('get_properties', batch, { retries: 1 });
                    if (Array.isArray(res)) {
                        results.push(...res);
                        const missing = batch.length - res.length;
                        for (let k = 0; k < missing; k++) results.push({});
                    } else {
                        for (let k = 0; k < batch.length; k++) results.push({});
                    }
                } catch (e) {
                    this._warn('[MIOT] get_properties error (chunk):', e?.message);
                    for (let k = 0; k < batch.length; k++) results.push({});
                }
            }
            return results;
        } catch (e) {
            this._warn('[MIOT] get_properties error:', e?.message);
            return [];
        }
    }

    _indexResults(reqList, respList) {
        const out = {};
        for (let i = 0; i < reqList.length; i++) {
            const req = reqList[i];
            const res = respList[i] || {};
            const key = req.did || `${req.siid}/${req.piid}`;
            out[key] = { code: typeof res.code === 'number' ? res.code : -1, value: res.value, siid: req.siid, piid: req.piid };
        }
        return out;
    }

    async _setCap(cap, value) {
        try {
            if (!this.hasCapability(cap)) return;
            const cur = this.getCapabilityValue(cap);
            if (cur !== value) {
                await this.setCapabilityValue(cap, value);
                this.log('[CAP]', cap, '=', value);
            }
        } catch (e) {
            this._warn('[CAP] set error', cap, e?.message);
        }
    }

    async _triggerEatenChanged(todayG, totalG, deltaG) {
        try {
            await this._flow.eatenFoodChanged?.trigger(
                this,
                {
                    today_g: typeof todayG === 'number' ? todayG : 0,
                    total_g: typeof totalG === 'number' ? totalG : 0,
                    delta_g: typeof deltaG === 'number' ? deltaG : 0
                },
                {}
            );
            this.log('[EATEN] trigger:', { today_g: todayG, total_g: totalG, delta_g: deltaG });
        } catch (e) {
            this._warn('[EATEN] trigger error:', e?.message);
        }
    }

    _onceWarn(msg) {
        if (!this._state.once.has(msg)) {
            this._state.once.add(msg);
            this._warn(msg);
        }
    }

    _ymdNow() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    async _ensureCapabilities() {
        const required = ['petfeeder_foodlevel', 'petfeeder_eaten_food_today', 'petfeeder_eaten_food_total', 'petfeeder_food_out_status', 'petfeeder_heap_status', 'petfeeder_status_mode', 'measure_desiccant', 'measure_desiccant_time', 'alarm_desiccant_low'];
        for (const id of required) {
            try {
                if (!this.hasCapability(id)) {
                    await this.addCapability(id);
                    this.log('[INIT] added capability:', id);
                }
            } catch (e) {
                this._warn('[INIT] addCapability failed', id, e?.message);
            }
        }
    }
}

module.exports = PetFeederMiotDevice;
