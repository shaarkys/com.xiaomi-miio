'use strict';

/**
 * Pet Feeder MIoT (Wi-Fi)
 * Target model: xiaomi.feeder.iv2001
 *
 * Features:
 *  • Local hopper/bowl levels and feeder status
 *  • Food-out, stuck and heap statuses
 *  • Status (mode) text
 *  • Legacy feeder eaten-food and desiccant telemetry
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
    'xiaomi.feeder.iv2001': 'iv2001' // https://github.com/al-one/hass-xiaomi-miot/issues/2415#issuecomment-2727063411
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

const LEGACY_MIOT_PROPS = {
    eaten_food_today: { siid: 2, piid: 18 }, // daily eaten grams
    food_in_bowl: { siid: 4, piid: 6 }, // firmware-dependent; may be unsupported (-4001)
    food_out_status: { siid: 2, piid: 26 }, // FOOD_OUT_STATUS (0/1)
    food_out_progress: { siid: 5, piid: 11 }, // xiaomi-spec: food-out progress (%)
    heap_status: { siid: 2, piid: 15 }, // spec v2: heap/accumulation flag
    // Note: Legacy MIoT mappings are inconsistent; derive status from flags/progress.
    target_feeding_measure: { siid: 2, piid: 8 }, // FEEDING_MEASURE (often -4001 for read)
    target_feeding_measure_legacy: { siid: 2, piid: 7 }, // fallback (observed on some firmwares)
    desiccant_level: { siid: 6, piid: 1 }, // correct MIoT mapping (percent remaining)
    desiccant_time: { siid: 6, piid: 2 }, // correct MIoT mapping (days remaining, some firmware returns hours)
    schedule_progress: { siid: 5, piid: 15 }, // feeding schedule progress (%)
    refill_reminder: { siid: 5, piid: 16 } // optional: refill reminder flag / counter
};

const IV2001_MIOT_PROPS = {
    bowl_weight_sample: { siid: 2, piid: 22 }, // local weight sample used to derive consumed food
    food_stuck_status: { siid: 2, piid: 10 }, // food stuck status (0 normal, 1 abnormal)
    food_out_status: { siid: 2, piid: 11 }, // bowl/food-out abnormal status (0 normal, 1 abnormal)
    heap_status: { siid: 2, piid: 15 }, // food heap status (0 no, 1 yes)
    target_feeding_measure: { siid: 2, piid: 7 }, // target-feeding-measure
    feeding_measure: { siid: 2, piid: 8 }, // feeding-measure (action input)
    feeding_status: { siid: 2, piid: 26 }, // dispensing status (0 idle, 1 feeding)
    schedule_progress_alt: { siid: 2, piid: 29 }, // feeding schedule progress (%)
    bowl_level_status: { siid: 2, piid: 31 }, // bowl level (0 empty, 1 low, 2 normal)
    food_out_progress: { siid: 5, piid: 11 }, // food-out progress (%)
    schedule_progress: { siid: 5, piid: 15 }, // feeding schedule progress (%)
    screen_display_mode: { siid: 5, piid: 18 } // set-screen-display
};

const LEGACY_SETTING_PROPS = {
    child_lock: { siid: 3, piid: 1, type: 'bool' }, // physical-controls-locked
    auto_screen_off: { siid: 3, piid: 3, type: 'uint8_bool' }, // mode 0/1 (auto screen-off)
    display_schedule_progress: { siid: 5, piid: 4, type: 'bool' }, // plan-process-display
    low_food_intake_threshold: { siid: 5, piid: 5, type: 'number', range: [10, 90] }, // grams (10-90)
    low_food_consumption_notify: { siid: 5, piid: 6, type: 'bool' }, // food-intake-state
    empty_food_bowl_duration: { siid: 5, piid: 10, type: 'number', range: [6, 24] }, // add-meal-cycle hours
    dispensing_error_correction: { siid: 5, piid: 12, type: 'uint8_bool' }, // compensate-switch 0/1
    bowl_spillage_prevention: { siid: 5, piid: 14, type: 'uint8_bool' } // prevent-accumulation 0/1
};

const IV2001_SETTING_PROPS = {
    child_lock: { siid: 3, piid: 1, type: 'bool' }, // physical-controls-locked
    display_schedule_progress: { siid: 5, piid: 4, type: 'bool' }, // plan-process-display
    low_food_intake_threshold: { siid: 5, piid: 5, type: 'number', range: [10, 90] }, // food-intake-rate
    low_food_consumption_notify: { siid: 5, piid: 6, type: 'bool' }, // food-intake-state
    dispensing_error_correction: { siid: 5, piid: 12, type: 'uint8_bool' }, // compensate-switch
    bowl_spillage_prevention: { siid: 5, piid: 14, type: 'uint8_bool' } // prevent-accumulation
};

function resolveMiotProps(presetId) {
    return presetId === 'iv2001' ? IV2001_MIOT_PROPS : LEGACY_MIOT_PROPS;
}

function resolveSettingProps(presetId) {
    return presetId === 'iv2001' ? IV2001_SETTING_PROPS : LEGACY_SETTING_PROPS;
}

const MANUAL_FEED_PORTION_GRAMS = 5; // fallback grams per portion when target measure missing
const DESICCANT_FULL_DAYS = 30; // according to device UI (full pack lifetime)
const MANUAL_FEED_MAX_PORTIONS = 30;
const STORE_KEYS = {
    todaySnapshot: 'iv2001_today_snapshot'
};
const BOWL_DELTA_THRESHOLD = 0.5; // grams, ignore noise smaller than this
const PROGRESS_COMPLETE_THRESHOLD = 99.5; // treat >=99.5% as completed dispensing
const IV2001_MAX_CONSUMPTION_DELTA = 15; // ignore refills/removals and other large sample jumps
const DEFAULT_BOWL_LOW_THRESHOLD = 10;

const STATUS_INDICATOR_MIRRORS = {
    petfeeder_food_in_bowl: ['measure_petfeeder_food_in_bowl', (value) => value],
    petfeeder_eaten_food_today: ['measure_petfeeder_eaten_food_today', (value) => value],
    petfeeder_eaten_food_daily: ['measure_petfeeder_eaten_food_daily', (value) => value],
    petfeeder_food_out_progress: ['measure_petfeeder_food_out_progress', (value) => value],
    petfeeder_schedule_progress: ['measure_petfeeder_schedule_progress', (value) => value],
    petfeeder_foodlevel: ['alarm_petfeeder_container_food_low', (value) => value === 'low'],
    petfeeder_food_out_status: ['alarm_petfeeder_food_out', (value) => value === 'food_out'],
    petfeeder_food_stuck_status: ['alarm_petfeeder_food_stuck', (value) => value === 'stuck'],
    petfeeder_heap_status: ['alarm_petfeeder_heap', (value) => value === 'heap_detected'],
    petfeeder_bowl_level: ['alarm_petfeeder_bowl_food_low', (value) => value === 'empty' || value === 'low'],
    petfeeder_status_mode: ['alarm_petfeeder_fault', (value) => value === 'fault']
};


// Human-readable mode mapping (conservative)
const MODE_MAP = new Map([
    [0, 'idle'],
    [1, 'feeding'],
    [2, 'paused'],
    [3, 'fault']
]);

const FOODLEVEL_ENUM_VALUES = new Set(['0', '1']);
const FOODLEVEL_LABELS = new Map([
    ['0', 'normal'],
    ['1', 'low']
]);

const BOWL_LEVEL_LABELS = new Map([
    ['0', 'empty'],
    ['1', 'low'],
    ['2', 'normal']
]);

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
            this._miotProps = resolveMiotProps(this._presetId);
            this._settingProps = resolveSettingProps(this._presetId);

            // Ensure capabilities exist (upgrade-safe)
            await this._ensureCapabilities();

            // Settings defaults
            const s = this.getSettings() || {};
            const patch = {};
            if (typeof s.desiccant_alarm_threshold !== 'number') patch.desiccant_alarm_threshold = 20;
            if (typeof s.bowl_low_threshold !== 'number') patch.bowl_low_threshold = DEFAULT_BOWL_LOW_THRESHOLD;
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
            const ymdNow = this._ymdNow();
            const storedSnapshotRaw = this.getStoreValue(STORE_KEYS.todaySnapshot);
            const trackerSnapshot =
                storedSnapshotRaw && typeof storedSnapshotRaw === 'object'
                    ? {
                      ymd: typeof storedSnapshotRaw.ymd === 'string' ? storedSnapshotRaw.ymd : ymdNow,
                          value: toNumber(storedSnapshotRaw.value),
                          raw: toNumber(storedSnapshotRaw.raw),
                          lastDaily: toNumber(storedSnapshotRaw.lastDaily)
                      }
                    : { ymd: ymdNow, value: 0, raw: undefined, lastDaily: 0 };
            if (!Number.isFinite(trackerSnapshot.value)) trackerSnapshot.value = 0;
            if (!Number.isFinite(trackerSnapshot.lastDaily)) trackerSnapshot.lastDaily = 0;
            this._state = {
                once: new Set(),
                lastMode: 'unknown',
                targetFeedingMeasure: MANUAL_FEED_PORTION_GRAMS,
                suppressSettingApply: false,
                desiccantAlarm: this.getCapabilityValue('alarm_desiccant_low') === true,
                todayTracker: trackerSnapshot,
                pendingDuringDispense: 0,
                lastBowlGrams: Number.isFinite(toNumber(this.getCapabilityValue('petfeeder_food_in_bowl')))
                    ? Math.max(0, toNumber(this.getCapabilityValue('petfeeder_food_in_bowl')))
                    : undefined,
                estimatedBowl: Number.isFinite(toNumber(this.getCapabilityValue('petfeeder_food_in_bowl')))
                    ? Math.max(0, toNumber(this.getCapabilityValue('petfeeder_food_in_bowl')))
                    : undefined,
                lastProgressValue: undefined,
                lastProgressComplete: true,
                bowlUnsupported: false,
                progressActive: false,
                progressDose: undefined,
                lastDesiccantBranchLogAt: 0,
                lastDesiccantBranchLogged: undefined,
                lastDesiccantPct: undefined,
                lastDesiccantDays: undefined,
                lastDiagnosticSignature: undefined,
                lastDiagnosticLogAt: 0,
                lastTimeline: { excerpt: undefined, at: 0 }
            };

            if (this.hasCapability('petfeeder_serve_food')) {
                this.registerCapabilityListener('petfeeder_serve_food', async () => this.servePortions(1));
            }

            await this._syncEatenSetting(trackerSnapshot.value);

            // Read-only guard (prevents "Missing Capability Listener" warnings)
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
            this._restartPolling(pollSeconds, 1000);
        } catch (err) {
            this.error('[IV2001] onInit error:', err?.message || err);
        }
    }

    async onUninit() {
        try {
            if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
            if (this._initialPollTimer) this.homey.clearTimeout(this._initialPollTimer);
            this._pollGeneration = (this._pollGeneration || 0) + 1;
        } catch (_) {}
        if (super.onUninit) return super.onUninit();
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        try {
            if (!this._state) this._state = { suppressSettingApply: false };
            this._state.onSettingsActive = true;
            if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
                if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
                await this._initMiio();
                const pollSeconds = Math.max(5, Number(newSettings.polling) || Number(this.getSettings().polling) || 15);
                this._restartPolling(pollSeconds, 1000);
            }

            for (const key of changedKeys) {
                if (!Object.prototype.hasOwnProperty.call(this._settingProps || {}, key)) continue;
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

            if (changedKeys.includes('eaten_food_today_adjust')) {
                const adjustValue = toNumber(newSettings.eaten_food_today_adjust);
                if (Number.isFinite(adjustValue) && adjustValue >= 0) {
                    await this._applyManualEatenAdjust(adjustValue, true);
                } else if (adjustValue !== undefined) {
                    this._warn('[SETTINGS] invalid eaten_food_today_adjust value');
                }
            }

            if (changedKeys.includes('bowl_low_threshold')) {
                this.homey.setTimeout(() => this._pollOnce(), 0);
            }

        } catch (e) {
            this._warn('[IV2001] onSettings error:', e?.message);
        } finally {
            if (this._state) this._state.onSettingsActive = false;
        }
        return true;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Polling
    // ───────────────────────────────────────────────────────────────────────────

    _restartPolling(pollSeconds, initialDelayMs) {
        if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
        if (this._initialPollTimer) this.homey.clearTimeout(this._initialPollTimer);

        const normalizedSeconds = Math.max(5, Number(pollSeconds) || 15);
        this._pollMs = normalizedSeconds * 1000;
        this._pollGeneration = (this._pollGeneration || 0) + 1;
        const generation = this._pollGeneration;
        const poll = () => {
            if (generation !== this._pollGeneration) return;
            this._pollOnce();
        };

        this._pollTimer = this.homey.setInterval(poll, this._pollMs);
        if (Number.isFinite(initialDelayMs)) {
            this._initialPollTimer = this.homey.setTimeout(poll, Math.max(0, initialDelayMs));
        }
    }

    async _pollOnce() {
        if (this._polling) return;
        this._polling = true;

        try {
            if (!this.miio) {
                // Connection not ready yet; do not try to "fix" here. Base will init miio.
                this._onceWarn('[IV2001] miio not ready; skipping this poll');
                return;
            }

            const miotProps = this._miotProps || LEGACY_MIOT_PROPS;
            const settingProps = this._settingProps || LEGACY_SETTING_PROPS;

            // Build default read set
            const settingsReq = Object.entries(settingProps).map(([key, def]) => ({
                did: `setting_${key}`,
                siid: def.siid,
                piid: def.piid
            }));

            const req = [...BASE_GET_PROPS];
            const addProp = (did, def) => {
                if (!def) return;
                req.push({ did, siid: def.siid, piid: def.piid });
            };

            addProp('eaten_food_today', miotProps.eaten_food_today);
            addProp('eaten_food_today_alt', miotProps.eaten_food_today_alt);
            addProp('bowl_weight_sample', miotProps.bowl_weight_sample);
            addProp('food_in_bowl', miotProps.food_in_bowl);
            addProp('food_stuck_status', miotProps.food_stuck_status);
            addProp('food_out_status', miotProps.food_out_status);
            addProp('food_out_progress', miotProps.food_out_progress);
            addProp('heap_status', miotProps.heap_status);
            addProp('target_feeding_measure', miotProps.target_feeding_measure);
            addProp('target_feeding_measure_legacy', miotProps.target_feeding_measure_legacy);
            addProp('feeding_measure', miotProps.feeding_measure);
            addProp('feeding_status', miotProps.feeding_status);
            addProp('desiccant_level', miotProps.desiccant_level);
            addProp('desiccant_time', miotProps.desiccant_time);
            addProp('schedule_progress', miotProps.schedule_progress);
            addProp('schedule_progress_alt', miotProps.schedule_progress_alt);
            addProp('bowl_level_status', miotProps.bowl_level_status);
            addProp('food_intake_status', miotProps.food_intake_status);
            addProp('refill_reminder', miotProps.refill_reminder);
            addProp('screen_display_mode', miotProps.screen_display_mode);

            req.push(...settingsReq);

            const res = await this._safeGetProps(req);
            const got = this._indexResults(req, res);

            // Short one-time debug of available default props
            if (!this._state.once.has('debug_dump_defaults')) {
                const summary = Object.entries(got)
                    .filter(([, r]) => r && r.code === 0)
                    .map(([k, r]) => `${k}@${r.siid}/${r.piid}=${JSON.stringify(r.value)}`);
                if (summary.length > 0) {
                    this._state.once.add('debug_dump_defaults');
                    this.log('[DEBUG] available defaults:', summary.join(', '));
                }
            }

            this._logIv2001Diagnostics(got);

            // Publish values
            await this._updateFaultAndFoodLevel(got);
            await this._updateBowlAndStuck(got);
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
                const rawValue = String(f.value);
                if (!FOODLEVEL_ENUM_VALUES.has(rawValue)) {
                    this._onceWarn(`[FOODLEVEL] unexpected value: ${JSON.stringify(f.value)}`);
                }
                const mappedValue = FOODLEVEL_LABELS.get(rawValue) || 'unknown';
                await this._setCap('petfeeder_foodlevel', mappedValue);
            } else if (f && f.code === -4001) {
                this._onceWarn('[FOODLEVEL] unsupported (-4001)');
            }
        }
    }

    async _updateEatenFood(g) {
        const progressOutProp = g.food_out_progress;
        const scheduleProp = g.schedule_progress?.code === 0 ? g.schedule_progress : g.schedule_progress_alt;

        let dispensingProgress;
        if (progressOutProp && progressOutProp.code === 0) {
            const raw = toNumber(progressOutProp.value);
            if (Number.isFinite(raw)) dispensingProgress = clampNumber(raw, 0, 100);
        } else if (progressOutProp && progressOutProp.code === -4001) {
            this._onceWarn('[EATEN] food-out progress unsupported (-4001)');
        }

        let scheduleProgress;
        if (scheduleProp && scheduleProp.code === 0) {
            const raw = toNumber(scheduleProp.value);
            if (Number.isFinite(raw)) scheduleProgress = clampNumber(raw, 0, 100);
        } else if (scheduleProp && scheduleProp.code === -4001) {
            this._onceWarn('[EATEN] schedule progress unsupported (-4001)');
        }

        const feedingStatus = g.feeding_status;
        const feedingStatusValue = feedingStatus?.code === 0 ? toNumber(feedingStatus.value) : undefined;
        const progressComplete = Number.isFinite(feedingStatusValue)
            ? feedingStatusValue === 0
            : dispensingProgress === undefined || dispensingProgress >= PROGRESS_COMPLETE_THRESHOLD;
        const progressLabel = dispensingProgress === undefined ? 'n/a' : dispensingProgress.toFixed(1);

        if (this.hasCapability('petfeeder_food_out_progress') && typeof dispensingProgress === 'number') {
            await this._setCap('petfeeder_food_out_progress', Math.round(dispensingProgress));
        }
        if (this.hasCapability('petfeeder_schedule_progress') && typeof scheduleProgress === 'number') {
            await this._setCap('petfeeder_schedule_progress', Math.round(scheduleProgress));
        }
        if (this.hasCapability('petfeeder_busy')) {
            await this._setCap('petfeeder_busy', !progressComplete);
        }

        if (this._state) {
            this._state.lastProgressValue = dispensingProgress;
            this._state.lastProgressComplete = progressComplete;
        }

        if (this._presetId === 'iv2001') {
            await this._updateIv2001Consumption(g.bowl_weight_sample, progressComplete);
            return;
        }

        const miotEaten = (() => {
            const primary = g.eaten_food_today;
            const alt = g.eaten_food_today_alt;
            const pick = primary && primary.code === 0 ? primary : alt && alt.code === 0 ? alt : undefined;
            if (!pick) return undefined;
            const value = toNumber(pick.value);
            return Number.isFinite(value) ? Math.max(0, value) : undefined;
        })();

        const bowlProp = g.food_in_bowl;
        let bowl;
        let bowlSupported = false;
        if (bowlProp && bowlProp.code === 0) {
            const raw = toNumber(bowlProp.value);
            if (Number.isFinite(raw)) {
                bowl = Math.max(0, raw);
                bowlSupported = true;
                if (this._state) {
                    this._state.bowlUnsupported = false;
                    this._state.estimatedBowl = bowl;
                }
            }
        } else if (bowlProp && bowlProp.code === -4001) {
            this._onceWarn('[EATEN] bowl level unsupported (-4001)');
            if (this._state) this._state.bowlUnsupported = true;
        }
        if (!bowlSupported && this._state?.estimatedBowl !== undefined) {
            bowl = this._state.estimatedBowl;
        }

        if (this._state) {
            const progressActiveNow = !progressComplete;
            if (progressActiveNow) {
                if (!this._state.progressActive) {
                    this._state.progressActive = true;
                    if (this._state.bowlUnsupported) {
                        const expected = Number.isFinite(this._state.targetFeedingMeasure) && this._state.targetFeedingMeasure > 0
                            ? this._state.targetFeedingMeasure
                            : MANUAL_FEED_PORTION_GRAMS;
                        this._state.progressDose = expected;
                        this.log(`[EATEN] feed started (no bowl sensor), expect ${expected} g`);
                    }
                }
            } else if (this._state.progressActive) {
                if (this._state.bowlUnsupported && Number.isFinite(this._state.progressDose) && this._state.progressDose > 0) {
                    const existing = Number.isFinite(this._state.fallbackPending) ? this._state.fallbackPending : 0;
                    this._state.fallbackPending = existing + this._state.progressDose;
                    this.log(`[EATEN] feed finished (no bowl sensor) -> ${this._state.progressDose} g`);
                }
                this._state.progressActive = false;
                this._state.progressDose = undefined;
            }
        }

        if (bowlSupported && this.hasCapability('petfeeder_food_in_bowl') && typeof bowl === 'number') {
            await this._setCap('petfeeder_food_in_bowl', bowl);
        }

        const ymdNow = this._ymdNow();
        const prevTracker = this._state.todayTracker || { ymd: ymdNow, value: 0 };
        const tracker =
            prevTracker.ymd === ymdNow
                ? { ymd: prevTracker.ymd, value: Number.isFinite(prevTracker.value) ? prevTracker.value : 0 }
                : { ymd: ymdNow, value: 0 };

        const prevBowl = this._state.lastBowlGrams;
        let pending = Number.isFinite(this._state.pendingDuringDispense) ? this._state.pendingDuringDispense : 0;
        if (Number.isFinite(this._state?.fallbackPending) && this._state.fallbackPending > 0) {
            pending += this._state.fallbackPending;
            this._state.fallbackPending = 0;
        }
        let delta = 0;

        if (bowlSupported && typeof bowl === 'number' && typeof prevBowl === 'number') {
            const diff = prevBowl - bowl;
            if (diff > BOWL_DELTA_THRESHOLD) {
                if (progressComplete) {
                    delta += diff;
                } else {
                    pending += diff;
                    this.log(`[EATEN] queued ${diff.toFixed(1)} g while dispenser active (${progressLabel}%)`);
                }
            } else if (diff < -BOWL_DELTA_THRESHOLD) {
                const message = progressComplete
                    ? `[EATEN] bowl increased by ${Math.abs(diff).toFixed(1)} g with dispenser idle`
                    : `[EATEN] bowl increased by ${Math.abs(diff).toFixed(1)} g while dispenser active (${progressLabel}%)`;
                this.log(message);
            }
        } else if (bowlSupported && typeof bowl === 'number' && typeof prevBowl !== 'number') {
            this.log(`[EATEN] tracking bowl at ${bowl.toFixed(1)} g (progress ${progressLabel}%)`);
        }

        if (progressComplete && pending > 0) {
            delta += pending;
            this.log(`[EATEN] applied ${pending.toFixed(1)} g collected during dispensing`);
            pending = 0;
        }

        if (!Number.isFinite(tracker.value)) tracker.value = 0;
        tracker.value = Math.max(0, tracker.value + delta);

        const previousValue = Number.isFinite(prevTracker.value) ? prevTracker.value : 0;
        const todayChanged = tracker.ymd !== prevTracker.ymd || Math.abs(previousValue - tracker.value) > 0.1;
        if (todayChanged || delta > 0.01) {
            try {
                await this.setStoreValue(STORE_KEYS.todaySnapshot, tracker);
            } catch (_) {}
        }

        this._state.todayTracker = tracker;
        if (delta > 0 && this._state && this._state.bowlUnsupported) {
            const previousBowl = Number.isFinite(prevBowl)
                ? prevBowl
                : Number.isFinite(this._state.estimatedBowl)
                ? this._state.estimatedBowl
                : 0;
            const estimated = Math.max(0, previousBowl - delta);
            this._state.estimatedBowl = estimated;
            this._state.lastBowlGrams = estimated;
            if (this.hasCapability('petfeeder_food_in_bowl')) {
                const rounded = Math.round(estimated * 10) / 10;
                await this._setCap('petfeeder_food_in_bowl', Math.max(0, rounded));
            }
        }
        this._state.pendingDuringDispense = pending;
        if (bowlSupported && typeof bowl === 'number') {
            this._state.lastBowlGrams = bowl;
        } else if (this._state && this._state.estimatedBowl !== undefined) {
            this._state.lastBowlGrams = this._state.estimatedBowl;
        }

        const todayRounded = Math.round(tracker.value);
        if (this.hasCapability('petfeeder_eaten_food_today')) {
            await this._setCap('petfeeder_eaten_food_today', todayRounded);
        }

        await this._syncEatenSetting(todayRounded);

        if (delta > 0.1) {
            await this._triggerEatenChanged(todayRounded, delta);
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
        if (!this.hasCapability('petfeeder_status_mode')) return;

        const isFault = (() => {
            const err = g.error;
            if (err && err.code === 0) {
                const v = toNumber(err.value);
                if (Number.isFinite(v) && v !== 0) return true;
                if (typeof err.value !== 'undefined' && String(err.value) !== '0') return true;
            }
            const stuck = g.food_stuck_status;
            if (stuck && stuck.code === 0 && toNumber(stuck.value) === 1) return true;
            const out = g.food_out_status;
            if (out && out.code === 0 && toNumber(out.value) === 1) return true;
            return false;
        })();

        const isFeeding = (() => {
            if (this.getCapabilityValue('petfeeder_busy') === true) return true;

            const status = g.feeding_status;
            if (status && status.code === 0 && toNumber(status.value) === 1) return true;

            const progress = g.food_out_progress;
            if (progress && progress.code === 0) {
                const v = toNumber(progress.value);
                if (Number.isFinite(v) && v < PROGRESS_COMPLETE_THRESHOLD) return true;
            }
            return false;
        })();

        const text = isFault ? 'fault' : isFeeding ? 'feeding' : 'idle';
        const prev = this._state.lastMode;
        await this._setCap('petfeeder_status_mode', text);
        if (text !== prev) {
            await this._flow.feederStatusChanged?.trigger(this, { new_status: text, previous_status: prev || 'unknown' }, {});
            this.log('[MODE] change:', prev, '->', text);
            this._state.lastMode = text;
            await this._timeline(`Feeder status -> ${text}`);
        }
    }

    async _updateTargetFeedingMeasure(g) {
        const primary = g.target_feeding_measure;
        const legacy = g.target_feeding_measure_legacy;
        const pick = primary && primary.code === 0 ? primary : legacy && legacy.code === 0 ? legacy : undefined;
        if (!pick) return;

        const value = toNumber(pick.value);
        if (!Number.isFinite(value) || value <= 0) return;
        const normalized = Math.max(1, Math.round(value));
        if (this._state.targetFeedingMeasure !== normalized) {
            this._state.targetFeedingMeasure = normalized;
            this.log('[TARGET] feeding measure set to', normalized, 'g');
        }
    }

    async _syncSettingsFromMiot(g) {
        const patch = {};
        const settingProps = this._settingProps || LEGACY_SETTING_PROPS;
        for (const [key, def] of Object.entries(settingProps)) {
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
            const raw = toNumber(tim.value);
            if (Number.isFinite(raw)) {
                const normalized = normalizeDesiccantDays(raw);
                if (normalized) {
                    let computedDays = normalized.days;
                    if (normalized.branch === 'hours' && computedDays > DESICCANT_FULL_DAYS * 2) {
                        computedDays = Math.round(computedDays / 10);
                    } else if (normalized.branch === 'seconds' && computedDays > DESICCANT_FULL_DAYS * 2) {
                        computedDays = Math.round(computedDays / (24 * 10));
                    }
                    computedDays = clampNumber(computedDays, 0, 3650);
                    if (Number.isFinite(computedDays)) {
                        days = computedDays;
                        this._logDesiccantConversion(normalized.branch, raw, days);
                    }
                }
            }
        } else if (tim && tim.code === -4001) this._onceWarn('[DESICCANT] time unsupported (-4001)');

        if (typeof pct !== 'number' && typeof days === 'number') {
            const estimated = clampNumber((days / DESICCANT_FULL_DAYS) * 100, 0, 100);
            if (Number.isFinite(estimated)) {
                pct = Math.round(estimated);
            }
        }
        if (typeof days !== 'number' && typeof pct === 'number') {
            const estimatedDays = clampNumber((pct / 100) * DESICCANT_FULL_DAYS, 0, DESICCANT_FULL_DAYS);
            if (Number.isFinite(estimatedDays)) {
                days = Math.round(estimatedDays);
            }
        }

        if (typeof pct === 'number' && this.hasCapability('measure_desiccant')) {
            await this._setCap('measure_desiccant', pct);
            this._state.lastDesiccantPct = pct;
        }
        if (typeof days === 'number' && this.hasCapability('measure_desiccant_time')) {
            await this._setCap('measure_desiccant_time', days);
            this._state.lastDesiccantDays = days;
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
                    await this._timeline(`Desiccant low (${pct}%)`);
                } else {
                    this.log('[DESICCANT] alarm OFF at', pct, '% (>=', thr, ')');
                    await this._timeline(`Desiccant recovered (${pct}%)`);
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
            const batchCount = Math.ceil(requestArray.length / CHUNK_SIZE);
            for (let i = 0; i < requestArray.length; i += CHUNK_SIZE) {
                const batch = requestArray.slice(i, i + CHUNK_SIZE);
                const batchNumber = Math.floor(i / CHUNK_SIZE) + 1;
                const batchLabel = batch
                    .map((entry) => `${entry.did || 'property'}@${entry.siid}/${entry.piid}`)
                    .join(', ');
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
                    this._warn(
                        `[MIOT] get_properties batch ${batchNumber}/${batchCount} failed [${batchLabel}]:`,
                        e?.message
                    );
                    for (let k = 0; k < batch.length; k++) results.push({});
                }
            }
            return results;
        } catch (e) {
            this._warn('[MIOT] get_properties error:', e?.message);
            return [];
        }
    }

    async setDisplaySchedule(enabled) {
        const bool = enabled === true || enabled === 'true' || enabled === 1 || enabled === '1';
        await this._applySettingToDevice('display_schedule_progress', bool);
        try {
            this._state.suppressSettingApply = true;
            await this.updateSettingValue('display_schedule_progress', bool);
        } finally {
            this._state.suppressSettingApply = false;
        }
        return true;
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
            let result;
            if (this._presetId === 'iv2001') {
                const actionPayload = {
                    did: 'call-2-1',
                    siid: 2,
                    aiid: 1,
                    in: [{ piid: 8, value: grams }]
                };
                result = await this._callMiio('action', actionPayload, { retries: 1 }, 12000);
            } else {
                const propertyPayload = [
                    { siid: 2, piid: 8, value: grams }
                ];
                await this._callMiio('set_properties', propertyPayload, { retries: 1 }, 8000);
                const actionPayload = { siid: 2, aiid: 1, in: [] };
                result = await this._callMiio('action', actionPayload, { retries: 1 }, 12000);
            }
            this.log('[FEED] manual feed', { portions: count, grams, grams_per_portion: gramsPerPortion });
            await this._timeline(`Manual feed: ${count}x (${grams} g)`);
            return result;
        } catch (err) {
            const message = err?.message || err;
            this._warn('[FEED] manual feed error:', message);
            throw err;
        }
    }

    _logIv2001Diagnostics(g) {
        if (this._presetId !== 'iv2001' || !this._state) return;

        const diagnostics = [
            ['container_food_level', g.foodlevel],
            ['bowl_weight_sample', g.bowl_weight_sample],
            ['device_bowl_level', g.bowl_level_status],
            ['device_low_food_intake_threshold', g.setting_low_food_intake_threshold],
            ['feeding_status', g.feeding_status]
        ];
        const summary = diagnostics.map(([name, entry]) => {
            if (!entry) return `${name}=missing`;
            return `${name}@${entry.siid}/${entry.piid}{code=${entry.code},value=${JSON.stringify(entry.value)}}`;
        });
        summary.push(`local_bowl_low_threshold=${this._getBowlLowThreshold()}g`);
        const signature = summary.join('|');
        const now = Date.now();
        const shouldLog =
            signature !== this._state.lastDiagnosticSignature ||
            now - (this._state.lastDiagnosticLogAt || 0) >= 60 * 60 * 1000;
        if (!shouldLog) return;

        this.log('[DIAG] feeder local values:', summary.join(', '));
        this._state.lastDiagnosticSignature = signature;
        this._state.lastDiagnosticLogAt = now;
    }

    async _updateIv2001Consumption(sample, dispenserIdle) {
        const ymdNow = this._ymdNow();
        const previous = this._state.todayTracker || { ymd: ymdNow, value: 0 };
        const tracker = {
            ymd: previous.ymd,
            value: Number.isFinite(previous.value) ? previous.value : 0,
            raw: Number.isFinite(previous.raw) ? previous.raw : undefined,
            lastDaily: Number.isFinite(previous.lastDaily) ? previous.lastDaily : 0
        };

        let changed = false;
        if (tracker.ymd !== ymdNow) {
            tracker.lastDaily = Math.max(0, Math.round(tracker.value));
            tracker.ymd = ymdNow;
            tracker.value = 0;
            changed = true;
            await this._setCap('petfeeder_eaten_food_daily', tracker.lastDaily);
            await this._setCap('petfeeder_eaten_food_today', 0);
            this.log('[EATEN] daily rollover:', tracker.lastDaily, 'g');
        }

        if (sample && sample.code === 0) {
            const raw = toNumber(sample.value);
            if (Number.isFinite(raw) && raw >= 0) {
                if (Number.isFinite(tracker.raw)) {
                    const delta = tracker.raw - raw;
                    if (dispenserIdle && delta > 0 && delta < IV2001_MAX_CONSUMPTION_DELTA) {
                        tracker.value += delta;
                        changed = true;
                        await this._triggerEatenChanged(tracker.value, delta);
                    } else if (delta >= IV2001_MAX_CONSUMPTION_DELTA) {
                        this.log('[EATEN] ignored large sample drop:', delta, 'g');
                    }
                }
                if (tracker.raw !== raw) changed = true;
                tracker.raw = raw;
            }
        } else if (sample && sample.code === -4001) {
            this._onceWarn('[EATEN] local weight sample unsupported (-4001)');
        }

        const today = Math.max(0, Math.round(tracker.value));
        await this._setCap('petfeeder_eaten_food_today', today);
        await this._setCap('petfeeder_eaten_food_daily', tracker.lastDaily);
        await this._syncEatenSetting(today);

        this._state.todayTracker = tracker;
        if (changed) {
            try {
                await this.setStoreValue(STORE_KEYS.todaySnapshot, tracker);
            } catch (_) {}
        }
    }

    async _updateBowlAndStuck(g) {
        if (this.hasCapability('petfeeder_bowl_level')) {
            const weightSample = g.bowl_weight_sample;
            const weight = weightSample?.code === 0 ? toNumber(weightSample.value) : undefined;
            if (Number.isFinite(weight) && weight >= 0) {
                const normalizedWeight = Math.round(weight * 10) / 10;
                const threshold = this._getBowlLowThreshold();
                const mapped = normalizedWeight <= 0 ? 'empty' : normalizedWeight < threshold ? 'low' : 'normal';
                await this._setCap('petfeeder_food_in_bowl', normalizedWeight);
                await this._setCap('petfeeder_bowl_level', mapped);
            } else {
                const bowl = g.bowl_level_status;
                if (bowl && bowl.code === 0 && typeof bowl.value !== 'undefined') {
                    const mapped = BOWL_LEVEL_LABELS.get(String(bowl.value)) || 'unknown';
                    if (mapped === 'unknown') {
                        this._onceWarn(`[BOWL] unexpected value: ${JSON.stringify(bowl.value)}`);
                    }
                    await this._setCap('petfeeder_bowl_level', mapped);
                } else if (bowl && bowl.code === -4001) {
                    this._onceWarn('[BOWL] level unsupported (-4001)');
                }
            }
            if (weightSample && weightSample.code === -4001) {
                this._onceWarn('[BOWL] weight sample unsupported (-4001)');
            } else if (weightSample && weightSample.code === 0 && !Number.isFinite(weight)) {
                this._onceWarn(`[BOWL] unexpected weight: ${JSON.stringify(weightSample.value)}`);
            }
        }

        const stuck = g.food_stuck_status;
        if (this.hasCapability('petfeeder_food_stuck_status')) {
            if (stuck && stuck.code === 0) {
                const value = toNumber(stuck.value);
                const mapped = value === 0 ? 'ok' : value === 1 ? 'stuck' : 'unknown';
                if (mapped === 'unknown') this._onceWarn(`[STUCK] unexpected value: ${JSON.stringify(stuck.value)}`);
                await this._setCap('petfeeder_food_stuck_status', mapped);
            } else if (stuck && stuck.code === -4001) {
                this._onceWarn('[STUCK] unsupported (-4001)');
            }
        }
    }

    _getBowlLowThreshold() {
        const configured = toNumber(this.getSetting('bowl_low_threshold'));
        return Number.isFinite(configured) ? clampNumber(configured, 1, 150) : DEFAULT_BOWL_LOW_THRESHOLD;
    }

    async calibrateScale() {
        if (!this.miio) throw new Error('miio not ready');
        if (this._presetId !== 'iv2001') throw new Error('Calibration not supported by this device');
        return this._callMiio('action', { siid: 2, aiid: 2, in: [] }, { retries: 1 }, 12000);
    }

    async _callMiio(method, params, options, timeoutMs = 8000) {
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
            const updates = [[cap, value]];
            const mirror = STATUS_INDICATOR_MIRRORS[cap];
            if (mirror && this.hasCapability(mirror[0])) {
                updates.push([mirror[0], mirror[1](value)]);
            }
            for (const [capabilityId, capabilityValue] of updates) {
                const cur = this.getCapabilityValue(capabilityId);
                if (cur === capabilityValue) continue;
                try {
                    await this.setCapabilityValue(capabilityId, capabilityValue);
                } catch (e) {
                    const expectsString = /expected string|InvalidTypeError/i.test(String(e?.message || ''));
                    if (expectsString && typeof capabilityValue !== 'string') {
                        await this.setCapabilityValue(capabilityId, String(capabilityValue));
                    } else {
                        throw e;
                    }
                }
                this.log('[CAP]', capabilityId, '=', capabilityValue);
            }
        } catch (e) {
            this._warn('[CAP] set error', cap, e?.message);
        }
    }

    async _timeline(excerpt, data) {
        try {
            if (!excerpt || !this.homey?.notifications?.createNotification) return;
            const now = Date.now();
            const last = this._state.lastTimeline || {};
            if (last.excerpt === excerpt && now - (last.at || 0) < 60 * 1000) return;
            await this.homey.notifications.createNotification({ excerpt, data });
            this._state.lastTimeline = { excerpt, at: now };
        } catch (e) {
            this._warn('[TIMELINE] notification failed', e?.message);
        }
    }

    async _triggerEatenChanged(todayG, deltaG) {
        try {
            const todayValue = Number.isFinite(todayG) ? Math.round(todayG) : 0;
            const deltaValue = Number.isFinite(deltaG) ? Math.round(deltaG) : 0;
            await this._flow.eatenFoodChanged?.trigger(
                this,
                {
                    today_g: todayValue,
                    total_g: todayValue,
                    delta_g: deltaValue
                },
                {}
            );
            this.log('[EATEN] trigger:', { today_g: todayValue, delta_g: deltaValue });
        } catch (e) {
            this._warn('[EATEN] trigger error:', e?.message);
        }
    }

    async _applyManualEatenAdjust(value, skipSettingSync = false) {
        const ymdNow = this._ymdNow();
        const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
        const previous = this._state.todayTracker || {};
        const tracker = {
            ymd: ymdNow,
            value: normalized,
            raw: Number.isFinite(previous.raw) ? previous.raw : undefined,
            lastDaily: Number.isFinite(previous.lastDaily) ? previous.lastDaily : 0
        };
        this._state.todayTracker = tracker;
        this._state.pendingDuringDispense = 0;
        try {
            await this.setStoreValue(STORE_KEYS.todaySnapshot, tracker);
        } catch (_) {}
        if (this.hasCapability('petfeeder_eaten_food_today')) {
            await this._setCap('petfeeder_eaten_food_today', normalized);
        }
        this.log('[EATEN] manual correction applied', normalized, 'g');
        if (!skipSettingSync) {
            await this._syncEatenSetting(normalized);
        }
    }

    async _syncEatenSetting(value) {
        if (!this._state) return;
        if (this._state.suppressSettingApply) return;
        if (this._state.onSettingsActive) return;
        const settings = this.getSettings() || {};
        const currentRaw = toNumber(settings.eaten_food_today_adjust);
        const target = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
        const currentNormalized = Number.isFinite(currentRaw) ? Math.max(0, Math.round(currentRaw)) : 0;
        if (currentNormalized === target) return;
        try {
            this._state.suppressSettingApply = true;
            await this.updateSettingValue('eaten_food_today_adjust', target);
        } catch (e) {
            this._warn('[SETTINGS] sync eaten value failed', e?.message);
        } finally {
            this._state.suppressSettingApply = false;
        }
    }

    _onceWarn(msg) {
        if (!this._state.once.has(msg)) {
            this._state.once.add(msg);
            this._warn(msg);
        }
    }

    _ymdNow() {
        try {
            const timeZone = this.homey?.clock?.getTimezone?.();
            if (timeZone) {
                const parts = new Intl.DateTimeFormat('en', {
                    timeZone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).formatToParts(new Date());
                const part = (type) => parts.find((item) => item.type === type)?.value;
                const year = part('year');
                const month = part('month');
                const day = part('day');
                if (year && month && day) return `${year}-${month}-${day}`;
            }
        } catch (_) {}
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
        const required = [
            'petfeeder_serve_food',
            'petfeeder_foodlevel',
            'petfeeder_food_out_status',
            'petfeeder_food_out_progress',
            'petfeeder_heap_status',
            'petfeeder_status_mode',
            'petfeeder_busy',
            'petfeeder_schedule_progress',
            'measure_petfeeder_food_in_bowl',
            'measure_petfeeder_eaten_food_today',
            'measure_petfeeder_food_out_progress',
            'measure_petfeeder_schedule_progress',
            'alarm_petfeeder_container_food_low',
            'alarm_petfeeder_food_out',
            'alarm_petfeeder_heap',
            'alarm_petfeeder_fault'
        ];
        if (this._presetId === 'iv2001') {
            required.push(
                'petfeeder_bowl_level',
                'petfeeder_food_stuck_status',
                'petfeeder_food_in_bowl',
                'petfeeder_eaten_food_today',
                'petfeeder_eaten_food_daily',
                'measure_petfeeder_eaten_food_daily',
                'alarm_petfeeder_food_stuck',
                'alarm_petfeeder_bowl_food_low'
            );
        } else {
            required.push(
                'petfeeder_eaten_food_today',
                'petfeeder_food_in_bowl',
                'measure_desiccant',
                'measure_desiccant_time',
                'alarm_desiccant_low'
            );
        }
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

        if (this._presetId === 'iv2001') {
            for (const id of [
                'measure_desiccant',
                'measure_desiccant_time',
                'alarm_desiccant_low'
            ]) {
                try {
                    if (this.hasCapability(id)) {
                        await this.removeCapability(id);
                        this.log('[INIT] removed non-local capability:', id);
                    }
                } catch (e) {
                    this._warn('[INIT] removeCapability failed', id, e?.message);
                }
            }
        } else {
            for (const id of [
                'petfeeder_bowl_level',
                'petfeeder_food_stuck_status',
                'petfeeder_eaten_food_daily',
                'measure_petfeeder_eaten_food_daily',
                'alarm_petfeeder_food_stuck',
                'alarm_petfeeder_bowl_food_low'
            ]) {
                try {
                    if (this.hasCapability(id)) {
                        await this.removeCapability(id);
                        this.log('[INIT] removed iv2001-only capability:', id);
                    }
                } catch (e) {
                    this._warn('[INIT] removeCapability failed', id, e?.message);
                }
            }
        }

        if (this.hasCapability('petfeeder_eaten_food_total')) {
            try {
                await this.removeCapability('petfeeder_eaten_food_total');
                this.log('[INIT] removed capability:', 'petfeeder_eaten_food_total');
            } catch (e) {
                this._warn('[INIT] removeCapability failed', 'petfeeder_eaten_food_total', e?.message);
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
        const def = (this._settingProps || LEGACY_SETTING_PROPS)[key];
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
