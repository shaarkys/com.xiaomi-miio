'use strict';

/**
 * Pet Feeder (MIoT / Wi-Fi)
 * Model focus: xiaomi.feeder.iv2001 (CN)
 *
 * Adds:
 *  • Eaten food (today / total)
 *  • Food-out status and Heap status
 *  • Status (mode) text
 *  • Desiccant (level %, time) + low-desiccant alarm
 *
 * Notes:
 *  • Completely backward compatible: no existing capabilities removed or broken.
 *  • All new capabilities are added at runtime if missing.
 *  • Defensive MIoT handling: code -4001, undefined, or unsupported props won’t throw or break polling.
 *  • Optional probe mode logs candidate siid/piid hits to help confirm final mapping on real devices.
 */

const Homey = require('homey');
const DeviceBase = require('../wifi_device.js'); // Your base Wi-Fi device (handles miio lifecycle, polling, etc.)

// ───────────────────────────────────────────────────────────────────────────────
// MIoT mapping (defaults + probe candidates)
// ───────────────────────────────────────────────────────────────────────────────

/** Model map → property preset id used below */
const MODEL_TO_PRESET = {
    'mmgg.feeder.fi1': 'default',
    'mmgg.feeder.inland': 'default',
    'mmgg.feeder.spec': 'default',
    'xiaomi.feeder.pi2001': 'pi2001',
    'xiaomi.feeder.iv2001': 'iv2001'
};

/** Always present / legacy block */
const BASE_GET_PROPS = [
    { did: 'error', siid: 2, piid: 1 }, // Fault
    { did: 'foodlevel', siid: 2, piid: 6 } // Bin level (0/1/2 typically)
];

/** Legacy actions we already support */
const BASE_ACTIONS = {
    serve_food: { siid: 2, aiid: 1, did: 'call-2-1', in: [] }
};

/** New defaults for iv2001 (all unverified by design, will be validated at runtime; see probe) */
const IV2001_DEFAULTS = {
    eaten_food_today: { siid: 2, piid: 22 }, // [Unverified]
    eaten_food_total: { siid: 2, piid: 23 }, // [Unverified]
    food_out_status: { siid: 2, piid: 24 }, // [Unverified]
    heap_status: { siid: 2, piid: 25 }, // [Unverified]
    status_mode: { siid: 2, piid: 26 }, // [Unverified]
    desiccant_level: { siid: 7, piid: 1 }, // [Unverified]
    desiccant_time: { siid: 7, piid: 2 } // [Unverified]
};

/** Compose presets for each supported model */
const PRESETS = {
    default: {
        get_properties: [
            ...BASE_GET_PROPS
            // Add default-only items here if needed for older feeders
        ],
        set_properties: { ...BASE_ACTIONS }
    },
    pi2001: {
        get_properties: [
            ...BASE_GET_PROPS,
            { did: 'battery', siid: 4, piid: 4 } // as seen on some models
        ],
        set_properties: { ...BASE_ACTIONS }
    },
    iv2001: {
        get_properties: [
            ...BASE_GET_PROPS,
            // New telemetry (will be probed/validated defensively)
            { did: 'eaten_food_today', siid: IV2001_DEFAULTS.eaten_food_today.siid, piid: IV2001_DEFAULTS.eaten_food_today.piid },
            { did: 'eaten_food_total', siid: IV2001_DEFAULTS.eaten_food_total.siid, piid: IV2001_DEFAULTS.eaten_food_total.piid },
            { did: 'food_out_status', siid: IV2001_DEFAULTS.food_out_status.siid, piid: IV2001_DEFAULTS.food_out_status.piid },
            { did: 'heap_status', siid: IV2001_DEFAULTS.heap_status.siid, piid: IV2001_DEFAULTS.heap_status.piid },
            { did: 'status_mode', siid: IV2001_DEFAULTS.status_mode.siid, piid: IV2001_DEFAULTS.status_mode.piid },
            { did: 'desiccant_level', siid: IV2001_DEFAULTS.desiccant_level.siid, piid: IV2001_DEFAULTS.desiccant_level.piid },
            { did: 'desiccant_time', siid: IV2001_DEFAULTS.desiccant_time.siid, piid: IV2001_DEFAULTS.desiccant_time.piid }
        ],
        set_properties: { ...BASE_ACTIONS }
    }
};

/** Probe candidates to try if defaults fail and setting iv2001_extended_probe === true */
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

