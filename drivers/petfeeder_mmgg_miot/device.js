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
// MIoT defaults (static mapping)
// ───────────────────────────────────────────────────────────────────────────────

const BASE_GET_PROPS = [
    { did: 'error', siid: 2, piid: 1 },
    { did: 'foodlevel', siid: 2, piid: 6 }
];

const IV2001_DEFAULTS = {
    eaten_food_today: { siid: 2, piid: 18 }, // spec v2: today grams
    eaten_food_total: { siid: 2, piid: 20 }, // spec v2: total grams
    food_out_status: { siid: 2, piid: 11 }, // spec v2: food-out fault flag
    heap_status: { siid: 2, piid: 15 }, // spec v2: heap/accumulation flag
    status_mode: { siid: 2, piid: 32 }, // spec v2: idle/busy state
    target_feeding_measure: { siid: 2, piid: 7 }, // grams configured in device app
    desiccant_level: { siid: 6, piid: 1 }, // correct MIoT mapping (percent remaining)
    desiccant_time: { siid: 6, piid: 2 } // correct MIoT mapping (hours remaining)
};

const IV2001_SETTING_PROPS = {
    child_lock: { siid: 3, piid: 1, type: 'bool' }, // physical-controls-locked
    auto_screen_off: { siid: 3, piid: 3, type: 'uint8_bool' }, // mode 0/1 (auto screen-off)
    display_schedule_progress: { siid: 5, piid: 4, type: 'bool' }, // plan-process-display
    low_food_intake_threshold: { siid: 5, piid: 5, type: 'number', range: [10, 90] }, // grams (10-90)
    low_food_consumption_notify: { siid: 5, piid: 6, type: 'bool' }, // food-intake-state
    empty_food_bowl_duration: { siid: 5, piid: 10, type: 'number', range: [6, 24] }, // add-meal-cycle hours
    dispensing_error_correction: { siid: 5, piid: 12, type: 'uint8_bool' }, // compensate-switch 0/1
    bowl_spillage_prevention: { siid: 5, piid: 14, type: 'uint8_bool' } // prevent-accumulation 0/1
};

const MANUAL_FEED_PORTION_GRAMS = 5; // fallback grams per portion when target measure missing
const DESICCANT_FULL_DAYS = 30; // according to device UI (full pack lifetime)
const MANUAL_FEED_MAX_PORTIONS = 30;


// Human-readable mode mapping (conservative)
const MODE_MAP = new Map([
    [0, 'idle'],
    [1, 'feeding'],
    [2, 'paused'],
    [3, 'fault']
]);

const FOODLEVEL_ENUM_VALUES = new Set(['0', '1', '2', '3', '4']);

// ───────────────────────────────────────────────────────────────────────────────
// Small helpers
// ───────────────────────────────────────────────────────────────────────────────

function toNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

function normalizePercent(v) {
    const n = toNumber(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return undefined;
    if (Number.isFinite(min)) value = Math.max(min, value);
    if (Number.isFinite(max)) value = Math.min(max, value);
    return value;
}

function fromMiotBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v === 'on' || v === 'true' || v === '1';
    return undefined;
}

function toMiotBoolInput(v, format) {
    const truthy = v === true || v === 'true' || v === 'on' || Number(v) === 1;
    if (format === 'bool') return truthy;
    return truthy ? 1 : 0;
}

