'use strict';

/**
 * Pet Feeder MIoT (Wi-Fi)
 * Model: xiaomi.feeder.iv2001
 *
 * Key points:
 *  • Backward compatible; no existing capability is removed.
 *  • Adds its own guarded polling loop so values are visible even if the base poll is not invoking us.
 *  • Defensive MIoT handling (-4001, undefined) with one-time warnings.
 *  • Optional “extended probe” to discover correct siid/piid at runtime.
 *  • Rich diagnostic logging with clear tags.
 */

const Homey = require('homey');
const DeviceBase = require('../wifi_device.js'); // your base device (connection, token/IP settings, etc.)

// ───────────────────────────────────────────────────────────────────────────────
// Defaults & candidates (as requested)
// ───────────────────────────────────────────────────────────────────────────────

const IV2001_DEFAULTS = {
    eaten_food_today: { siid: 2, piid: 22 },
    eaten_food_total: { siid: 2, piid: 23 },
    food_out_status: { siid: 2, piid: 24 },
    heap_status: { siid: 2, piid: 25 },
    status_mode: { siid: 2, piid: 26 },
    desiccant_level: { siid: 7, piid: 1 },
    desiccant_time: { siid: 7, piid: 2 }
};

const BASE_GET_PROPS = [
    { did: 'error', siid: 2, piid: 1 },
    { did: 'foodlevel', siid: 2, piid: 6 }
];

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

const MODE_MAP = new Map([
    [0, 'unknown'],
    [1, 'idle'],
    [2, 'feeding'],
    [3, 'paused'],
    [4, 'fault']
]);

function n(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
}
function daysFromHoursMaybe(v) {
    const x = n(v);
    if (x === undefined) return undefined;
    return x > 1000 ? Math.round(x / 24) : Math.round(x);
}

// ───────────────────────────────────────────────────────────────────────────────
// Device
// ───────────────────────────────────────────────────────────────────────────────

class PetFeederMiotDevice extends DeviceBase {
    async onInit() {
        try {
            this.log('[IV2001] onInit');

            // Ensure required capabilities exist (upgrade-safe)
            await this._ensureCaps();

            // Settings defaults
            const s = this.getSettings() || {};
            const patch = {};
            if (typeof s.desiccant_alarm_threshold !== 'number') patch.desiccant_alarm_threshold = 20;
            if (typeof s.iv2001_extended_probe !== 'boolean') patch.iv2001_extended_probe = false;
            if (Object.keys(patch).length) {
                await this.setSettings(patch).catch((e) => this.warn('[SETTINGS] default patch failed:', e?.message));
            }

            // Flow triggers
            this._flow = {
                feederStatusChanged: this.homey.flow.getDeviceTriggerCard('feeder_status_changed'),
                eatenFoodChanged: this.homey.flow.getDeviceTriggerCard('eaten_food_changed'),
                desiccantLow: this.homey.flow.getDeviceTriggerCard('desiccant_low')
            };

            // Driver local state
            this._state = {
                lastMode: 'unknown',
                lastTotalG: undefined,
                lastTodayG: undefined,
                desiccantAlarm: false,
                once: new Set(),
                todayBaseline: { ymd: this._ymd(), totalAtMidnight: undefined }
            };

            // Guard listener (read-only)
            if (this.hasCapability('petfeeder_foodlevel')) {
                this.registerCapabilityListener('petfeeder_foodlevel', async () => {
                    throw new Error('petfeeder_foodlevel is read-only');
                });
            }

            // Optional serve button capability (if your compose exposes it)
            if (this.hasCapability('petfeeder_serve_food')) {
                this.registerCapabilityListener('petfeeder_serve_food', async () => this._serveFood());
            }

            // Kick the base connection process; if your base schedules polls, fine;
            // we also set our own guarded poller to make sure values appear.
            if (typeof this.bootSequence === 'function') {
                try {
                    this.bootSequence();
                } catch (e) {
                    this.warn('[INIT] bootSequence failed:', e?.message);
                }
            }

            // Start our guarded polling loop
            const pollSeconds = Math.max(5, Number(this.getSettings().polling) || 15);
            this._pollMs = pollSeconds * 1000;
            if (this._myPoll) this.homey.clearInterval(this._myPoll);
            this._myPoll = this.homey.setInterval(() => this._pollOnce(), this._pollMs);

            // First immediate poll
            this.homey.setTimeout(() => this._pollOnce(), 1000);

            this.log('[IV2001] init complete, preset = iv2001');
        } catch (e) {
            this.error('[IV2001] onInit error:', e?.message || e);
        }
    }