// ───────────────────────────────────────────────────────────────────────────────
// Helpers: mapping + safe set
// ───────────────────────────────────────────────────────────────────────────────

const MODE_MAP = new Map([
    // Conservatively chosen; unknowns are logged and mapped to 'unknown'
    [0, 'unknown'],
    [1, 'idle'],
    [2, 'feeding'],
    [3, 'paused'],
    [4, 'fault']
]);

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

function daysFromHoursMaybe(v) {
    const n = num(v);
    if (n === undefined) return undefined;
    // Some firmwares report remaining time in hours; some already in days.
    // If value > 1000 treat as hours and convert, otherwise pass through as days.
    return n > 1000 ? Math.round(n / 24) : Math.round(n);
}

// ───────────────────────────────────────────────────────────────────────────────
// Device class
// ───────────────────────────────────────────────────────────────────────────────

class PetFeederMiotDevice extends DeviceBase {
    async onInit() {
        try {
            this.log('[IV2001] onInit');

            // Determine preset by model; fall back to 'default'
            const model = this.getStoreValue('model') || this.getData()?.model || 'xiaomi.feeder.iv2001';
            this._presetId = MODEL_TO_PRESET[model] || 'default';
            this._preset = PRESETS[this._presetId];

            // Add required capabilities (no-throw, add only if missing)
            await this._ensureCapabilities();

            // Settings defaults
            const settings = this.getSettings() || {};
            const patch = {};
            if (typeof settings.desiccant_alarm_threshold !== 'number') patch.desiccant_alarm_threshold = 20;
            if (typeof settings.iv2001_extended_probe !== 'boolean') patch.iv2001_extended_probe = false;
            if (Object.keys(patch).length) {
                await this.setSettings(patch).catch((err) => this.warn('[SETTINGS] failed default patch:', err?.message));
            }

            // Flow triggers
            this._flow = {
                feederStatusChanged: this.homey.flow.getDeviceTriggerCard('feeder_status_changed'),
                eatenFoodChanged: this.homey.flow.getDeviceTriggerCard('eaten_food_changed'),
                desiccantLow: this.homey.flow.getDeviceTriggerCard('desiccant_low')
            };

            // Local state for deltas & alarms
            this._state = {
                lastMode: 'unknown',
                lastTotalG: undefined,
                lastTodayG: undefined,
                desiccantAlarm: false,
                todayBaseline: {
                    ymd: this._ymdNow(),
                    totalAtMidnight: undefined
                },
                missingLogOnce: new Set() // remember which props failed with -4001 to avoid spam
            };

            // Register a guard listener for read-only capability in case UI tries to set it
            this.registerCapabilityListener('petfeeder_foodlevel', async () => {
                throw new Error('petfeeder_foodlevel is read-only');
            });

            // Action: serve food (if exposed as a button capability in your app; optional)
            if (this.hasCapability('petfeeder_serve_food')) {
                this.registerCapabilityListener('petfeeder_serve_food', async () => this._doServeFood());
            }

            // The base class should already schedule polling → retrieveDeviceData()
            // If not, call a base method to start polling. We rely on your existing base implementation.
            this.log('[IV2001] init complete, preset =', this._presetId);
        } catch (err) {
            this.error('[IV2001] onInit error:', err?.message || err);
        }
    }

    // Called by your base class on each poll
    async retrieveDeviceData() {
        const model = this._presetId;
        const isIv2001 = model === 'iv2001';
        try {
            // 1) Read with defaults
            const req = (this._preset?.get_properties || []).map((p) => ({ did: p.did, siid: p.siid, piid: p.piid }));
            const baseResp = await this._safeGetProps(req);

            // Convert to map: did → { code, value, siid, piid }
            const got = this._indexResults(req, baseResp);

            // 2) Optionally probe alternates for iv2001 if any values are missing
            let merged = { ...got };
            if (isIv2001 && this.getSettings().iv2001_extended_probe === true) {
                const probeHits = await this._extendedProbe(merged);
                merged = { ...merged, ...probeHits }; // prefer probe hits only for missing or failed items
            }

            // 3) Update legacy/basic capabilities (existing behaviour)
            await this._updateFaultAndFoodLevel(merged);

            // 4) Update new telemetry
            if (isIv2001) {
                await this._updateEatenFood(merged);
                await this._updateFoodOutAndHeap(merged);
                await this._updateStatusMode(merged);
                await this._updateDesiccant(merged);
            }
        } catch (err) {
            this.error('[IV2001] retrieveDeviceData error:', err?.message || err);
        }
    }

