'use strict';

/**
 * MIoT profile and pure helpers for the Xiaomi Smart Pet Fountain 2
 * (xiaomi.pet_waterer.iv02).
 *
 * The `did` field in the profile is a semantic identifier used by the
 * driver.  MIoT requests must replace it with the physical DID of the
 * connected miio device before they are sent over the wire.
 */

const MODEL_ID = 'xiaomi.pet_waterer.iv02';

const MODES = Object.freeze({
    0: 'Auto',
    1: 'Interval',
    2: 'Constant'
});

const CHARGING_STATES = Object.freeze({
    0: 'Not charging',
    1: 'Charging',
    2: 'Fully charged'
});

const INTERVAL_RANGE = Object.freeze({
    min: 10,
    max: 120,
    step: 5
});

const IV02_PROFILE = Object.freeze({
    model: MODEL_ID,
    // Keep the original 2.7 property in the model profile for older
    // revisions, while the device UI uses the revision-2 2.11 property.
    get_properties: Object.freeze([
        Object.freeze({ did: 'onoff', siid: 2, piid: 1 }),
        Object.freeze({ did: 'fault', siid: 2, piid: 2 }),
        Object.freeze({ did: 'status', siid: 2, piid: 3 }),
        Object.freeze({ did: 'mode', siid: 2, piid: 4 }),
        Object.freeze({ did: 'out_water_interval_15', siid: 2, piid: 7 }),
        Object.freeze({ did: 'water_shortage_status', siid: 2, piid: 10 }),
        Object.freeze({ did: 'out_water_interval', siid: 2, piid: 11 }),
        Object.freeze({ did: 'filter_life_level', siid: 3, piid: 1 }),
        Object.freeze({ did: 'filter_left_time', siid: 3, piid: 2 }),
        Object.freeze({ did: 'child_lock', siid: 4, piid: 1 }),
        Object.freeze({ did: 'battery_level', siid: 5, piid: 1 }),
        Object.freeze({ did: 'charging_state', siid: 5, piid: 2 }),
        Object.freeze({ did: 'no_disturb', siid: 6, piid: 1 }),
        Object.freeze({ did: 'low_battery', siid: 9, piid: 5 }),
        Object.freeze({ did: 'usb_insert_state', siid: 9, piid: 6 }),
        Object.freeze({ did: 'pump_block_flag', siid: 9, piid: 12 })
    ]),
    set_properties: Object.freeze({
        onoff: Object.freeze({ siid: 2, piid: 1 }),
        mode: Object.freeze({ siid: 2, piid: 4 }),
        out_water_interval: Object.freeze({ siid: 2, piid: 11 }),
        child_lock: Object.freeze({ siid: 4, piid: 1 }),
        no_disturb: Object.freeze({ siid: 6, piid: 1 })
    }),
    actions: Object.freeze({
        reset_filter_life: Object.freeze({ did: 'call-3-1', siid: 3, aiid: 1, in: Object.freeze([]) })
    })
});

const MODEL_MAPPING = Object.freeze({
    [MODEL_ID]: 'mapping_iv02'
});

const PROFILES = Object.freeze({
    mapping_iv02: IV02_PROFILE
});

function getModelProfile(model) {
    return PROFILES[MODEL_MAPPING[model]] || IV02_PROFILE;
}

function getPropertyDefinition(profile, semanticId) {
    if (!profile || !Array.isArray(profile.get_properties)) return undefined;
    return profile.get_properties.find((property) => property.did === semanticId);
}

function isValidMiotResult(result) {
    return Boolean(result)
        && result.code === 0
        && result.value !== null
        && result.value !== undefined;
}

/** Resolve a result by MIoT coordinates, never by the semantic/physical DID. */
function findValidPropertyResult(results, definition) {
    if (!Array.isArray(results) || !definition) return undefined;
    return results.find((result) => result
        && result.siid === definition.siid
        && result.piid === definition.piid
        && isValidMiotResult(result));
}

/** Build a get/set payload using the connected physical MIoT device DID. */
function buildPropertyPayload(definitions, connectedDid, values) {
    if (!Array.isArray(definitions)) throw new TypeError('MIoT property definitions must be an array');
    if (connectedDid === undefined || connectedDid === null || connectedDid === '') {
        throw new Error('MIoT property payload requires a connected device ID');
    }

    const did = String(connectedDid);
    return definitions.map((definition, index) => {
        const payload = {
            did,
            siid: definition.siid,
            piid: definition.piid
        };
        if (values !== undefined) {
            payload.value = Array.isArray(values) ? values[index] : values;
        }
        return payload;
    });
}

function buildSetPropertyPayload(definition, connectedDid, value) {
    return buildPropertyPayload([definition], connectedDid, [value])[0];
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
    }
    return undefined;
}

function validateInterval(value) {
    const interval = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(interval)
        || interval < INTERVAL_RANGE.min
        || interval > INTERVAL_RANGE.max
        || (interval - INTERVAL_RANGE.min) % INTERVAL_RANGE.step !== 0) {
        throw new RangeError(`out_water_interval must be an integer from ${INTERVAL_RANGE.min} to ${INTERVAL_RANGE.max} in steps of ${INTERVAL_RANGE.step}`);
    }
    return interval;
}

function validateMode(value) {
    const mode = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(mode) || !Object.prototype.hasOwnProperty.call(MODES, mode)) {
        throw new RangeError('petwaterdispenser_mmgg_mode_3 must be one of 0, 1, or 2');
    }
    return mode;
}

/** Map the two MIoT alarm properties to their Homey capabilities. */
function mapAlarmCapabilities(results, profile = IV02_PROFILE) {
    const shortage = findValidPropertyResult(results, getPropertyDefinition(profile, 'water_shortage_status'));
    const pumpBlock = findValidPropertyResult(results, getPropertyDefinition(profile, 'pump_block_flag'));
    const mapped = {};
    if (shortage) {
        const value = normalizeBoolean(shortage.value);
        if (value !== undefined) {
            mapped.alarm_tank_empty = value;
            mapped.alarm_water_shortage = value;
        }
    }
    if (pumpBlock) {
        const value = normalizeBoolean(pumpBlock.value);
        if (value !== undefined) mapped.alarm_pump_supply = value;
    }
    return mapped;
}

module.exports = {
    MODEL_ID,
    MODEL_MAPPING,
    PROFILES,
    IV02_PROFILE,
    MODES,
    CHARGING_STATES,
    INTERVAL_RANGE,
    getModelProfile,
    getPropertyDefinition,
    isValidMiotResult,
    findValidPropertyResult,
    buildPropertyPayload,
    buildSetPropertyPayload,
    normalizeBoolean,
    validateInterval,
    validateMode,
    mapAlarmCapabilities
};