    async onUninit() {
        try {
            if (this._myPoll) this.homey.clearInterval(this._myPoll);
        } catch (_) {}
        if (super.onUninit) return super.onUninit();
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Polling
    // ───────────────────────────────────────────────────────────────────────────

    async _pollOnce() {
        // Skip if base is already in the middle of a poll to avoid duplicating calls.
        if (this._pollingInProgress) return;
        this._pollingInProgress = true;

        try {
            // Ensure connection exists; if base has createDevice(), let it manage connection.
            if (!this.miio) {
                if (typeof this.createDevice === 'function') {
                    this.warn('[IV2001] miio not ready, requesting (re)createDevice()');
                    try {
                        this.createDevice();
                    } catch (e) {
                        this.warn('[IV2001] createDevice error:', e?.message);
                    }
                } else {
                    this.warn('[IV2001] miio not ready and no createDevice() on base.');
                }
                return;
            }

            // Build default request
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
            const mapped = this._mapResults(req, res);

            // Optional probe
            if (this.getSettings().iv2001_extended_probe === true) {
                const additions = await this._probe(mapped);
                Object.assign(mapped, additions);
            }

            // Update capabilities
            await this._updateFaultAndFoodLevel(mapped);
            await this._updateEatenFood(mapped);
            await this._updateFoodOutAndHeap(mapped);
            await this._updateStatusMode(mapped);
            await this._updateDesiccant(mapped);

            this.log('[IV2001] poll done');
        } catch (e) {
            this.warn('[IV2001] poll error:', e?.message);
        } finally {
            this._pollingInProgress = false;
        }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Updaters
    // ───────────────────────────────────────────────────────────────────────────

    async _updateFaultAndFoodLevel(g) {
        const e = g.error,
            f = g.foodlevel;

        if (e && e.code === 0) {
            this.log('[FAULT] device code =', e.value);
        } else if (e && e.code === -4001) {
            this._onceWarn('[FAULT] property unsupported (-4001)');
        }

        if (this.hasCapability('petfeeder_foodlevel')) {
            if (f && f.code === 0 && typeof f.value !== 'undefined') {
                await this._cap('petfeeder_foodlevel', f.value);
            } else if (f && f.code === -4001) {
                this._onceWarn('[FOODLEVEL] property unsupported (-4001)');
            }
        }
    }

    async _updateEatenFood(g) {
        const today = g.eaten_food_today;
        const total = g.eaten_food_total;

        let todayG, totalG;

        if (total && total.code === 0) totalG = n(total.value);
        else if (total && total.code === -4001) this._onceWarn('[EATEN] total unsupported (-4001)');

        if (today && today.code === 0) todayG = n(today.value);
        else if (today && today.code === -4001) this._onceWarn('[EATEN] today unsupported (-4001)');

        // Fallback today from total
        if (todayG === undefined && typeof totalG === 'number') {
            const ymd = this._ymd();
            if (this._state.todayBaseline.ymd !== ymd) {
                this._state.todayBaseline.ymd = ymd;
                this._state.todayBaseline.totalAtMidnight = totalG;
                this.log('[EATEN] new day baseline totalAtMidnight =', totalG);
            }
            if (typeof this._state.todayBaseline.totalAtMidnight === 'number') {
                todayG = Math.max(0, Math.round(totalG - this._state.todayBaseline.totalAtMidnight));
            }
        }

        // Publish + flow
        if (typeof totalG === 'number' && this.hasCapability('petfeeder_eaten_food_total')) {
            const prevT = this._state.lastTotalG;
            await this._cap('petfeeder_eaten_food_total', totalG);
            this._state.lastTotalG = totalG;
            if (typeof prevT === 'number' && prevT !== totalG) {
                const delta = totalG - prevT;
                await this._maybeEmitEaten(todayG, totalG, delta);
            }
        }

        if (typeof todayG === 'number' && this.hasCapability('petfeeder_eaten_food_today')) {
            const prev = this._state.lastTodayG;
            await this._cap('petfeeder_eaten_food_today', todayG);
            this._state.lastTodayG = todayG;
            if (typeof prev === 'number' && prev !== todayG && typeof this._state.lastTotalG !== 'number') {
                await this._maybeEmitEaten(todayG, this._state.lastTotalG, todayG - prev);
            }
        }
    }

    async _updateFoodOutAndHeap(g) {
        const toEnum = (raw, which) => {
            const v = n(raw);
            if (v === 0) return 'ok';
            if (v === 1) return which === 'food' ? 'food_out' : 'heap_detected';
            this.warn(`[${which === 'food' ? 'FOODOUT' : 'HEAP'}] unexpected value:`, raw);
            return 'ok';
        };

        const fo = g.food_out_status;
        if (this.hasCapability('petfeeder_food_out_status')) {
            if (fo && fo.code === 0) await this._cap('petfeeder_food_out_status', toEnum(fo.value, 'food'));
            else if (fo && fo.code === -4001) this._onceWarn('[FOODOUT] unsupported (-4001)');
        }

        const hp = g.heap_status;
        if (this.hasCapability('petfeeder_heap_status')) {
            if (hp && hp.code === 0) await this._cap('petfeeder_heap_status', toEnum(hp.value, 'heap'));
            else if (hp && hp.code === -4001) this._onceWarn('[HEAP] unsupported (-4001)');
        }
    }

    async _updateStatusMode(g) {
        const m = g.status_mode;
        if (!this.hasCapability('petfeeder_status_mode')) return;
        if (m && m.code === 0) {
            const text = MODE_MAP.get(n(m.value)) || 'unknown';
            const prev = this._state.lastMode;
            await this._cap('petfeeder_status_mode', text);
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
        const t = g.desiccant_time;

        let pct, days;
        if (lvl && lvl.code === 0) pct = Math.max(0, Math.min(100, Math.round(n(lvl.value))));
        else if (lvl && lvl.code === -4001) this._onceWarn('[DESICCANT] level unsupported (-4001)');

        if (t && t.code === 0) days = daysFromHoursMaybe(t.value);
        else if (t && t.code === -4001) this._onceWarn('[DESICCANT] time unsupported (-4001)');

        if (typeof pct === 'number' && this.hasCapability('measure_desiccant')) {
            await this._cap('measure_desiccant', pct);
        }
        if (typeof days === 'number' && this.hasCapability('measure_desiccant_time')) {
            await this._cap('measure_desiccant_time', days);
        }

        if (this.hasCapability('alarm_desiccant_low') && typeof pct === 'number') {
            const thr = Number(this.getSettings().desiccant_alarm_threshold) || 20;
            const alarm = pct < thr;
            if (alarm !== this._state.desiccantAlarm) {
                await this._cap('alarm_desiccant_low', alarm);
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
    // Probe
    // ───────────────────────────────────────────────────────────────────────────

    async _probe(current) {
        const wanted = [
            ['eaten_food_today', PROBE_CANDIDATES.eaten_food_today],
            ['eaten_food_total', PROBE_CANDIDATES.eaten_food_total],
            ['food_out_status', PROBE_CANDIDATES.food_out_status],
            ['heap_status', PROBE_CANDIDATES.heap_status],
            ['status_mode', PROBE_CANDIDATES.status_mode],
            ['desiccant_level', PROBE_CANDIDATES.desiccant_level],
            ['desiccant_time', PROBE_CANDIDATES.desiccant_time]
        ];

        const req = [];
        for (const [label, list] of wanted) {
            const have = current[label];
            const need = !have || have.code !== 0 || typeof have.value === 'undefined';
            if (!need) continue;
            for (const cand of list) {
                req.push({ did: `probe_${label}_${cand.siid}_${cand.piid}`, siid: cand.siid, piid: cand.piid });
            }
        }
        if (!req.length) return {};

        this.log('[PROBE] starting sweep, candidates:', req.length);
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
    // MIoT & helpers
    // ───────────────────────────────────────────────────────────────────────────

    async _serveFood() {
        try {
            await this.miio.call('action', [{ siid: 2, aiid: 1, in: [] }], { retries: 1 });
            this.log('[ACTION] serve_food called');
        } catch (e) {
            this.warn('[ACTION] serve_food error:', e?.message);
        }
    }

    async _safeGetProps(req) {
        try {
            if (!Array.isArray(req) || !req.length) return [];
            const res = await this.miio.call('get_properties', req, { retries: 1 });
            return Array.isArray(res) ? res : [];
        } catch (e) {
            this.warn('[MIOT] get_properties error:', e?.message);
            return [];
        }
    }

    _mapResults(req, res) {
        const out = {};
        for (let i = 0; i < req.length; i++) {
            const q = req[i];
            const r = res[i] || {};
            const key = q.did || `${q.siid}/${q.piid}`;
            out[key] = { code: typeof r.code === 'number' ? r.code : -1, value: r.value, siid: q.siid, piid: q.piid };
        }
        return out;
    }

    async _cap(cap, value) {
        try {
            if (!this.hasCapability(cap)) return;
            const cur = this.getCapabilityValue(cap);
            if (cur !== value) {
                await this.setCapabilityValue(cap, value);
                this.log('[CAP]', cap, '=', value);
            }
        } catch (e) {
            this.warn('[CAP] set error', cap, e?.message);
        }
    }

    async _maybeEmitEaten(todayG, totalG, deltaG) {
        try {
            const tokens = {
                today_g: typeof todayG === 'number' ? todayG : 0,
                total_g: typeof totalG === 'number' ? totalG : 0,
                delta_g: typeof deltaG === 'number' ? deltaG : 0
            };
            await this._flow.eatenFoodChanged?.trigger(this, tokens, {});
            this.log('[EATEN] trigger:', tokens);
        } catch (e) {
            this.warn('[EATEN] trigger error:', e?.message);
        }
    }

    _ymd() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _onceWarn(msg) {
        if (!this._state.once.has(msg)) {
            this._state.once.add(msg);
            this.warn(msg);
        }
    }

    async _ensureCaps() {
        const want = ['petfeeder_foodlevel', 'petfeeder_eaten_food_today', 'petfeeder_eaten_food_total', 'petfeeder_food_out_status', 'petfeeder_heap_status', 'petfeeder_status_mode', 'measure_desiccant', 'measure_desiccant_time', 'alarm_desiccant_low'];
        for (const c of want) {
            try {
                if (!this.hasCapability(c)) {
                    await this.addCapability(c);
                    this.log('[INIT] added capability:', c);
                }
            } catch (e) {
                this.warn('[INIT] addCapability failed', c, e?.message);
            }
        }
    }
}

module.exports = PetFeederMiotDevice;