    // ── Updates ─────────────────────────────────────────────────────────────────

    async _updateFaultAndFoodLevel(results) {
        // error → numeric code; foodlevel → numeric bin level (0/1/2)
        const e = results['error'];
        const f = results['foodlevel'];

        if (e && e.code === 0 && typeof e.value !== 'undefined') {
            // Expose as setting or capability if your app does (kept as-is)
            this.log('[IV2001][FAULT] code=', e.value);
        } else if (e && e.code === -4001) {
            this._logOnce('[IV2001][FAULT] property unsupported (-4001)');
        }

        if (this.hasCapability('petfeeder_foodlevel')) {
            if (f && f.code === 0 && typeof f.value !== 'undefined') {
                await this._safeCap('petfeeder_foodlevel', f.value);
            } else if (f && f.code === -4001) {
                this._logOnce('[IV2001][FOODLEVEL] property unsupported (-4001)');
            }
        }
    }

    async _updateEatenFood(results) {
        const today = results['eaten_food_today'];
        const total = results['eaten_food_total'];

        let todayG;
        let totalG;

        if (total && total.code === 0 && typeof total.value !== 'undefined') {
            totalG = num(total.value);
        } else if (total && total.code === -4001) {
            this._logOnce('[EATEN] total unsupported (-4001)');
        }

        if (today && today.code === 0 && typeof today.value !== 'undefined') {
            todayG = num(today.value);
        } else if (today && today.code === -4001) {
            this._logOnce('[EATEN] today unsupported (-4001)');
        }

        // Fallback: compute "today" from total delta since midnight baseline if device lacks "today"
        if (todayG === undefined && totalG !== undefined) {
            const ymdNow = this._ymdNow();
            if (this._state.todayBaseline.ymd !== ymdNow) {
                // New day -> reset baseline
                this._state.todayBaseline.ymd = ymdNow;
                this._state.todayBaseline.totalAtMidnight = totalG;
                this.log('[EATEN] baseline reset', ymdNow, 'totalAtMidnight=', totalG);
            }
            if (typeof this._state.todayBaseline.totalAtMidnight === 'number') {
                todayG = Math.max(0, Math.round(totalG - this._state.todayBaseline.totalAtMidnight));
            }
        }

        // Publish capabilities (only if present)
        if (this.hasCapability('petfeeder_eaten_food_total') && typeof totalG === 'number') {
            const prev = this._state.lastTotalG;
            await this._safeCap('petfeeder_eaten_food_total', totalG);
            this._state.lastTotalG = totalG;

            // Delta triggers prefer total, because some firmwares skip "today"
            if (typeof prev === 'number' && totalG !== prev) {
                const delta = totalG - prev;
                // Also update 'today' capability if device lacks it but we computed fallback
                if (this.hasCapability('petfeeder_eaten_food_today') && typeof todayG === 'number') {
                    await this._safeCap('petfeeder_eaten_food_today', todayG);
                }
                await this._triggerEatenFoodChanged(todayG, totalG, delta);
            }
        }

        if (this.hasCapability('petfeeder_eaten_food_today') && typeof todayG === 'number') {
            const prevToday = this._state.lastTodayG;
            await this._safeCap('petfeeder_eaten_food_today', todayG);
            this._state.lastTodayG = todayG;

            // If totals are absent but today changes, still emit trigger (delta = today - prevToday)
            if (typeof prevToday === 'number' && todayG !== prevToday) {
                await this._triggerEatenFoodChanged(todayG, this._state.lastTotalG, todayG - prevToday);
            }
        }
    }

    async _updateFoodOutAndHeap(results) {
        const mapFlag = (raw, kind) => {
            const v = num(raw);
            if (v === 0) return 'ok';
            if (v === 1) return kind === 'food_out' ? 'food_out' : 'heap_detected';
            this.warn(`[${kind === 'food_out' ? 'FOODOUT' : 'HEAP'}] unexpected value:`, raw);
            return 'ok';
        };

        const out = results['food_out_status'];
        if (this.hasCapability('petfeeder_food_out_status')) {
            if (out && out.code === 0 && typeof out.value !== 'undefined') {
                const val = mapFlag(out.value, 'food_out');
                await this._safeCap('petfeeder_food_out_status', val);
            } else if (out && out.code === -4001) {
                this._logOnce('[FOODOUT] unsupported (-4001)');
            }
        }

        const heap = results['heap_status'];
        if (this.hasCapability('petfeeder_heap_status')) {
            if (heap && heap.code === 0 && typeof heap.value !== 'undefined') {
                const val = mapFlag(heap.value, 'heap');
                await this._safeCap('petfeeder_heap_status', val);
            } else if (heap && heap.code === -4001) {
                this._logOnce('[HEAP] unsupported (-4001)');
            }
        }
    }