function normalizeDesiccantDays(v) {
    const n = toNumber(v);
    if (n === undefined) return undefined;

    const clamp = (value) => Math.max(0, Math.min(3650, Math.round(value)));

    if (n >= 86400 && n % 60 === 0) {
        return { days: clamp(n / 86400), branch: 'seconds' };
    }
    if (n > 24 && n < 86400 && n % 24 === 0) {
        return { days: clamp(n / 24), branch: 'hours' };
    }
    if (n >= 0 && n <= 3650) {
        return { days: clamp(n), branch: 'days' };
    }
    return undefined;
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
            // Resolve model->preset (kept for completeness; we operate fine on any feeder)
            const model = this.getStoreValue('model') || this.getData()?.model || 'xiaomi.feeder.iv2001';
            this._presetId = resolvePresetId(model);

            // Ensure capabilities exist (upgrade-safe)
            await this._ensureCapabilities();

            // Settings defaults
            const s = this.getSettings() || {};
            const patch = {};
            if (typeof s.desiccant_alarm_threshold !== 'number') patch.desiccant_alarm_threshold = 20;
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
                targetFeedingMeasure: MANUAL_FEED_PORTION_GRAMS,
                suppressSettingApply: false,
                desiccantAlarm: this.getCapabilityValue('alarm_desiccant_low') === true,
                todayBaseline: { ymd: this._ymdNow(), totalAtMidnight: undefined },
                lastDesiccantBranchLogAt: 0,
                lastDesiccantBranchLogged: undefined
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

            for (const key of changedKeys) {
                if (!Object.prototype.hasOwnProperty.call(IV2001_SETTING_PROPS, key)) continue;
                if (this._state?.suppressSettingApply) continue;
                try {
                    await this._applySettingToDevice(key, newSettings[key]);
                } catch (err) {
                    const message = err?.message || err;
                    this._warn('[IV2001] setting apply failed', key, message);
                    if (oldSettings[key] !== undefined) {
                        await this.updateSettingValue(key, oldSettings[key]);
                    }
                }
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
            const settingsReq = Object.entries(IV2001_SETTING_PROPS).map(([key, def]) => ({
                did: `setting_${key}`,
                siid: def.siid,
                piid: def.piid
            }));

            const req = [
                ...BASE_GET_PROPS,
                { did: 'eaten_food_today', siid: IV2001_DEFAULTS.eaten_food_today.siid, piid: IV2001_DEFAULTS.eaten_food_today.piid },
                { did: 'eaten_food_total', siid: IV2001_DEFAULTS.eaten_food_total.siid, piid: IV2001_DEFAULTS.eaten_food_total.piid },
                { did: 'food_out_status', siid: IV2001_DEFAULTS.food_out_status.siid, piid: IV2001_DEFAULTS.food_out_status.piid },
                { did: 'heap_status', siid: IV2001_DEFAULTS.heap_status.siid, piid: IV2001_DEFAULTS.heap_status.piid },
                { did: 'status_mode', siid: IV2001_DEFAULTS.status_mode.siid, piid: IV2001_DEFAULTS.status_mode.piid },
                { did: 'target_feeding_measure', siid: IV2001_DEFAULTS.target_feeding_measure.siid, piid: IV2001_DEFAULTS.target_feeding_measure.piid },
                { did: 'desiccant_level', siid: IV2001_DEFAULTS.desiccant_level.siid, piid: IV2001_DEFAULTS.desiccant_level.piid },
                { did: 'desiccant_time', siid: IV2001_DEFAULTS.desiccant_time.siid, piid: IV2001_DEFAULTS.desiccant_time.piid },
                ...settingsReq
            ];

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

            // Publish values
            await this._updateFaultAndFoodLevel(got);
            await this._updateEatenFood(got);
            await this._updateFoodOutAndHeap(got);
            await this._updateStatusMode(got);
            await this._updateTargetFeedingMeasure(got);
            await this._updateDesiccant(got);
            await this._syncSettingsFromMiot(got);

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
            const val = e.value;
            const numeric = toNumber(val);
            const isClear = val === 0 || val === '0' || numeric === 0;
            if (!isClear && typeof val !== 'undefined') {
                this.log('[FAULT] device code =', val);
            }
        } else if (e && e.code === -4001) {
            this._onceWarn('[FAULT] unsupported (-4001)');
        }

        if (this.hasCapability('petfeeder_foodlevel')) {
            if (f && f.code === 0 && typeof f.value !== 'undefined') {
                const enumValue = String(f.value);
                if (!FOODLEVEL_ENUM_VALUES.has(enumValue)) {
                    this._onceWarn(`[FOODLEVEL] unexpected value: ${JSON.stringify(f.value)}`);
                }
                await this._setCap('petfeeder_foodlevel', enumValue);
            } else if (f && f.code === -4001) {
                this._onceWarn('[FOODLEVEL] unsupported (-4001)');
            }
        }
    }

    async _updateEatenFood(g) {
        const today = g.eaten_food_today;
        const total = g.eaten_food_total;

        let todayG, totalG;
        const ymdNow = this._ymdNow();

        if (total && total.code === 0) totalG = toNumber(total.value);
        else if (total && total.code === -4001) this._onceWarn('[EATEN] total unsupported (-4001)');

        if (today && today.code === 0) todayG = toNumber(today.value);
        else if (today && today.code === -4001) this._onceWarn('[EATEN] today unsupported (-4001)');

        // Derive "today" from total delta when needed
        if (todayG === undefined && typeof totalG === 'number') {
            if (this._state.todayBaseline.ymd !== ymdNow) {
                this._state.todayBaseline.ymd = ymdNow;
                this._state.todayBaseline.totalAtMidnight = totalG;
                this.log('[EATEN] baseline set totalAtMidnight =', totalG);
            }
            if (typeof this._state.todayBaseline.totalAtMidnight === 'number') {
                todayG = Math.max(0, Math.round(totalG - this._state.todayBaseline.totalAtMidnight));
            }
        }

        const prevTotal = this._state.lastTotalG;
        const wrapDetected =
            this._state.todayBaseline.ymd === ymdNow &&
            typeof prevTotal === 'number' &&
            typeof totalG === 'number' &&
            totalG < prevTotal;
        if (wrapDetected && typeof totalG === 'number') {
            this._state.todayBaseline = { ymd: ymdNow, totalAtMidnight: totalG };
            this._state.lastTodayG = typeof todayG === 'number' ? todayG : undefined;
            this.log('[EATEN] total wrap detected, baseline reset at', totalG);
        }

        if (this.hasCapability('petfeeder_eaten_food_total') && typeof totalG === 'number') {
            await this._setCap('petfeeder_eaten_food_total', totalG);
            this._state.lastTotalG = totalG;
            if (!wrapDetected && typeof prevTotal === 'number' && prevTotal !== totalG) {
                const delta = totalG - prevTotal;
                await this._triggerEatenChanged(todayG, totalG, delta);
            }
        }

        if (this.hasCapability('petfeeder_eaten_food_today') && typeof todayG === 'number') {
            const prev = this._state.lastTodayG;
            await this._setCap('petfeeder_eaten_food_today', todayG);
            this._state.lastTodayG = todayG;
            if (!wrapDetected && typeof prev === 'number' && prev !== todayG && typeof this._state.lastTotalG !== 'number') {
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
                this.log('[MODE] change:', prev, '->', text);
                this._state.lastMode = text;
            }
        } else if (m && m.code === -4001) {
            this._onceWarn('[MODE] unsupported (-4001)');
        }
    }

    async _updateTargetFeedingMeasure(g) {
        const t = g.target_feeding_measure;
        if (!t || t.code !== 0) return;
        const value = toNumber(t.value);
        if (!Number.isFinite(value) || value <= 0) return;
        const normalized = Math.max(1, Math.round(value));
        if (this._state.targetFeedingMeasure !== normalized) {
            this._state.targetFeedingMeasure = normalized;
            this.log('[TARGET] feeding measure set to', normalized, 'g');
        }
    }

    async _syncSettingsFromMiot(g) {
        const patch = {};
        for (const [key, def] of Object.entries(IV2001_SETTING_PROPS)) {
            const entry = g[`setting_${key}`];
            if (!entry || entry.code !== 0) continue;
            const normalized = this._normalizeSettingFromDevice(def, entry.value);
            if (normalized === undefined) continue;
            const current = this.getSetting(key);
            if (current === undefined || current !== normalized) {
                patch[key] = normalized;
            }
        }
        if (Object.keys(patch).length === 0) return;
        try {
            this._state.suppressSettingApply = true;
            await this.setSettings(patch);
        } catch (e) {
            this._warn('[SETTINGS] sync failed', e?.message);
        } finally {
            this._state.suppressSettingApply = false;
        }
    }

    async _updateDesiccant(g) {
        const lvl = g.desiccant_level;
        const tim = g.desiccant_time;

        let pct, days;
        if (lvl && lvl.code === 0) {
            const normalized = normalizePercent(lvl.value);
            if (typeof normalized === 'number') pct = normalized;
        } else if (lvl && lvl.code === -4001) this._onceWarn('[DESICCANT] level unsupported (-4001)');

        if (tim && tim.code === 0) {
            const normalized = normalizeDesiccantDays(tim.value);
            if (normalized) {
                days = normalized.days;
                this._logDesiccantConversion(normalized.branch, tim.value, normalized.days);
            }
        } else if (tim && tim.code === -4001) this._onceWarn('[DESICCANT] time unsupported (-4001)');

        if (typeof pct !== 'number' && typeof days === 'number') {
            const estimated = clampNumber((days / DESICCANT_FULL_DAYS) * 100, 0, 100);
            if (Number.isFinite(estimated)) {
                pct = Math.round(estimated);
            }
        }

        if (typeof pct === 'number' && this.hasCapability('measure_desiccant')) {
            await this._setCap('measure_desiccant', pct);
        }
        if (typeof days === 'number' && this.hasCapability('measure_desiccant_time')) {
            await this._setCap('measure_desiccant_time', days);
        }

        if (this.hasCapability('alarm_desiccant_low') && typeof pct === 'number') {
            const thr = Number(this.getSettings().desiccant_alarm_threshold) || 20;
            const alarm = pct < thr;
            const currentCap = this.getCapabilityValue('alarm_desiccant_low');
            if (alarm !== this._state.desiccantAlarm || currentCap !== alarm) {
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
    // ───────────────────────────────────────────────────────────────────────────

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
        } catch (error) {
            this._warn('[IV2001] miio init failed:', error?.message);
            // Retry later
            this.homey.setTimeout(() => this._initMiio(), 10000);
        }
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
                    const res = await this._callMiio('get_properties', batch, { retries: 1 }, 5000);
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

    async servePortions(portionCount) {
        try {
            if (!this.miio) {
                throw new Error('miio not ready');
            }
            const raw = Number(portionCount);
            const count = Number.isFinite(raw) ? Math.max(1, Math.min(MANUAL_FEED_MAX_PORTIONS, Math.round(raw))) : 1;
            const gramsPerPortion = Number.isFinite(this._state.targetFeedingMeasure) && this._state.targetFeedingMeasure > 0 ? this._state.targetFeedingMeasure : MANUAL_FEED_PORTION_GRAMS;
            const grams = count * gramsPerPortion;
            // MIoT spec and field reports expect grams on siid:2 / piid:8 for the manual feed action.
            const payload = {
                siid: 2,
                aiid: 1,
                in: [
                    { siid: 2, piid: 8, value: grams }
                ]
            };
            const result = await this._callMiio('action', payload, { retries: 1 }, 8000);
            this.log('[FEED] manual feed', { portions: count, grams, grams_per_portion: gramsPerPortion });
            return result;
        } catch (err) {
            const message = err?.message || err;
            this._warn('[FEED] manual feed error:', message);
            throw err;
        }
    }

    async _callMiio(method, params, options, timeoutMs = 5000) {
        const op = (async () => {
            return await this.miio.call(method, params, options || {});
        })();
        const timeout = new Promise((_, reject) => {
            this.homey.setTimeout(() => reject(new Error('timeout')), timeoutMs);
        });
        return Promise.race([op, timeout]);
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
                try {
                    await this.setCapabilityValue(cap, value);
                } catch (e) {
                    const expectsString = /expected string|InvalidTypeError/i.test(String(e?.message || ''));
                    if (expectsString && typeof value !== 'string') {
                        await this.setCapabilityValue(cap, String(value));
                    } else {
                        throw e;
                    }
                }
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


    _logDesiccantConversion(branch, raw, days) {
        if (!branch) return;
        const now = Date.now();
        const shouldLog =
            now - (this._state.lastDesiccantBranchLogAt || 0) > 60 * 60 * 1000 ||
            this._state.lastDesiccantBranchLogged !== branch;
        if (!shouldLog) return;
        this.log(`[DESICCANT] unit ${branch} raw=${JSON.stringify(raw)} -> ${days}d`);
        this._state.lastDesiccantBranchLogAt = now;
        this._state.lastDesiccantBranchLogged = branch;
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

    _normalizeSettingFromDevice(def, rawValue) {
        if (!def) return undefined;
        if (def.type === 'bool' || def.type === 'uint8_bool') {
            return fromMiotBool(rawValue);
        }
        if (def.type === 'number') {
            const num = toNumber(rawValue);
            if (!Number.isFinite(num)) return undefined;
            const [min, max] = def.range || [];
            const clamped = clampNumber(num, min, max);
            if (!Number.isFinite(clamped)) return undefined;
            return Math.round(clamped);
        }
        return undefined;
    }

    _serializeSettingForDevice(def, value) {
        if (!def) return undefined;
        if (def.type === 'bool') {
            return toMiotBoolInput(value, 'bool');
        }
        if (def.type === 'uint8_bool') {
            return toMiotBoolInput(value, 'uint8');
        }
        if (def.type === 'number') {
            const num = toNumber(value);
            if (!Number.isFinite(num)) return undefined;
            const [min, max] = def.range || [];
            const clamped = clampNumber(num, min, max);
            if (!Number.isFinite(clamped)) return undefined;
            return Math.round(clamped);
        }
        return undefined;
    }

    async _applySettingToDevice(key, value) {
        const def = IV2001_SETTING_PROPS[key];
        if (!def) return;
        if (!this.miio) throw new Error('miio not ready');

        const payload = this._serializeSettingForDevice(def, value);
        if (payload === undefined) throw new Error('invalid setting value');

        try {
            await this.miio.call(
                'set_properties',
                [
                    {
                        siid: def.siid,
                        piid: def.piid,
                        value: payload
                    }
                ],
                { retries: 1 }
            );
            this.log('[SETTINGS] apply', key, '->', payload);
        } catch (error) {
            const message = error?.message || error;
            this._warn('[SETTINGS] apply failed', key, message);
            throw error;
        }
    }
}

module.exports = PetFeederMiotDevice;