    async _updateStatusMode(results) {
        const mode = results['status_mode'];
        if (!this.hasCapability('petfeeder_status_mode')) return;

        if (mode && mode.code === 0 && typeof mode.value !== 'undefined') {
            const raw = num(mode.value);
            const text = MODE_MAP.get(raw) || 'unknown';
            const prev = this._state.lastMode;
            await this._safeCap('petfeeder_status_mode', text);
            if (text !== prev) {
                await this._triggerStatusChanged(text, prev);
                this._state.lastMode = text;
            }
        } else if (mode && mode.code === -4001) {
            this._logOnce('[MODE] unsupported (-4001)');
        }
    }

    async _updateDesiccant(results) {
        const level = results['desiccant_level'];
        const time = results['desiccant_time'];

        let levelPct, daysLeft;

        if (level && level.code === 0 && typeof level.value !== 'undefined') {
            levelPct = Math.max(0, Math.min(100, Math.round(num(level.value))));
        } else if (level && level.code === -4001) {
            this._logOnce('[DESICCANT] level unsupported (-4001)');
        }

        if (time && time.code === 0 && typeof time.value !== 'undefined') {
            daysLeft = daysFromHoursMaybe(time.value);
        } else if (time && time.code === -4001) {
            this._logOnce('[DESICCANT] time unsupported (-4001)');
        }

        if (this.hasCapability('measure_desiccant') && typeof levelPct === 'number') {
            await this._safeCap('measure_desiccant', levelPct);
        }
        if (this.hasCapability('measure_desiccant_time') && typeof daysLeft === 'number') {
            await this._safeCap('measure_desiccant_time', daysLeft);
        }

        // Alarm
        if (this.hasCapability('alarm_desiccant_low') && typeof levelPct === 'number') {
            const thr = Number(this.getSettings().desiccant_alarm_threshold) || 20;
            const shouldAlarm = levelPct < thr;
            if (shouldAlarm !== this._state.desiccantAlarm) {
                await this._safeCap('alarm_desiccant_low', shouldAlarm);
                this._state.desiccantAlarm = shouldAlarm;
                if (shouldAlarm) {
                    await this._flow.desiccantLow?.trigger(this, { level_percent: levelPct }, {});
                    this.log('[DESICCANT] alarm fired at', levelPct, '% (<', thr, ')');
                } else {
                    this.log('[DESICCANT] alarm cleared at', levelPct, '% (>=', thr, ')');
                }
            }
        }
    }

    // ── Flow triggers ───────────────────────────────────────────────────────────

    async _triggerStatusChanged(newStatus, prevStatus) {
        try {
            if (!this._flow.feederStatusChanged) return;
            await this._flow.feederStatusChanged.trigger(
                this,
                {
                    new_status: newStatus,
                    previous_status: prevStatus || 'unknown'
                },
                {}
            );
            this.log('[MODE] Flow: feeder_status_changed', prevStatus, '→', newStatus);
        } catch (e) {
            this.warn('[MODE] trigger error:', e?.message);
        }
    }

    async _triggerEatenFoodChanged(todayG, totalG, deltaG) {
        try {
            if (!this._flow.eatenFoodChanged) return;
            const tokens = {
                today_g: typeof todayG === 'number' ? todayG : 0,
                total_g: typeof totalG === 'number' ? totalG : 0,
                delta_g: typeof deltaG === 'number' ? deltaG : 0
            };
            await this._flow.eatenFoodChanged.trigger(this, tokens, {});
            this.log('[EATEN] Flow: eaten_food_changed', tokens);
        } catch (e) {
            this.warn('[EATEN] trigger error:', e?.message);
        }
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    async _doServeFood() {
        const action = this._preset?.set_properties?.serve_food;
        if (!action) return;
        try {
            this.log('[ACTION] serve_food aiid', action.aiid);
            await this.miio.call('action', [{ siid: action.siid, aiid: action.aiid, in: action.in || [] }], { retries: 1 });
        } catch (e) {
            this.warn('[ACTION] serve_food error:', e?.message);
        }
    }

    // ── Probing ────────────────────────────────────────────────────────────────

    async _extendedProbe(current) {
        const sweepReq = [];

        const addSweep = (label, list) => {
            for (const cand of list) {
                sweepReq.push({ did: `probe_${label}_${cand.siid}_${cand.piid}`, siid: cand.siid, piid: cand.piid });
            }
        };

        addSweep('eaten_food_today', PROBE_CANDIDATES.eaten_food_today);
        addSweep('eaten_food_total', PROBE_CANDIDATES.eaten_food_total);
        addSweep('food_out_status', PROBE_CANDIDATES.food_out_status);
        addSweep('heap_status', PROBE_CANDIDATES.heap_status);
        addSweep('status_mode', PROBE_CANDIDATES.status_mode);
        addSweep('desiccant_level', PROBE_CANDIDATES.desiccant_level);
        addSweep('desiccant_time', PROBE_CANDIDATES.desiccant_time);

        if (!sweepReq.length) return {};

        this.log('[PROBE] starting extended sweep, candidates:', sweepReq.length);
        const resp = await this._safeGetProps(sweepReq);
        const out = {};

        for (let i = 0; i < resp.length; i++) {
            const r = resp[i];
            const req = sweepReq[i];
            if (!r || typeof r.code !== 'number') continue;
            if (r.code !== 0 || typeof r.value === 'undefined') continue;

            // did format: probe_<label>_<siid>_<piid>
            const m = /^probe_([^_]+)_(\d+)_(\d+)$/.exec(req.did);
            if (!m) continue;
            const label = m[1];

            // Only adopt probe value when current default failed or is undefined
            const existing = current[label];
            if (!existing || existing.code !== 0 || typeof existing.value === 'undefined') {
                out[label] = { code: 0, value: r.value, siid: req.siid, piid: req.piid };
                this.log(`[PROBE] hit for ${label}: siid=${req.siid} piid=${req.piid} value=${JSON.stringify(r.value)}`);
            }
        }
        if (Object.keys(out).length === 0) {
            this.log('[PROBE] no new hits in this sweep');
        }
        return out;
    }

    // ── Low-level helpers ──────────────────────────────────────────────────────

    async _safeGetProps(requestArray) {
        try {
            if (!Array.isArray(requestArray) || requestArray.length === 0) return [];
            const res = await this.miio.call('get_properties', requestArray, { retries: 1 });
            return Array.isArray(res) ? res : [];
        } catch (e) {
            this.warn('[MIOT] get_properties error:', e?.message);
            return [];
        }
    }

    _indexResults(reqList, respList) {
        const out = {};
        for (let i = 0; i < reqList.length; i++) {
            const req = reqList[i];
            const res = respList[i] || {};
            const key = req.did || `${req.siid}/${req.piid}`;
            out[key] = {
                code: typeof res.code === 'number' ? res.code : -1,
                value: res.value,
                siid: req.siid,
                piid: req.piid
            };
        }
        return out;
    }

    async _safeCap(cap, value) {
        try {
            if (!this.hasCapability(cap)) return;
            const cur = this.getCapabilityValue(cap);
            if (cur !== value) {
                await this.setCapabilityValue(cap, value);
                this.log(`[CAP] ${cap} =`, value);
            }
        } catch (e) {
            this.warn('[CAP] set error', cap, e?.message);
        }
    }

    _logOnce(msg) {
        if (!this._state.missingLogOnce.has(msg)) {
            this._state.missingLogOnce.add(msg);
            this.warn(msg);
        }
    }

    _ymdNow() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Ensure all new caps exist (added silently on upgrade)
    async _ensureCapabilities() {
        const required = [
            'petfeeder_foodlevel', // existing one
            'petfeeder_eaten_food_today',
            'petfeeder_eaten_food_total',
            'petfeeder_food_out_status',
            'petfeeder_heap_status',
            'petfeeder_status_mode',
            'measure_desiccant',
            'measure_desiccant_time',
            'alarm_desiccant_low'
        ];

        for (const id of required) {
            try {
                if (!this.hasCapability(id)) {
                    await this.addCapability(id);
                    this.log('[INIT] added capability:', id);
                }
            } catch (e) {
                this.warn('[INIT] addCapability failed', id, e?.message);
            }
        }
    }
}

module.exports = PetFeederMiotDevice;
