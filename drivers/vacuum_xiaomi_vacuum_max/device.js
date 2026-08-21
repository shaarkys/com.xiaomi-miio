'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.vacuum.d109gl // Xiaomi Robot Vacuum X20 Max
// https://home.miot-spec.com/spec/xiaomi.vacuum.d102gl // Xiaomi Robot Vacuum X20 Pro  (original mapping kept)
// https://home.miot-spec.com/spec/xiaomi.vacuum.d101 // Xiaomi Robot Vacuum H40 Chinese
// https://home.miot-spec.com/spec/xiaomi.vacuum.c102gl // Xiaomi Robot Vacuum X20 / X20+
// https://home.miot-spec.com/spec/xiaomi.vacuum.b108gl // Xiaomi Robot Vacuum S20+
// https://home.miot-spec.com/spec/xiaomi.vacuum.ov51gl // Xiaomi Robot Vacuum H40
// https://home.miot-spec.com/spec/xiaomi.vacuum.ov71gl // Xiaomi Robot Vacuum S40 Pro
// https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:vacuum:0000A006:xiaomi-c108:1 // Xiaomi Robot Vacuum E5
/** ------------------------------------------------------------------
 *  Shared constants (hoisted)
 *  ------------------------------------------------------------------ */
const ERROR_CODES = {
    0: 'OK',
    1: 'Left-wheel-error',
    2: 'Right-wheel-error',
    3: 'Cliff-error',
    4: 'Low-battery-error',
    5: 'Bump-error',
    6: 'Main-brush-error',
    7: 'Side-brush-error',
    8: 'Fan-motor-error',
    9: 'Dustbin-error',
    10: 'Charging-error',
    11: 'No-water-error',
    12: 'Pick-up-error',
    100008: 'OK / Busy',
    210030: 'Water tank empty',
    210004: 'Stuck-error',
    210002: 'Wheel-error',
    210013: 'Dustbin-error',
    210050: 'No-water-error',
    320002: 'Cliff-error'
};

const STATUS_MAPPING = {
    cleaning: [4, 7, 8, 10, 12, 16, 17, 19],
    spot_cleaning: [],
    docked: [9, 11, 14, 68], // 68 observed on your X20+ as "docked"
    charging: [2, 6, 13, 21],
    stopped: [1, 3, 5, 18, 20],
    stopped_error: [15]
};

// c102gl status values (observed on MIoT driver variant)
const STATUS_MAPPING_C102 = {
    cleaning: [1, 5, 7, 8, 9, 10, 12],
    spot_cleaning: [],
    docked: [0, 11, 13, 14, 19],
    charging: [6],
    stopped: [2, 3, 21, 22, 23],
    stopped_error: [4]
};

const STATUS_MAPPING_B108GL = {
    cleaning: [4, 7, 9],
    spot_cleaning: [],
    docked: [8],
    charging: [2, 3, 6],
    stopped: [1, 5, 10],
    stopped_error: []
};

const STATUS_MAPPING_C108 = {
    cleaning: [2],
    spot_cleaning: [],
    docked: [7],
    charging: [5, 6],
    stopped: [1, 3],
    stopped_error: [4]
};

const ERROR_CODES_C108 = {
    0: 'No Faults',
    1: 'Left Wheel Stuck',
    2: 'Right Wheel Stuck',
    3: 'Front Bumper Stuck',
    4: 'Side Brush Stuck',
    5: 'Anti-drop Sensor',
    6: 'Wheel Suspended',
    7: 'Fan Error',
    8: 'Battery Low',
    9: 'Charging Error',
    10: 'Machine Trapped',
    11: 'Left Wheel Error',
    12: 'Right Wheel Error',
    13: 'Side Brush Error',
    14: 'Battery Error',
    15: 'Ground Slope'
};

const STATUS_MAPPING_D101 = {
    cleaning: [4, 7, 8, 10, 12, 16, 17, 19, 22],
    spot_cleaning: [],
    docked: [9, 11, 14, 23],
    charging: [2, 3, 6, 13, 21, 24],
    stopped: [1, 5, 18, 20],
    stopped_error: [15]
};

const X20_RAW_STATUS_NAMES = {
    1: 'Standby',
    2: 'Charging',
    3: 'Charging for resume-clean',
    4: 'Working',
    5: 'Paused',
    6: 'Returning to charger',
    7: 'Washing mop',
    8: 'Remote control',
    9: 'Fully charged',
    10: 'Mapping',
    11: 'Updating',
    12: 'Base station working',
    13: 'Returning to charger',
    14: 'Base station working',
    15: 'Error',
    16: 'Sweep & mop',
    17: 'Mopping',
    18: 'Mapping paused',
    19: 'Resume-clean return',
    20: 'Mid-job return to base',
    21: 'Mapping return to charger'
};

const X20_BASE_STATION_MODE_NAMES = {
    0: 'Idle',
    1: 'Drying',
    2: 'Dust collection',
    3: 'Mop washing'
};

const BASE_STATION_STATUS_CAPABILITY = 'vacuum_xiaomi_base_station_status';
const X20_RAW_STATUS_MODELS = Object.freeze(['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl']);
const BASE_STATION_STATUS_MODELS = Object.freeze([
    'xiaomi.vacuum.d102gl',
    'xiaomi.vacuum.d109gl',
    'xiaomi.vacuum.ov51gl',
    'xiaomi.vacuum.c102gl'
]);
const PIID18_BASE_STATION_STATUS_MODELS = Object.freeze(['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl', 'xiaomi.vacuum.ov51gl']);
const C102_IDLE_BASE_STATION_STATUS_CODES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 19, 21, 23]);
const CUSTOM_CLEANUP_DIAGNOSTIC_MODELS = Object.freeze(['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl', 'xiaomi.vacuum.ov51gl']);
const CUSTOM_CLEANUP_DIAGNOSTIC_PROPERTIES = Object.freeze([
    Object.freeze({ did: 'user_define_sweep_cfg', siid: 2, piid: 42 }),
    Object.freeze({ did: 'user_define_sweep_id', siid: 2, piid: 43 })
]);
const CUSTOM_CLEANUP_DIAGNOSTIC_ACTION = Object.freeze({
    did: 'call-20-2',
    siid: 20,
    aiid: 2,
    in: Object.freeze([Object.freeze({ piid: 2, value: 0 })])
});
const CUSTOM_CLEANUP_START_PROPERTIES = Object.freeze([
    Object.freeze({ did: 'user_define_sweep_cfg', siid: 2, piid: 42 })
]);
const CUSTOM_CLEANUP_START_ACTION = Object.freeze({
    did: 'call-2-42',
    siid: 2,
    aiid: 42,
    in: Object.freeze([Object.freeze({ piid: 43 })])
});
const CUSTOM_CLEANUP_DIAGNOSTIC_SAFE_KEYS = new Set([
    'action',
    'aiid',
    'code',
    'count',
    'data',
    'did',
    'error',
    'errors',
    'failed',
    'id',
    'in',
    'index',
    'items',
    'length',
    'list',
    'method',
    'out',
    'params',
    'piid',
    'properties',
    'property',
    'result',
    'results',
    'service',
    'siid',
    'state',
    'status',
    'success',
    'total',
    'type',
    'value',
    'version'
]);
const CUSTOM_CLEANUP_DIAGNOSTIC_LIMITS = Object.freeze({
    arrayEntries: 24,
    depth: 6,
    jsonDecodes: 12,
    objectKeys: 24,
    rawStringLength: 4096,
    serializedLength: 3500
});
const CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS = Object.freeze({
    candidateIds: 8,
    catalogArrays: 4,
    catalogRecords: 32,
    jsonDecodes: 2,
    propertyResponseItems: 24,
    rawStringLength: 4096,
    topLevelProperties: 16
});

function createBaseStationActionDescriptor(aiid) {
    return Object.freeze({ siid: 2, aiid, did: `call-2-${aiid}`, in: Object.freeze([]) });
}

const BASE_STATION_ACTION_DESCRIPTORS = Object.freeze({
    'xiaomi.vacuum.d102gl': Object.freeze({
        start_dust_collection: createBaseStationActionDescriptor(18),
        start_mop_washing: createBaseStationActionDescriptor(19),
        stop_mop_washing: createBaseStationActionDescriptor(31),
        start_drying: createBaseStationActionDescriptor(20),
        stop_drying: createBaseStationActionDescriptor(32)
    }),
    'xiaomi.vacuum.d109gl': Object.freeze({
        start_dust_collection: createBaseStationActionDescriptor(18),
        start_mop_washing: createBaseStationActionDescriptor(19),
        stop_mop_washing: createBaseStationActionDescriptor(31),
        start_drying: createBaseStationActionDescriptor(20),
        stop_drying: createBaseStationActionDescriptor(32)
    }),
    'xiaomi.vacuum.c102gl': Object.freeze({
        start_dust_collection: createBaseStationActionDescriptor(4),
        start_mop_washing: createBaseStationActionDescriptor(6),
        start_drying: createBaseStationActionDescriptor(8),
        stop_drying: createBaseStationActionDescriptor(9)
    }),
    'xiaomi.vacuum.ov51gl': Object.freeze({
        start_dust_collection: createBaseStationActionDescriptor(18)
    })
});

function isSupportedX20Model(model) {
    return X20_RAW_STATUS_MODELS.includes(model);
}

function isSupportedBaseStationStatusModel(model) {
    return BASE_STATION_STATUS_MODELS.includes(model);
}

function usesPiid18BaseStationStatus(model) {
    return PIID18_BASE_STATION_STATUS_MODELS.includes(model);
}

function isCustomCleanupDiagnosticModel(model) {
    return CUSTOM_CLEANUP_DIAGNOSTIC_MODELS.includes(model);
}

function getCustomCleanupDiagnosticOwnDataDescriptor(value, property) {
    if (!value || typeof value !== 'object') return null;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, property);
        return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor : null;
    } catch (_) {
        return null;
    }
}

function getCustomCleanupDiagnosticOwnDataValue(value, property) {
    const descriptor = getCustomCleanupDiagnosticOwnDataDescriptor(value, property);
    return descriptor ? descriptor.value : undefined;
}

function getCustomCleanupDiagnosticArrayLength(value) {
    if (!Array.isArray(value)) return 0;
    const length = getCustomCleanupDiagnosticOwnDataValue(value, 'length');
    return Number.isSafeInteger(length) && length >= 0 ? length : 0;
}

function decodeCustomCleanupDiagnosticCatalog(value) {
    let decoded = value;
    for (let count = 0; count < CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.jsonDecodes && typeof decoded === 'string'; count += 1) {
        if (decoded.length > CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.rawStringLength) return undefined;
        try {
            decoded = JSON.parse(decoded);
        } catch (_) {
            return undefined;
        }
    }
    return typeof decoded === 'string' ? undefined : decoded;
}

function getDeviceModelIdentifier(device) {
    if (!device) return undefined;
    try {
        return typeof device.getModelIdentifier === 'function' ? device.getModelIdentifier() : device._model;
    } catch (_) {
        return device._model;
    }
}

/** Model → property-set */
const mapping = {
    'xiaomi.vacuum.d109gl': 'properties_d109gl',
    'xiaomi.vacuum.d102gl': 'properties_d109gl', // unchanged — you said it’s flawless
    'xiaomi.vacuum.d101': 'properties_d101',
    'xiaomi.vacuum.d101gl': 'properties_d101',
    'xiaomi.vacuum.ov51gl': 'properties_d101',
    'xiaomi.vacuum.ov71gl': 'properties_d101',
    'xiaomi.vacuum.c102gl': 'properties_c102gl', // X20 / X20+ specific minimal + room action change
    'xiaomi.vacuum.b108gl': 'properties_b108gl',
    'xiaomi.vacuum.c108': 'properties_c108'
};

/* Some MIoT vacuums time out on a large single-shot get_properties batch
 * even though the connection is healthy and every property returns fine
 * individually (confirmed on the X20 Pro / d102gl, which fails on its
 * full 22-property batch but works reliably when split into per-property
 * reads). Chunk size 1 is the value actually validated against that
 * hardware; other mappings default to a conservative 5 as a precaution
 * since large single-shot reads are the same shape of risk even without
 * a confirmed report yet. */
const GET_PROPERTIES_CHUNK_SIZE = {
    'xiaomi.vacuum.d102gl': 1
};
const DEFAULT_GET_PROPERTIES_CHUNK_SIZE = 5;
const GET_PROPERTIES_CHUNK_DELAY_MS = 100;
const ROOM_ALIAS_STORE_KEY = 'room_id_name_aliases';
const ROOM_ALIAS_SCHEMA_VERSION = 1;
const MAX_ROOM_ALIAS_ENTRIES = 64;

/** Property sets */
const properties = {
    /* Baseline (d109gl / d102gl) — unchanged except for our code hardening */
    properties_d109gl: {
        get_rooms: [{ did: 'rooms', siid: 2, piid: 16 }],
        get_properties: [
            { did: 'device_status', siid: 2, piid: 2 },
            { did: 'device_fault', siid: 2, piid: 3 },
            { did: 'mode', siid: 2, piid: 4 },
            { did: 'battery', siid: 3, piid: 1 },
            { did: 'main_brush_life_level', siid: 12, piid: 1 },
            { did: 'side_brush_life_level', siid: 13, piid: 1 },
            { did: 'filter_life_level', siid: 14, piid: 1 },
            { did: 'total_clean_time', siid: 2, piid: 7 },
            { did: 'total_clean_count', siid: 2, piid: 8 },
            { did: 'total_clean_area', siid: 2, piid: 6 },
            { did: 'cleaning_mode', siid: 2, piid: 9 },
            { did: 'water_level', siid: 2, piid: 10 },
            { did: 'path_mode', siid: 2, piid: 74 },
            { did: 'detergent_left_level', siid: 18, piid: 1 },
            { did: 'detergent_self_delivery', siid: 18, piid: 2 },
            { did: 'detergent_self_delivery_lvl', siid: 18, piid: 3 },
            { did: 'dust_bag_life_level', siid: 19, piid: 1 },
            { did: 'dust_bag_left_time', siid: 19, piid: 2 },
            { did: 'detergent_depletion_reminder', siid: 2, piid: 71 },
            { did: 'carpet_avoidance', siid: 2, piid: 73 }
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
            find: { siid: 6, aiid: 1, did: 'call-6-1', in: [] },
            home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] },
            mopmode: { siid: 2, piid: 4 },
            cleaning_mode: { siid: 2, piid: 9 },
            water_level: { siid: 2, piid: 10 },
            path_mode: { siid: 2, piid: 74 },
            room_clean_action: { siid: 2, aiid: 16, piid: 15 }, // baseline
            carpet_avoidance: { siid: 2, piid: 73 }
        },
        supports: {
            rooms: true,
            mopmode: true,
            cleaning_mode: true,
            water_level: true,
            path_mode: true,
            carpet_avoidance: true,
            consumables: true,
            detergent: true
        },
        scale: {
            area_divisor: 100,
            time_divisor: 3600
        },
        error_codes: ERROR_CODES,
        status_mapping: STATUS_MAPPING
    },

    /* H40 (d101) */
    properties_d101: {
        get_rooms: [{ did: 'rooms', siid: 2, piid: 16 }],
        get_properties: [
            { did: 'device_status', siid: 2, piid: 2 },
            { did: 'device_fault', siid: 2, piid: 3 },
            { did: 'mode', siid: 2, piid: 4 },
            { did: 'battery', siid: 3, piid: 1 },
            { did: 'main_brush_life_level', siid: 12, piid: 1 },
            { did: 'side_brush_life_level', siid: 13, piid: 1 },
            { did: 'filter_life_level', siid: 14, piid: 1 },
            { did: 'total_clean_time', siid: 2, piid: 7 },
            { did: 'total_clean_count', siid: 2, piid: 8 },
            { did: 'total_clean_area', siid: 2, piid: 6 },
            { did: 'cleaning_mode', siid: 2, piid: 9 },
            { did: 'water_level', siid: 2, piid: 10 },
            { did: 'path_mode', siid: 2, piid: 74 },
            { did: 'carpet_avoidance', siid: 2, piid: 73 }
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
            find: { siid: 6, aiid: 1, did: 'call-6-1', in: [] },
            home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] },
            mopmode: { siid: 2, piid: 4 },
            cleaning_mode: { siid: 2, piid: 9 },
            water_level: { siid: 2, piid: 10 },
            path_mode: { siid: 2, piid: 74 },
            room_clean_action: { siid: 2, aiid: 16, piid: 15 },
            carpet_avoidance: { siid: 2, piid: 73 }
        },
        supports: {
            rooms: true,
            mopmode: true,
            cleaning_mode: true,
            water_level: true,
            path_mode: true,
            carpet_avoidance: true,
            consumables: true,
            detergent: false
        },
        scale: {
            area_divisor: 100,
            time_divisor: 3600
        },
        error_codes: ERROR_CODES,
        status_mapping: STATUS_MAPPING_D101
    },

    /* X20 / X20+ (c102gl)
     * Uses c102-specific MIOT mappings for room actions and exposes extended controls.
  */
    properties_c102gl: {
        get_rooms: [{ did: 'rooms', siid: 2, piid: 16 }],
        get_properties: [
            { did: 'device_status', siid: 2, piid: 1 },
            { did: 'device_fault', siid: 2, piid: 2 },
            { did: 'battery', siid: 3, piid: 1 },
            { did: 'mode', siid: 2, piid: 4 },
            { did: 'cleaning_mode', siid: 7, piid: 5 },
            { did: 'water_level', siid: 7, piid: 6 },
            { did: 'path_mode', siid: 7, piid: 38 },
            { did: 'carpet_avoidance', siid: 7, piid: 44 },
            // totals (observed working on c102gl)
            { did: 'total_clean_time', siid: 12, piid: 2 },
            { did: 'total_clean_count', siid: 12, piid: 3 },
            { did: 'total_clean_area', siid: 12, piid: 4 },
            // consumables (percent values)
            { did: 'main_brush_life_level', siid: 9, piid: 2 },
            { did: 'side_brush_life_level', siid: 10, piid: 2 },
            { did: 'filter_life_level', siid: 11, piid: 1 }
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
            find: { siid: 6, aiid: 1, did: 'call-6-1', in: [] },
            home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] },
            mopmode: { siid: 2, piid: 4 },
            cleaning_mode: { siid: 7, piid: 5 },
            water_level: { siid: 7, piid: 6 },
            path_mode: { siid: 7, piid: 38 },
            carpet_avoidance: { siid: 7, piid: 44 },
            carpet_avoidance_toggle: { siid: 7, piid: 47 },
            // X20+/X20 specific room action (string payload)
            room_clean_action: { siid: 2, aiid: 3, piid: 4 }
        },
        supports: {
            rooms: true,
            mopmode: true,
            cleaning_mode: true,
            water_level: true,
            path_mode: true,
            carpet_avoidance: true,
            consumables: true,
            detergent: false
        },
        scale: {
            area_divisor: 1,
            time_divisor: 60
        },
        error_codes: ERROR_CODES,
        status_mapping: STATUS_MAPPING_C102
    },

    /* S20+ (b108gl) */
    properties_b108gl: {
        get_rooms: [{ did: 'rooms', siid: 2, piid: 13 }],
        get_properties: [
            { did: 'device_status', siid: 2, piid: 1 },
            { did: 'device_fault', siid: 2, piid: 2 },
            { did: 'battery', siid: 3, piid: 1 },
            { did: 'mode', siid: 2, piid: 3 },
            { did: 'cleaning_mode', siid: 2, piid: 8 },
            { did: 'water_level', siid: 2, piid: 9 },
            { did: 'carpet_avoidance', siid: 2, piid: 20 },
            { did: 'total_clean_time', siid: 2, piid: 6 },
            { did: 'total_clean_area', siid: 2, piid: 5 }
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
            home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] },
            mopmode: { siid: 2, piid: 3 },
            cleaning_mode: { siid: 2, piid: 8 },
            water_level: { siid: 2, piid: 9 },
            room_clean_action: { siid: 2, aiid: 13, piid: 13 },
            carpet_avoidance: { siid: 2, piid: 20 }
        },
        supports: {
            rooms: true,
            mopmode: true,
            cleaning_mode: true,
            water_level: true,
            path_mode: false,
            carpet_avoidance: true,
            consumables: false,
            detergent: false
        },
        scale: {
            area_divisor: 100,
            time_divisor: 3600
        },
        error_codes: ERROR_CODES,
        status_mapping: STATUS_MAPPING_B108GL
    },

    /* E5 (c108) */
    properties_c108: {
        get_rooms: [],
        get_properties: [
            { did: 'device_status', siid: 2, piid: 1 },
            { did: 'device_fault', siid: 2, piid: 2 },
            { did: 'mode', siid: 2, piid: 4 },
            { did: 'cleaning_mode', siid: 2, piid: 5 },
            { did: 'battery', siid: 3, piid: 1 },
            { did: 'total_clean_area', siid: 9, piid: 1 },
            { did: 'total_clean_time', siid: 9, piid: 2 },
            { did: 'total_clean_count', siid: 9, piid: 3 }
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
            home: { siid: 2, aiid: 8, did: 'call-2-8', in: [] },
            cleaning_mode: { siid: 2, piid: 5 }
        },
        supports: {
            rooms: false,
            mopmode: false,
            cleaning_mode: true,
            water_level: false,
            path_mode: false,
            carpet_avoidance: false,
            consumables: false,
            detergent: false,
            water_shortage: false
        },
        scale: {
            area_divisor: 1,
            time_divisor: 60
        },
        error_codes: ERROR_CODES_C108,
        status_mapping: STATUS_MAPPING_C108
    }
};

class XiaomiVacuumMiotDeviceMax extends Device {
    getMiotProp(result, propName) {
        const propDef = this.deviceProperties.get_properties.find((p) => p.did === propName);
        if (!propDef) {
            this.log(`[DEBUG] Property definition for "${propName}" not found.`);
            return undefined;
        }
        const found = result.find((obj) => obj.siid === propDef.siid && obj.piid === propDef.piid);
        if (!found) {
            this.log(`[DEBUG] MIOT property "${propName}" (siid: ${propDef.siid}, piid: ${propDef.piid}) not in result.`);
        }
        return found;
    }

    _isSupportedX20Device() {
        return isSupportedX20Model(getDeviceModelIdentifier(this));
    }

    _isSupportedBaseStationStatusDevice() {
        return isSupportedBaseStationStatusModel(getDeviceModelIdentifier(this));
    }

    _resetX20StatusTracking() {
        this._x20RawStatusCode = undefined;
        this._x20RawStatusName = undefined;
        this._x20PreviousRawStatusCode = undefined;
        this._x20PreviousRawStatusName = undefined;
        this._x20BaseStationMode = undefined;
        this._x20BaseStationModeName = undefined;
        this._x20PreviousBaseStationMode = undefined;
        this._x20PreviousBaseStationModeName = undefined;
    }

    _coerceFiniteX20Number(value) {
        if (value === null || value === undefined || typeof value === 'boolean') return null;
        if (typeof value === 'string' && value.trim() === '') return null;
        try {
            const numericValue = Number(value);
            return Number.isFinite(numericValue) ? numericValue : null;
        } catch (_) {
            return null;
        }
    }

    _getX20RawStatusName(code) {
        return Object.prototype.hasOwnProperty.call(X20_RAW_STATUS_NAMES, code) ? X20_RAW_STATUS_NAMES[code] : `Status ${code}`;
    }

    _getX20BaseStationModeName(mode) {
        return Object.prototype.hasOwnProperty.call(X20_BASE_STATION_MODE_NAMES, mode) ? X20_BASE_STATION_MODE_NAMES[mode] : `Mode ${mode}`;
    }

    _parseX20BaseStationMode(rawValue) {
        let value = rawValue;
        for (let depth = 0; depth < 3; depth += 1) {
            if (value && typeof value === 'object') {
                if (Array.isArray(value)) return null;
                return this._coerceFiniteX20Number(value.mode);
            }
            if (typeof value !== 'string') return null;
            const text = value.trim();
            if (!text || text.length > 4096) return null;
            try {
                value = JSON.parse(text);
            } catch (_) {
                return null;
            }
        }
        return null;
    }

    _getX20PollProperty(result, propName, siid, piid) {
        if (!Array.isArray(result)) return undefined;
        const propertyDefinitions = this.deviceProperties && Array.isArray(this.deviceProperties.get_properties)
            ? this.deviceProperties.get_properties
            : [];
        const definition = propertyDefinitions.find((property) => property.did === propName);
        const propertySiid = definition ? definition.siid : siid;
        const propertyPiid = definition ? definition.piid : piid;
        return result.find((property) => property && property.siid === propertySiid && property.piid === propertyPiid);
    }

    _getC102BaseStationMode(result) {
        const statusProperty = this._getX20PollProperty(result, 'device_status', 2, 1);
        const statusCode = this._coerceFiniteX20Number(statusProperty && statusProperty.value);
        if (statusCode === null || !Number.isInteger(statusCode)) return null;
        if (statusCode === 8) return 1;
        if (statusCode === 9) return 3;
        if (statusCode === 22) return 2;
        return C102_IDLE_BASE_STATION_STATUS_CODES.includes(statusCode) ? 0 : null;
    }

    async _updateBaseStationStatusCapability(modeName) {
        try {
            if (typeof this.hasCapability !== 'function' || !this.hasCapability(BASE_STATION_STATUS_CAPABILITY)) return;
            await this.setCapabilityValue(BASE_STATION_STATUS_CAPABILITY, modeName);
        } catch (error) {
            const details = typeof this._getSafeErrorDetails === 'function' ? this._getSafeErrorDetails(error) : (error && error.message) || 'Unknown error';
            if (typeof this.error === 'function') this.error(`[BASE_STATION] Failed to update status capability: ${details}`);
        }
    }

    async _observeBaseStationMode(baseStationMode) {
        const previousBaseStationMode = this._coerceFiniteX20Number(this._x20BaseStationMode);
        if (previousBaseStationMode === baseStationMode) return;

        const previousBaseStationModeName = this._x20BaseStationModeName;
        const baseStationModeName = this._getX20BaseStationModeName(baseStationMode);
        this._x20BaseStationMode = baseStationMode;
        this._x20BaseStationModeName = baseStationModeName;
        await this._updateBaseStationStatusCapability(baseStationModeName);

        if (previousBaseStationMode !== null) {
            this._x20PreviousBaseStationMode = previousBaseStationMode;
            this._x20PreviousBaseStationModeName = previousBaseStationModeName || this._getX20BaseStationModeName(previousBaseStationMode);
            await this._triggerX20StatusTransition('base', baseStationMode, previousBaseStationMode);
        }
    }

    _x20RawStatusIs(selector) {
        if (typeof this._isSupportedX20Device !== 'function' || !this._isSupportedX20Device()) return false;
        const selectedCode = this._coerceFiniteX20Number(selector);
        const currentCode = this._coerceFiniteX20Number(this._x20RawStatusCode);
        return selectedCode !== null && currentCode !== null && selectedCode === currentCode;
    }

    _x20BaseStationStatusIs(selector) {
        if (typeof this._isSupportedBaseStationStatusDevice !== 'function' || !this._isSupportedBaseStationStatusDevice()) return false;
        const selectedMode = this._coerceFiniteX20Number(selector);
        const currentMode = this._coerceFiniteX20Number(this._x20BaseStationMode);
        return selectedMode !== null && currentMode !== null && selectedMode === currentMode;
    }

    async _triggerX20StatusTransition(kind, currentValue, previousValue) {
        const raw = kind === 'raw';
        const cardId = raw ? 'x20_raw_status_changed' : 'x20_base_station_status_changed';
        const currentName = raw ? this._getX20RawStatusName(currentValue) : this._getX20BaseStationModeName(currentValue);
        const previousName = raw ? this._getX20RawStatusName(previousValue) : this._getX20BaseStationModeName(previousValue);
        const tokens = raw
            ? {
                  status_code: currentValue,
                  status_name: currentName,
                  previous_status_code: previousValue,
                  previous_status_name: previousName
              }
            : {
                  base_status_code: currentValue,
                  base_status_name: currentName,
                  previous_base_status_code: previousValue,
                  previous_base_status_name: previousName
              };
        const state = raw ? { status: currentValue } : { mode: currentValue };

        try {
            const card = this.homey.flow.getDeviceTriggerCard(cardId);
            await card.trigger(this, tokens, state);
        } catch (error) {
            if (typeof this.error === 'function') this.error(`[FLOW] ${cardId} trigger failed`, error);
        }
    }

    async _observeX20StatusPoll(result) {
        if (!Array.isArray(result)) return;

        if (this._isSupportedX20Device()) {
            const rawStatusProperty = this._getX20PollProperty(result, 'device_status', 2, 2);
            const rawStatusCode = this._coerceFiniteX20Number(rawStatusProperty && rawStatusProperty.value);
            if (rawStatusCode !== null) {
                const previousStatusCode = this._coerceFiniteX20Number(this._x20RawStatusCode);
                const previousStatusName = this._x20RawStatusName;
                const statusName = this._getX20RawStatusName(rawStatusCode);
                this._x20RawStatusCode = rawStatusCode;
                this._x20RawStatusName = statusName;
                if (previousStatusCode !== null && previousStatusCode !== rawStatusCode) {
                    this._x20PreviousRawStatusCode = previousStatusCode;
                    this._x20PreviousRawStatusName = previousStatusName || this._getX20RawStatusName(previousStatusCode);
                    await this._triggerX20StatusTransition('raw', rawStatusCode, previousStatusCode);
                }
            }
        }

        if (!this._isSupportedBaseStationStatusDevice()) return;

        const model = getDeviceModelIdentifier(this);
        const baseStationMode = usesPiid18BaseStationStatus(model)
            ? this._parseX20BaseStationMode((this._getX20PollProperty(result, 'base_station_working_status', 2, 18) || {}).value)
            : this._getC102BaseStationMode(result);
        if (baseStationMode !== null) await this._observeBaseStationMode(baseStationMode);
    }

    _registerX20FlowListeners() {
        if (!this.homey || !this.homey.flow) return;
        const isRawStatusDevice = (device) => isSupportedX20Model(getDeviceModelIdentifier(device));
        const isBaseStationStatusDevice = (device) => isSupportedBaseStationStatusModel(getDeviceModelIdentifier(device));
        const registerTrigger = (cardId, selector, isSupportedDevice) => {
            try {
                const card = this.homey.flow.getDeviceTriggerCard(cardId);
                if (card && typeof card.registerRunListener === 'function') {
                    card.registerRunListener(async (args, state) => {
                        const device = args && args.device;
                        if (!device || !isSupportedDevice(device)) return false;
                        const selected = this._coerceFiniteX20Number(args && args[selector]);
                        const current = this._coerceFiniteX20Number(state && state[selector]);
                        return selected !== null && current !== null && selected === current;
                    });
                }
            } catch (error) {
                if (typeof this.error === 'function') this.error(`[FLOW] Failed to register ${cardId}`, error);
            }
        };
        const registerCondition = (cardId, selector, conditionMethod, isSupportedDevice) => {
            try {
                const card = this.homey.flow.getConditionCard(cardId);
                if (card && typeof card.registerRunListener === 'function') {
                    card.registerRunListener(async (args) => {
                        const device = args && args.device;
                        if (!device || !isSupportedDevice(device) || typeof device[conditionMethod] !== 'function') return false;
                        return device[conditionMethod](args[selector]);
                    });
                }
            } catch (error) {
                if (typeof this.error === 'function') this.error(`[FLOW] Failed to register ${cardId}`, error);
            }
        };

        registerTrigger('x20_raw_status_changed', 'status', isRawStatusDevice);
        registerTrigger('x20_base_station_status_changed', 'mode', isBaseStationStatusDevice);
        registerCondition('x20_raw_status_is', 'status', '_x20RawStatusIs', isRawStatusDevice);
        registerCondition('x20_base_station_status_is', 'mode', '_x20BaseStationStatusIs', isBaseStationStatusDevice);
    }

    _registerBaseStationControlFlowListener() {
        if (!this.homey || !this.homey.flow) return;
        try {
            const card = this.homey.flow.getActionCard('base_station_control');
            if (!card || typeof card.registerRunListener !== 'function') return;
            card.registerRunListener(async (args) => {
                const target = args && args.device;
                if (!target) throw new Error('A target vacuum device is required.');

                const model = getDeviceModelIdentifier(target);
                const commands = BASE_STATION_ACTION_DESCRIPTORS[model];
                if (!commands) throw new Error('Base station control is not supported by this device.');

                const command = args && args.command;
                if (typeof command !== 'string' || !Object.prototype.hasOwnProperty.call(commands, command)) {
                    throw new Error('The selected base station command is not supported by this device.');
                }

                if (!target.miio || typeof target.miio.call !== 'function') {
                    throw new Error('The target vacuum is not connected.');
                }

                const descriptor = commands[command];
                return target.miio.call('action', { ...descriptor, in: [...descriptor.in] }, { retries: 1 });
            });
        } catch (error) {
            const details = typeof this._getSafeErrorDetails === 'function' ? this._getSafeErrorDetails(error) : (error && error.message) || 'Unknown error';
            if (typeof this.error === 'function') this.error(`[FLOW] Failed to register base_station_control: ${details}`);
        }
    }

    _createCustomCleanupDiagnosticMarker(type, reason, length) {
        const marker = { redacted: true, type };
        if (reason) marker.reason = reason;
        if (Number.isFinite(length) && length >= 0) marker.length = Math.floor(length);
        return marker;
    }

    _markCustomCleanupDiagnosticTruncated(context) {
        context.truncated = true;
    }

    _sanitizeCustomCleanupDiagnosticString(value, context, depth, ancestors) {
        let decoded = value;

        while (typeof decoded === 'string') {
            if (decoded.length > CUSTOM_CLEANUP_DIAGNOSTIC_LIMITS.rawStringLength) {
                this._markCustomCleanupDiagnosticTruncated(context);
                return this._createCustomCleanupDiagnosticMarker('redacted_string', 'input_length', decoded.length);
            }
            if (context.jsonDecodes >= CUSTOM_CLEANUP_DIAGNOSTIC_LIMITS.jsonDecodes) {
                this._markCustomCleanupDiagnosticTruncated(context);
                return this._createCustomCleanupDiagnosticMarker('redacted_string', 'json_decode_limit', decoded.length);
            }

            try {
                decoded = JSON.parse(decoded);
                context.jsonDecodes += 1;
            } catch (_) {
                return this._createCustomCleanupDiagnosticMarker('redacted_string', 'non_json_string', decoded.length);
            }
        }

        return this._sanitizeCustomCleanupDiagnosticValue(decoded, context, depth, ancestors);
    }

    _sanitizeCustomCleanupDiagnosticValue(value, context, depth = 0, ancestors = new Set()) {
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            return Number.isFinite(value)
                ? value
                : this._createCustomCleanupDiagnosticMarker('redacted_number', 'non_finite');
        }
        if (typeof value === 'string') {
            return this._sanitizeCustomCleanupDiagnosticString(value, context, depth, ancestors);
        }
        if (typeof value !== 'object') {
            return this._createCustomCleanupDiagnosticMarker(`redacted_${typeof value}`, 'unsupported_type');
        }
        if (depth >= CUSTOM_CLEANUP_DIAGNOSTIC_LIMITS.depth) {
            this._markCustomCleanupDiagnosticTruncated(context);
            return this._createCustomCleanupDiagnosticMarker('truncated_value', 'depth');
        }
        if (ancestors.has(value)) {
            this._markCustomCleanupDiagnosticTruncated(context);
            return this._createCustomCleanupDiagnosticMarker('truncated_value', 'circular_reference');
        }

        ancestors.add(value);
        try {
            if (Array.isArray(value)) {
                const sanitized = [];
                const arrayLength = getCustomCleanupDiagnosticArrayLength(value);
                const limit = Math.min(arrayLength, CUSTOM_CLEANUP_DIAGNOSTIC_LIMITS.arrayEntries);
                for (let index = 0; index < limit; index += 1) {
                    const descriptor = getCustomCleanupDiagnosticOwnDataDescriptor(value, String(index));
                    if (!descriptor) {
                        sanitized.push(this._createCustomCleanupDiagnosticMarker('redacted_value', 'access_failed'));
                        continue;
                    }
                    try {
                        sanitized.push(this._sanitizeCustomCleanupDiagnosticValue(descriptor.value, context, depth + 1, ancestors));
                    } catch (_) {
                        sanitized.push(this._createCustomCleanupDiagnosticMarker('redacted_value', 'access_failed'));
                    }
                }
                if (arrayLength > limit) {
                    this._markCustomCleanupDiagnosticTruncated(context);
                    sanitized.push({ truncated: true, reason: 'array_entries', length: arrayLength });
                }
                return sanitized;
            }

            let keys;
            try {
                keys = Object.keys(value);
            } catch (_) {
                this._markCustomCleanupDiagnosticTruncated(context);
                return this._createCustomCleanupDiagnosticMarker('truncated_value', 'keys_unavailable');
            }

            const sanitized = {};
            const limit = Math.min(keys.length, CUSTOM_CLEANUP_DIAGNOSTIC_LIMITS.objectKeys);
            let redactedKeyIndex = 0;
            for (let index = 0; index < limit; index += 1) {
                const key = keys[index];
                const sanitizedKey = CUSTOM_CLEANUP_DIAGNOSTIC_SAFE_KEYS.has(key) ? key : `redacted_key_${++redactedKeyIndex}`;
                const descriptor = getCustomCleanupDiagnosticOwnDataDescriptor(value, key);
                if (!descriptor) {
                    sanitized[sanitizedKey] = this._createCustomCleanupDiagnosticMarker('redacted_value', 'access_failed');
                    continue;
                }
                try {
                    sanitized[sanitizedKey] = this._sanitizeCustomCleanupDiagnosticValue(descriptor.value, context, depth + 1, ancestors);
                } catch (_) {
                    sanitized[sanitizedKey] = this._createCustomCleanupDiagnosticMarker('redacted_value', 'access_failed');
                }
            }
            if (keys.length > limit) {
                this._markCustomCleanupDiagnosticTruncated(context);
                sanitized.truncated = { reason: 'object_keys', length: keys.length };
            }
            return sanitized;
        } catch (_) {
            this._markCustomCleanupDiagnosticTruncated(context);
            return this._createCustomCleanupDiagnosticMarker('truncated_value', 'sanitize_failed');
        } finally {
            ancestors.delete(value);
        }
    }

    _formatCustomCleanupDiagnosticSnapshot(value) {
        const context = { jsonDecodes: 0, truncated: false };
        let snapshot;
        try {
            snapshot = this._sanitizeCustomCleanupDiagnosticValue(value, context);
        } catch (_) {
            context.truncated = true;
            snapshot = this._createCustomCleanupDiagnosticMarker('redacted_value', 'sanitize_failed');
        }

        let serialized;
        try {
            serialized = JSON.stringify({ snapshot, truncated: context.truncated });
        } catch (_) {
            return '{"snapshot":{"redacted":true,"type":"redacted_value","reason":"serialization"},"truncated":true}';
        }
        if (serialized.length > CUSTOM_CLEANUP_DIAGNOSTIC_LIMITS.serializedLength) {
            return JSON.stringify({
                snapshot: this._createCustomCleanupDiagnosticMarker('truncated_value', 'serialized_length', serialized.length),
                truncated: true
            });
        }
        return serialized;
    }

    _getCustomCleanupDiagnosticSafeError(error) {
        let details = '';
        try {
            details = typeof this._getSafeErrorDetails === 'function' ? this._getSafeErrorDetails(error) : '';
        } catch (_) {}

        let code = '';
        try {
            code = error && error.code != null ? String(error.code) : '';
        } catch (_) {}
        if (/^(?:E[A-Z0-9_.-]{0,63}|-?\d{1,12})$/.test(code)) return `request failed (code: ${code})`;
        if (/\btimeout\b/i.test(details)) return 'request timed out';
        return 'request failed';
    }

    _extractCustomCleanupDiagnosticPlanIds(propertyResult) {
        return this._extractCustomCleanupPlans(propertyResult).map((plan) => plan.id);
    }

    _getCustomCleanupPlanDisplayName(record, fallbackOrder) {
        const namedProperties = ['name', 'title', 'label'];
        const normalizeName = (value) => {
            if (typeof value !== 'string') return null;
            const normalized = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim();
            return normalized ? normalized.slice(0, 80) : null;
        };

        for (const property of namedProperties) {
            const name = normalizeName(getCustomCleanupDiagnosticOwnDataValue(record, property));
            if (name) return name;
        }

        try {
            const keys = Object.keys(record);
            const limit = Math.min(keys.length, CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.topLevelProperties);
            for (let index = 0; index < limit; index += 1) {
                const property = keys[index];
                if (property === 'id' || namedProperties.includes(property)) continue;
                const name = normalizeName(getCustomCleanupDiagnosticOwnDataValue(record, property));
                if (name) return name;
            }
        } catch (_) {}

        return `Custom cleanup ${fallbackOrder}`;
    }

    _extractCustomCleanupPlans(propertyResult) {
        const plans = [];
        const seenIds = new Set();
        let catalogArraysInspected = 0;
        let recordsInspected = 0;

        const inspectCatalogArray = (catalog) => {
            if (!Array.isArray(catalog) || catalogArraysInspected >= CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.catalogArrays) return;
            catalogArraysInspected += 1;

            const recordLimit = Math.min(getCustomCleanupDiagnosticArrayLength(catalog), CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.catalogRecords - recordsInspected);
            for (let index = 0; index < recordLimit && plans.length < CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.candidateIds; index += 1) {
                recordsInspected += 1;
                const record = getCustomCleanupDiagnosticOwnDataValue(catalog, String(index));
                if (!record || typeof record !== 'object' || Array.isArray(record)) continue;

                const id = getCustomCleanupDiagnosticOwnDataValue(record, 'id');
                if (!Number.isInteger(id) || id < 1 || id > 0xFFFFFFFF || seenIds.has(id)) continue;

                seenIds.add(id);
                plans.push({
                    id,
                    name: this._getCustomCleanupPlanDisplayName(record, plans.length + 1)
                });
            }
        };

        const inspectCatalogValue = (value) => {
            const catalogRoot = decodeCustomCleanupDiagnosticCatalog(value);
            if (Array.isArray(catalogRoot)) {
                inspectCatalogArray(catalogRoot);
                return;
            }
            if (!catalogRoot || typeof catalogRoot !== 'object') return;

            let topLevelPropertiesInspected = 0;
            try {
                for (const property in catalogRoot) {
                    topLevelPropertiesInspected += 1;
                    if (topLevelPropertiesInspected > CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.topLevelProperties
                        || catalogArraysInspected >= CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.catalogArrays
                        || recordsInspected >= CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.catalogRecords
                        || plans.length >= CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.candidateIds) break;
                    if (!Object.prototype.hasOwnProperty.call(catalogRoot, property)) continue;

                    const catalog = getCustomCleanupDiagnosticOwnDataValue(catalogRoot, property);
                    if (Array.isArray(catalog)) inspectCatalogArray(catalog);
                }
            } catch (_) {}
        };

        const propertyResponseLimit = Math.min(
            getCustomCleanupDiagnosticArrayLength(propertyResult),
            CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.propertyResponseItems
        );
        for (let index = 0; index < propertyResponseLimit && plans.length < CUSTOM_CLEANUP_DIAGNOSTIC_CATALOG_LIMITS.candidateIds; index += 1) {
            const propertyResponse = getCustomCleanupDiagnosticOwnDataValue(propertyResult, String(index));
            if (!propertyResponse || typeof propertyResponse !== 'object' || Array.isArray(propertyResponse)) continue;
            if (getCustomCleanupDiagnosticOwnDataValue(propertyResponse, 'siid') !== 2
                || getCustomCleanupDiagnosticOwnDataValue(propertyResponse, 'piid') !== 42
                || getCustomCleanupDiagnosticOwnDataValue(propertyResponse, 'code') !== 0) continue;

            const value = getCustomCleanupDiagnosticOwnDataValue(propertyResponse, 'value');
            inspectCatalogValue(value);
        }

        return plans;
    }

    _getCustomCleanupStartPlanId(plan) {
        if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
        const id = getCustomCleanupDiagnosticOwnDataValue(plan, 'id');
        if (Number.isSafeInteger(id) && id >= 1 && id <= 0xFFFFFFFF) return id;
        if (typeof id !== 'string' || !/^[1-9]\d{0,9}$/.test(id)) return null;

        const numericId = Number(id);
        return Number.isSafeInteger(numericId) && numericId >= 1 && numericId <= 0xFFFFFFFF && String(numericId) === id
            ? numericId
            : null;
    }

    _getCustomCleanupStartTargetModel(target) {
        try {
            const model = typeof target._getDeviceModel === 'function' ? target._getDeviceModel() : null;
            return isCustomCleanupDiagnosticModel(model) ? model : null;
        } catch (_) {
            return null;
        }
    }

    _getCustomCleanupStartSafeError(error) {
        try {
            return typeof this._getCustomCleanupDiagnosticSafeError === 'function'
                ? this._getCustomCleanupDiagnosticSafeError(error)
                : 'request failed';
        } catch (_) {
            return 'request failed';
        }
    }

    _registerCustomCleanupStartFlowListener() {
        if (!this.homey || !this.homey.flow) return;
        try {
            const card = this.homey.flow.getActionCard('start_custom_cleanup_plan');
            if (!card || typeof card.registerRunListener !== 'function' || typeof card.registerArgumentAutocompleteListener !== 'function') return;

            const validateTarget = (args) => {
                const target = args && args.device;
                if (!target) throw new Error('A target vacuum device is required.');

                const model = this._getCustomCleanupStartTargetModel(target);
                if (!model) throw new Error('Custom cleanup plans require a supported live vacuum model.');
                if (!target.miio || typeof target.miio.call !== 'function') throw new Error('The target vacuum is not connected.');
                if (typeof target._queuePropertyOperation !== 'function'
                    || typeof target.callMiotGetProperties !== 'function'
                    || typeof target._extractCustomCleanupPlans !== 'function') {
                    throw new Error('The target vacuum does not support Custom cleanup plans.');
                }
                return { target, model };
            };

            const readPlans = async (target, model) => {
                try {
                    const chunkSize = GET_PROPERTIES_CHUNK_SIZE[model] ?? DEFAULT_GET_PROPERTIES_CHUNK_SIZE;
                    const propertyResult = await target.callMiotGetProperties(
                        CUSTOM_CLEANUP_START_PROPERTIES.map((property) => ({ ...property })),
                        { retries: 2, chunkSize, delayMs: GET_PROPERTIES_CHUNK_DELAY_MS }
                    );
                    return target._extractCustomCleanupPlans(propertyResult);
                } catch (error) {
                    const safeError = this._getCustomCleanupStartSafeError(error);
                    try {
                        if (typeof target.error === 'function') target.error(`[CUSTOM_CLEANUP_START] Catalog refresh failed: ${safeError}`);
                    } catch (_) {}
                    throw new Error('Could not refresh Custom cleanup plans; please try again.');
                }
            };

            card.registerArgumentAutocompleteListener('plan', async (query, args) => {
                const { target, model } = validateTarget(args);
                const plans = await target._queuePropertyOperation(() => readPlans(target, model));
                const normalizedQuery = typeof query === 'string' ? query.slice(0, 100).trim().toLowerCase() : '';
                return plans
                    .filter((plan) => !normalizedQuery || plan.name.toLowerCase().includes(normalizedQuery) || String(plan.id).includes(normalizedQuery))
                    .map((plan) => ({
                        id: String(plan.id),
                        name: plan.name,
                        description: `Plan ID ${plan.id}`
                    }));
            });

            card.registerRunListener(async (args) => {
                const planId = this._getCustomCleanupStartPlanId(args && args.plan);
                if (planId === null) throw new Error('Select a valid Custom cleanup plan from the Flow card.');

                const { target, model } = validateTarget(args);
                return target._queuePropertyOperation(async () => {
                    const plans = await readPlans(target, model);
                    if (!plans.some((plan) => plan.id === planId)) {
                        throw new Error('The selected Custom cleanup plan is no longer available. Edit the Flow and select the plan again.');
                    }

                    try {
                        const result = await target.miio.call(
                            'action',
                            {
                                ...CUSTOM_CLEANUP_START_ACTION,
                                in: [{ piid: 43, value: planId }]
                            },
                            { retries: 1 }
                        );
                        const actionCode = getCustomCleanupDiagnosticOwnDataValue(result, 'code');
                        if (typeof actionCode === 'number' && Number.isFinite(actionCode) && actionCode !== 0) {
                            const actionError = new Error('Custom cleanup start action failed.');
                            actionError.code = actionCode;
                            throw actionError;
                        }
                        return result;
                    } catch (error) {
                        const safeError = this._getCustomCleanupStartSafeError(error);
                        try {
                            if (typeof target.error === 'function') target.error(`[CUSTOM_CLEANUP_START] Action failed for plan ID ${planId}: ${safeError}`);
                        } catch (_) {}
                        throw new Error(`Could not start Custom cleanup plan ID ${planId}; please try again.`);
                    }
                });
            });
        } catch (error) {
            const details = this._getCustomCleanupStartSafeError(error);
            if (typeof this.error === 'function') this.error(`[CUSTOM_CLEANUP_START] Failed to register start_custom_cleanup_plan: ${details}`);
        }
    }

    _registerCustomCleanupDiagnosticFlowListener() {
        if (!this.homey || !this.homey.flow) return;
        try {
            const card = this.homey.flow.getActionCard('diagnose_custom_cleanup_plans');
            if (!card || typeof card.registerRunListener !== 'function') return;

            card.registerRunListener(async (args) => {
                const target = args && args.device;
                if (!target) throw new Error('A target vacuum device is required.');

                let actualModel = null;
                try {
                    actualModel = typeof target._getDeviceModel === 'function' ? target._getDeviceModel() : null;
                } catch (_) {}
                const expectedModel = args && args.expected_model;
                if (typeof expectedModel !== 'string' || !isCustomCleanupDiagnosticModel(expectedModel) || !actualModel || !isCustomCleanupDiagnosticModel(actualModel) || actualModel !== expectedModel) {
                    throw new Error('Custom cleanup diagnostics require a matching supported live vacuum model selection.');
                }
                if (!target.miio || typeof target.miio.call !== 'function') {
                    throw new Error('The target vacuum is not connected.');
                }
                if (typeof target._queuePropertyOperation !== 'function' || typeof target.callMiotGetProperties !== 'function') {
                    throw new Error('The target vacuum does not support this diagnostic.');
                }

                const logDiagnostic = (message) => {
                    try {
                        if (typeof target.log === 'function') target.log(`[CUSTOM_CLEANUP_DIAG] ${message}`);
                    } catch (_) {}
                };
                const formatSnapshot = (result) => {
                    try {
                        return typeof target._formatCustomCleanupDiagnosticSnapshot === 'function'
                            ? target._formatCustomCleanupDiagnosticSnapshot(result)
                            : '{"snapshot":{"redacted":true,"type":"redacted_value","reason":"formatter_unavailable"},"truncated":true}';
                    } catch (_) {
                        return '{"snapshot":{"redacted":true,"type":"redacted_value","reason":"format_failed"},"truncated":true}';
                    }
                };
                const safeError = (error) => {
                    try {
                        return typeof target._getCustomCleanupDiagnosticSafeError === 'function'
                            ? target._getCustomCleanupDiagnosticSafeError(error)
                            : 'request failed';
                    } catch (_) {
                        return 'request failed';
                    }
                };

                logDiagnostic(`model/start: ${expectedModel}; reading custom cleanup structure.`);
                return target._queuePropertyOperation(async () => {
                    let propertyError;
                    let actionError;
                    let candidateIds = [];

                    try {
                        const chunkSize = GET_PROPERTIES_CHUNK_SIZE[expectedModel] ?? DEFAULT_GET_PROPERTIES_CHUNK_SIZE;
                        const propertyResult = await target.callMiotGetProperties(
                            CUSTOM_CLEANUP_DIAGNOSTIC_PROPERTIES.map((property) => ({ ...property })),
                            { retries: 2, chunkSize, delayMs: GET_PROPERTIES_CHUNK_DELAY_MS }
                        );
                        logDiagnostic(`property result: ${formatSnapshot(propertyResult)}`);
                        try {
                            candidateIds = typeof target._extractCustomCleanupDiagnosticPlanIds === 'function'
                                ? target._extractCustomCleanupDiagnosticPlanIds(propertyResult)
                                : [];
                        } catch (_) {
                            candidateIds = [];
                        }
                    } catch (error) {
                        propertyError = error;
                        logDiagnostic(`property read failed: ${safeError(error)}`);
                    }

                    const queryIds = candidateIds.length > 0 ? candidateIds : [0];
                    if (candidateIds.length > 0) {
                        logDiagnostic(`catalog candidate IDs: ${candidateIds.join(', ')}.`);
                    } else {
                        logDiagnostic('catalog: no valid plan IDs; querying fallback id 0.');
                    }

                    for (const id of queryIds) {
                        const queryLabel = id === 0 ? 'get-user-define' : `get-user-define id ${id}`;
                        try {
                            const actionResult = await target.miio.call(
                                'action',
                                {
                                    ...CUSTOM_CLEANUP_DIAGNOSTIC_ACTION,
                                    in: CUSTOM_CLEANUP_DIAGNOSTIC_ACTION.in.map((input) => ({ ...input, value: id }))
                                },
                                { retries: 1 }
                            );
                            logDiagnostic(`${queryLabel} result: ${formatSnapshot(actionResult)}`);
                        } catch (error) {
                            if (!actionError) actionError = error;
                            logDiagnostic(`${queryLabel} failed: ${safeError(error)}`);
                        }
                    }

                    if (propertyError || actionError) {
                        logDiagnostic('completion: partial failure; inspect the diagnostic entries.');
                        throw new Error('Custom cleanup diagnostic did not complete; inspect [CUSTOM_CLEANUP_DIAG] logs.');
                    }

                    logDiagnostic('completion: all read-only diagnostic requests succeeded.');
                    return true;
                });
            });
        } catch (error) {
            const details = typeof this._getCustomCleanupDiagnosticSafeError === 'function'
                ? this._getCustomCleanupDiagnosticSafeError(error)
                : 'request failed';
            if (typeof this.error === 'function') this.error(`[CUSTOM_CLEANUP_DIAG] Failed to register diagnose_custom_cleanup_plans: ${details}`);
        }
    }

    _getDeviceModel() {
        if (this.miio) {
            return this.miio.miioModel || (this.miio.management && this.miio.management.model) || null;
        }
        return null;
    }

    _applyModelProperties(model) {
        const mappedKey = mapping[model];
        const previousModel = this._model;
        this.deviceProperties = properties[mappedKey] || properties.properties_d109gl;
        this._model = model;
        if (!isSupportedBaseStationStatusModel(this._model) || (previousModel && previousModel !== this._model)) this._resetX20StatusTracking();
        if (usesPiid18BaseStationStatus(this._model)) {
            this.deviceProperties = {
                ...this.deviceProperties,
                get_properties: [...this.deviceProperties.get_properties]
            };
            const extraProps =
                this._model === 'xiaomi.vacuum.d102gl'
                    ? [
                          { did: 'water_check_status', siid: 2, piid: 54 },
                          { did: 'fault_ids', siid: 2, piid: 66 },
                          { did: 'base_station_working_status', siid: 2, piid: 18 }
                      ]
                    : [{ did: 'base_station_working_status', siid: 2, piid: 18 }];
            for (const prop of extraProps) {
                if (!this.deviceProperties.get_properties.some((existing) => existing.did === prop.did)) {
                    this.deviceProperties.get_properties.push(prop);
                }
            }
        }
        this._areaDivisor = (this.deviceProperties.scale && this.deviceProperties.scale.area_divisor) || 100;
        this._timeDivisor = (this.deviceProperties.scale && this.deviceProperties.scale.time_divisor) || 3600;
    }

    _syncModelFromDevice() {
        const actualModel = this._getDeviceModel();
        if (!actualModel) return true;

        if (this._model !== actualModel) {
            if (!this._modelMismatchLogged) {
                this.log(`[MODEL] Detected model change: ${this._model || 'unknown'} -> ${actualModel}`);
                this._modelMismatchLogged = true;
            }
            this._resetX20StatusTracking();
            this._model = actualModel;
            try {
                this.setStoreValue('model', actualModel);
            } catch (_) {}
        }

        const mappedKey = mapping[this._model];
        if (!mappedKey) {
            if (this._unsupportedModel !== this._model) {
                this._unsupportedModel = this._model;
                this.log(`[MODEL] Unsupported model for vacuum_xiaomi_vacuum_max: ${this._model}`);
            }
            if (this.getAvailable()) {
                this.setUnavailable(`Unsupported model for this driver: ${this._model}`).catch(() => {});
            }
            return false;
        }

        if (this._unsupportedModel) this._unsupportedModel = null;

        this._applyModelProperties(this._model);

        return true;
    }

    async _migrateBaseStationStatusCapability() {
        const model = getDeviceModelIdentifier(this);
        if (!isSupportedBaseStationStatusModel(model)) return;

        try {
            if (this.hasCapability(BASE_STATION_STATUS_CAPABILITY)) return;
            this.log(`[MIGRATION] Adding base-station status capability for ${model}.`);
            await this.addCapability(BASE_STATION_STATUS_CAPABILITY);
            this.log(`[MIGRATION] Added base-station status capability for ${model}.`);
        } catch (error) {
            const details = typeof this._getSafeErrorDetails === 'function' ? this._getSafeErrorDetails(error) : (error && error.message) || 'Unknown error';
            if (typeof this.error === 'function') this.error(`[MIGRATION] Failed to add base-station status capability for ${model}: ${details}`);
        }
    }

    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            // GENERIC DEVICE INIT ACTIONS
            this.bootSequence();

            // remember last state
            this.lastVacState = 'unknown';
            this._prevAreaRaw = 0;
            this._prevTimeRaw = 0;
            this._sessionStartAreaRaw = 0;
            this._sessionStartTimeRaw = 0;
            this._isSessionActive = false;
            this._resetX20StatusTracking();

            const model = this.getStoreValue('model');
            this._applyModelProperties(model);
            await this._migrateBaseStationStatusCapability();
            this._carpetModeState = this.getStoreValue('carpetModeState') || '0';
            if (!this.getStoreValue('carpetModeState')) {
                try {
                    await this.setStoreValue('carpetModeState', this._carpetModeState);
                } catch (_) {}
            }

            const optionalCapabilities = [
                { id: 'vacuum_xiaomi_mop_mode_max', supported: this.deviceProperties.supports.mopmode },
                { id: 'vacuum_xiaomi_cleaning_mode_max', supported: this.deviceProperties.supports.cleaning_mode },
                { id: 'vacuum_xiaomi_water_level_max', supported: this.deviceProperties.supports.water_level },
                { id: 'vacuum_xiaomi_path_mode_max', supported: this.deviceProperties.supports.path_mode },
                { id: 'vacuum_xiaomi_carpet_mode_max', supported: this.deviceProperties.supports.carpet_avoidance },
                { id: 'alarm_main_brush_work_time', supported: this.deviceProperties.supports.consumables },
                { id: 'alarm_side_brush_work_time', supported: this.deviceProperties.supports.consumables },
                { id: 'alarm_filter_work_time', supported: this.deviceProperties.supports.consumables },
                { id: 'alarm_water_shortage', supported: this.deviceProperties.supports.water_shortage !== false }
            ];
            for (const capability of optionalCapabilities) {
                if (capability.supported && !this.hasCapability(capability.id)) {
                    await this.addCapability(capability.id);
                }
                if (!capability.supported && this.hasCapability(capability.id)) {
                    await this.removeCapability(capability.id);
                }
            }

            if (this.deviceProperties.supports.carpet_avoidance) {
                await this.updateCapabilityValue('vacuum_xiaomi_carpet_mode_max', this._carpetModeState);
            }

            // RESET consumable alarms (only for models that support them)
            if (this.deviceProperties.supports.consumables) {
                this.updateCapabilityValue('alarm_main_brush_work_time', false);
                this.updateCapabilityValue('alarm_side_brush_work_time', false);
                this.updateCapabilityValue('alarm_filter_work_time', false);
            }

            // Tokens
            this.main_brush_lifetime_token = await this.getOrCreateToken('main_brush_lifetime' + this.getData().id, `Main Brush Lifetime ${this.getName()} (%)`);
            this.side_brush_lifetime_token = await this.getOrCreateToken('side_brush_lifetime' + this.getData().id, `Side Brush Lifetime ${this.getName()} (%)`);
            this.filter_lifetime_token = await this.getOrCreateToken('filter_lifetime' + this.getData().id, `Filter Lifetime ${this.getName()} (%)`);
            this.sensor_dirty_lifetime_token = await this.getOrCreateToken('sensor_dirty_lifetime' + this.getData().id, `Sensor Dirty Lifetime ${this.getName()} (%)`);
            this.total_work_time_token = await this.getOrCreateToken('total_work_time' + this.getData().id, `Total Work Time ${this.getName()} (h)`);
            this.total_cleared_area_token = await this.getOrCreateToken('total_cleared_area' + this.getData().id, `Total Cleaned Area ${this.getName()} (m²)`);
            this.total_clean_count_token = await this.getOrCreateToken('total_clean_count' + this.getData().id, `Total Clean Count ${this.getName()}`);

            // FLOW CARDS (optional; if not present, triggers are try/catch’d below)
            this.homey.flow.getDeviceTriggerCard('alertVacuum');
            this.homey.flow.getDeviceTriggerCard('statusVacuum');
            this._registerX20FlowListeners();
            this._registerBaseStationControlFlowListener();
            this._registerCustomCleanupDiagnosticFlowListener();
            this._registerCustomCleanupStartFlowListener();

            // Advanced room cleaning (works for all, just skips unsupported set_properties)
            this.homey.flow.getActionCard('advanced_room_cleaning').registerRunListener(async (args) => {
                if (!args.device || !args.device.deviceProperties || !args.device.deviceProperties.supports.rooms || !args.device.deviceProperties.set_properties.room_clean_action) {
                    return Promise.reject('Room cleaning is not supported by this device.');
                }
                const {
                    rooms: list_room,
                    selectedIds: selected_ids
                } = await args.device._resolveAdvancedRoomCleaningSelection(args.room);

                if (!selected_ids.length) {
                    return Promise.reject(
                        `No valid CURRENT room selected. Requested: "${args.room}". Available: ${list_room
                            .map((room) => (room.name || ('Room ' + room.id)) + ' [' + room.id + ']')
                            .join(', ')}.`
                    );
                }

                const room_list = args.device._serializeRoomList(selected_ids);

                // Only push properties that the model supports
                const props = [];
                const selectedMode = String(args.mode);
                if (this.deviceProperties.supports.mopmode) {
                    const mopOutbound = this.mapMopModeOutbound(selectedMode);
                    if (mopOutbound != null) {
                        props.push({
                            siid: this.deviceProperties.set_properties.mopmode.siid,
                            piid: this.deviceProperties.set_properties.mopmode.piid,
                            value: mopOutbound
                        });
                    }
                }
                if (this.deviceProperties.supports.path_mode) {
                    const pathOutbound = this.mapPathModeOutbound(String(args.accuracy));
                    if (pathOutbound != null) {
                        props.push({
                            siid: this.deviceProperties.set_properties.path_mode.siid,
                            piid: this.deviceProperties.set_properties.path_mode.piid,
                            value: pathOutbound
                        });
                    }
                }
                if (this.deviceProperties.supports.cleaning_mode && (selectedMode === '1' || selectedMode === '3')) {
                    const sweepOutbound = this.mapCleaningModeOutbound(String(args.mode_sweep));
                    if (sweepOutbound != null) {
                        props.push({
                            siid: this.deviceProperties.set_properties.cleaning_mode.siid,
                            piid: this.deviceProperties.set_properties.cleaning_mode.piid,
                            value: sweepOutbound
                        });
                    }
                }
                if (this.deviceProperties.supports.water_level && (selectedMode === '2' || selectedMode === '3')) {
                    const mopLevelOutbound = this.mapWaterLevelOutbound(String(args.mode_mop));
                    if (mopLevelOutbound != null) {
                        props.push({
                            siid: this.deviceProperties.set_properties.water_level.siid,
                            piid: this.deviceProperties.set_properties.water_level.piid,
                            value: mopLevelOutbound
                        });
                    }
                }
                if (this.deviceProperties.supports.carpet_avoidance && typeof args.carpet_avoidance !== 'undefined') {
                    const carpetPayload = this.buildCarpetModeSetPayload(String(args.carpet_avoidance));
                    if (carpetPayload.length) {
                        props.push(...carpetPayload);
                    }
                }

                const action = {
                    siid: this.deviceProperties.set_properties.room_clean_action.siid,
                    aiid: this.deviceProperties.set_properties.room_clean_action.aiid,
                    in: [
                        {
                            siid: this.deviceProperties.set_properties.room_clean_action.siid,
                            piid: this.deviceProperties.set_properties.room_clean_action.piid,
                            code: 0,
                            value: room_list
                        }
                    ]
                };

                this.log('[ADV_ROOM_CLEAN] props:', JSON.stringify(props));
                this.log('[ADV_ROOM_CLEAN] action:', JSON.stringify(action));

                if (args.device.miio && typeof args.device.miio.call === 'function') {
                    if (props.length) await args.device.callVacuumSetProperties(props, { retries: 2 });
                    await args.device.miio.call('action', action, { retries: 3 });
                } else {
                    this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
                    this.createDevice();
                    return Promise.reject('Device unreachable, please try again ...');
                }
            });

            const registerVacuumAction = (cardId, capabilityId, argKey, supportKey) => {
                this.homey.flow.getActionCard(cardId).registerRunListener(async (args) => {
                    try {
                        const target = args.device;
                        if (!target || !target.deviceProperties || !target.deviceProperties.supports || !target.deviceProperties.supports[supportKey]) {
                            return Promise.reject('Feature not supported by this device.');
                        }
                        if (!target.hasCapability(capabilityId)) {
                            return Promise.reject('Capability not available on this device.');
                        }
                        return await target.triggerCapabilityListener(capabilityId, args[argKey]);
                    } catch (error) {
                        return Promise.reject(error && error.message ? error.message : error);
                    }
                });
            };

            registerVacuumAction('set_sweep_mop_type', 'vacuum_xiaomi_mop_mode_max', 'mode', 'mopmode');
            registerVacuumAction('set_cleaning_mode', 'vacuum_xiaomi_cleaning_mode_max', 'power', 'cleaning_mode');
            registerVacuumAction('set_water_level', 'vacuum_xiaomi_water_level_max', 'level', 'water_level');
            registerVacuumAction('set_path_mode', 'vacuum_xiaomi_path_mode_max', 'mode', 'path_mode');
            registerVacuumAction('set_carpet_avoidance', 'vacuum_xiaomi_carpet_mode_max', 'mode', 'carpet_avoidance');

            // Capability listeners: register only for supported features
            if (this.deviceProperties.supports.carpet_avoidance) {
                this.registerCapabilityListener('vacuum_xiaomi_carpet_mode_max', async (value) => {
                    try {
                        const { payload, state } = this.buildCarpetModeSetPayload(String(value));
                        if (!payload.length) return null;
                        if (this.miio) {
                            const result = await this.callVacuumSetProperties(payload, { retries: 2 });
                            this._carpetModeState = state;
                            try {
                                await this.setStoreValue('carpetModeState', state);
                            } catch (_) {}
                            await this.updateCapabilityValue('vacuum_xiaomi_carpet_mode_max', state);
                            return result;
                        }
                        this.setUnavailable(this.homey.__('unreachable')).catch((err) => this.error(err));
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again …');
                    } catch (error) {
                        this.error(error);
                        return Promise.reject(error);
                    }
                });
            }

            this.registerCapabilityListener('onoff', async (value) => {
                try {
                    if (this.miio) {
                        if (value) return await this.miio.call('action', this.deviceProperties.set_properties.start_clean, { retries: 1 });
                        return await this.miio.call('action', this.deviceProperties.set_properties.stop_clean, { retries: 1 });
                    }
                    this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
                    this.createDevice();
                    return Promise.reject('Device unreachable, please try again ...');
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            this.registerCapabilityListener('vacuumcleaner_state', async (value) => {
                try {
                    if (this.miio) {
                        switch (value) {
                            case 'cleaning':
                            case 'spot_cleaning':
                                return await this.triggerCapabilityListener('onoff', true);
                            case 'docked':
                            case 'charging':
                                return await this.miio.call('action', this.deviceProperties.set_properties.home, { retries: 1 });
                            case 'stopped':
                                return await this.triggerCapabilityListener('onoff', false);
                        }
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            if (this.deviceProperties.supports.mopmode) {
                this.registerCapabilityListener('vacuum_xiaomi_mop_mode_max', async (value) => {
                    try {
                        const mappedValue = this.mapMopModeOutbound(String(value));
                        if (mappedValue == null) return null;
                        if (this.miio) {
                            return await this.callVacuumSetProperties([{ siid: this.deviceProperties.set_properties.mopmode.siid, piid: this.deviceProperties.set_properties.mopmode.piid, value: mappedValue }], { retries: 2 });
                        }
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    } catch (error) {
                        this.error(error);
                        return Promise.reject(error);
                    }
                });
            }

            if (this.deviceProperties.supports.cleaning_mode) {
                this.registerCapabilityListener('vacuum_xiaomi_cleaning_mode_max', async (value) => {
                    try {
                        const mappedValue = this.mapCleaningModeOutbound(String(value));
                        if (mappedValue == null) return null;
                        if (this.miio) {
                            return await this.callVacuumSetProperties([{ siid: this.deviceProperties.set_properties.cleaning_mode.siid, piid: this.deviceProperties.set_properties.cleaning_mode.piid, value: mappedValue }], { retries: 2 });
                        }
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    } catch (error) {
                        this.error(error);
                        return Promise.reject(error);
                    }
                });
            }

            if (this.deviceProperties.supports.water_level) {
                this.registerCapabilityListener('vacuum_xiaomi_water_level_max', async (value) => {
                    try {
                        const mappedValue = this.mapWaterLevelOutbound(String(value));
                        if (mappedValue == null) return null;
                        if (this.miio) {
                            return await this.callVacuumSetProperties([{ siid: this.deviceProperties.set_properties.water_level.siid, piid: this.deviceProperties.set_properties.water_level.piid, value: mappedValue }], { retries: 2 });
                        }
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    } catch (error) {
                        this.error(error);
                        return Promise.reject(error);
                    }
                });
            }

            if (this.deviceProperties.supports.path_mode) {
                this.registerCapabilityListener('vacuum_xiaomi_path_mode_max', async (value) => {
                    try {
                        const mappedValue = this.mapPathModeOutbound(String(value));
                        if (mappedValue == null) return null;
                        if (this.miio) {
                            return await this.callVacuumSetProperties([{ siid: this.deviceProperties.set_properties.path_mode.siid, piid: this.deviceProperties.set_properties.path_mode.piid, value: mappedValue }], { retries: 2 });
                        }
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    } catch (error) {
                        this.error(error);
                        return Promise.reject(error);
                    }
                });
            }

            // Use safe totals handler for all models (no-op for unsupported fields)
            this.vacuumTotals = this.customVacuumTotals;
            this.vacuumConsumables = this.deviceProperties.supports.consumables ? this.customVacuumConsumables : async () => {}; // noop on c102gl

            // One-time SIID/PIID discovery scan for c102gl to aid debugging/model support
            /*
            if (model === 'xiaomi.vacuum.c102gl' && !this._siidPiidScanned) {
                this._siidPiidScanned = true;
                this.homey.setTimeout(() => {
                    this._runOneTimeMiotScan().catch((e) => this.error('[MIOT_SCAN] failed', e));
                }, 25000);
            }*/

            // Initialize one-time room logging/discovery flags
            this._roomsLogOnce = false;
            this._roomsDiscovered = false;
        } catch (error) {
            this.error(error);
        }
            
    }

    async retrieveDeviceData() {
        if (this._retrieveDeviceDataInProgress) {
            this.log('[POLL] Skipping overlapping property poll.');
            return;
        }

        this._retrieveDeviceDataInProgress = true;
        try {
            if (!this.miio || typeof this.miio.call !== 'function') {
                this._mainPollFailures = 0;
                if (this.getAvailable()) {
                    this.setUnavailable(this.homey.__('device.unreachable')).catch((error) => this.error(error));
                }
                this.createDevice();
                return;
            }
            if (!this._syncModelFromDevice()) return;

            let result;
            try {
                result = await this.callVacuumGetProperties(this.deviceProperties.get_properties, { retries: 2 });
                const recoveredFailures = this._mainPollFailures || 0;
                if (recoveredFailures > 0) {
                    const suffix = recoveredFailures === 1 ? '' : 's';
                    this.log(`[POLL] Main property read recovered after ${recoveredFailures} consecutive failure${suffix}.`);
                }
                this._mainPollFailures = 0;
            } catch (error) {
                await this._handleMainPollFailure(error);
                return;
            }

            try {
                await this._observeX20StatusPoll(result);
            } catch (error) {
                this.error(`[FLOW] Failed to process raw/base-station status poll: ${this._getSafeErrorDetails(error)}`);
            }

            // Fetch rooms only when needed and only until discovered
            let result_rooms = null;
            if (this.deviceProperties.supports.rooms && !this._roomsDiscovered) {
                const currentRooms = this.getSetting('rooms');
                try {
                    const parsedRooms = JSON.parse(currentRooms || '[]');
                    if (Array.isArray(parsedRooms) && parsedRooms.length > 0) {
                        this._roomsDiscovered = true;
                    }
                } catch (_) {}

                if (!this._roomsDiscovered) {
                    try {
                        result_rooms = await this.callVacuumGetProperties(this.deviceProperties.get_rooms, { retries: 2 });
                    } catch (error) {
                        this.error(`[ROOMS] Optional property read failed: ${this._getSafeErrorDetails(error)}; continuing without room data.`);
                    }
                    if (!result_rooms || !result_rooms.length || !result_rooms[0].value) {
                        const candidates = [
                            [{ did: 'rooms', siid: 4, piid: 20 }],
                            [{ did: 'rooms', siid: 6, piid: 15 }], // user-facing strings sometimes here
                            [{ did: 'rooms', siid: 7, piid: 3 }]
                        ];
                        for (const c of candidates) {
                            try {
                                const r = await this.callVacuumGetProperties(c, { retries: 2 });
                                if (r && r[0] && r[0].value) {
                                    result_rooms = r;
                                    break;
                                }
                            } catch (error) {
                                this.error(`[ROOMS] Optional candidate property read failed: ${this._getSafeErrorDetails(error)}; continuing without room data.`);
                            }
                        }
                    }
                }
            }

            if (!this.getAvailable()) await this.setAvailable();

            // diff logging
            const prevProps = this._lastPropertyValues || {};
            const resultValues = {};
            for (const def of this.deviceProperties.get_properties) {
                const found = result.find((obj) => obj.siid === def.siid && obj.piid === def.piid);
                resultValues[def.did] = found ? found.value : null;
            }
            let valueChanged = Object.keys(resultValues).some((k) => prevProps[k] !== resultValues[k]);
            if (valueChanged) this.log('Raw property data: ' + this.prettyPrintProperties(result, this.deviceProperties.get_properties));
            this._lastPropertyValues = resultValues;

            const device_status = this.getMiotProp(result, 'device_status');
            const battery = this.getMiotProp(result, 'battery');
            const total_clean_time = this.getMiotProp(result, 'total_clean_time');
            const total_clean_count = this.getMiotProp(result, 'total_clean_count');
            const total_clean_area = this.getMiotProp(result, 'total_clean_area');
            const device_fault = this.getMiotProp(result, 'device_fault');
            const mop_mode = this.getMiotProp(result, 'mode');
            const cleaning_mode_prop = this.getMiotProp(result, 'cleaning_mode');
            const water_level_prop = this.deviceProperties.supports.water_level ? this.getMiotProp(result, 'water_level') : null;
            const path_mode_prop = this.deviceProperties.supports.path_mode ? this.getMiotProp(result, 'path_mode') : null;
            const carpet_mode_prop = this.deviceProperties.supports.carpet_avoidance ? this.getMiotProp(result, 'carpet_avoidance') : null;
            const water_check_status = this._model === 'xiaomi.vacuum.d102gl' ? this.getMiotProp(result, 'water_check_status') : null;
            const fault_ids = this._model === 'xiaomi.vacuum.d102gl' ? this.getMiotProp(result, 'fault_ids') : null;

            const consumables = this.deviceProperties.supports.consumables
                ? [
                      {
                          main_brush_work_time: Math.max(0, Math.min(100, Number((this.getMiotProp(result, 'main_brush_life_level') || {}).value ?? 0))),
                          side_brush_work_time: Math.max(0, Math.min(100, Number((this.getMiotProp(result, 'side_brush_life_level') || {}).value ?? 0))),
                          filter_work_time: Math.max(0, Math.min(100, Number((this.getMiotProp(result, 'filter_life_level') || {}).value ?? 0)))
                      }
                  ]
                : [];

            const totalsReport = {
                clean_time: total_clean_time ? total_clean_time.value : 0,
                clean_count: total_clean_count ? total_clean_count.value : 0,
                clean_area: total_clean_area ? total_clean_area.value : 0
            };

            /* vacuumcleaner_state */
            let matched = false;
            let stateKey = null;

            if (device_status) {
                for (const key in this.deviceProperties.status_mapping) {
                    if (this.deviceProperties.status_mapping[key].includes(device_status.value)) {
                        matched = true;
                        stateKey = key;
                        if (this.getCapabilityValue('measure_battery') === 100 && (key === 'stopped' || key === 'charging')) {
                            this.vacuumCleanerState('docked');
                        } else {
                            this.vacuumCleanerState(key);
                        }
                        break;
                    }
                }
                if (!matched) this.log('Not a valid vacuumcleaner_state (driver level)', device_status.value);
            } else {
                this.log('device_status not found, cannot set vacuumcleaner_state!');
            }

            // session handling
            if (stateKey === 'cleaning' && !this._isSessionActive) {
                this._isSessionActive = true;
                this._prevAreaRaw = total_clean_area ? total_clean_area.value : 0;
                this._prevTimeRaw = total_clean_time ? total_clean_time.value : 0;
                this._sessionStartAreaRaw = this._prevAreaRaw;
                this._sessionStartTimeRaw = this._prevTimeRaw;
                const startAreaM2 = this._sessionStartAreaRaw / this._areaDivisor;
                const startTimeHours = this._sessionStartTimeRaw / this._timeDivisor;
                this.log(`[SESSION] Cleaning started: startArea(m²)=${startAreaM2.toFixed(2)}, startTime(h)=${startTimeHours.toFixed(2)}`);
            }
            if (stateKey === 'cleaning' && this._isSessionActive) {
                const currentAreaRaw = total_clean_area ? total_clean_area.value : 0;
                const currentTimeRaw = total_clean_time ? total_clean_time.value : 0;
                const deltaAreaRaw = currentAreaRaw - this._prevAreaRaw;
                const deltaTimeRaw = currentTimeRaw - this._prevTimeRaw;

                if (deltaAreaRaw > 0 || deltaTimeRaw > 0) {
                    await this._addLiveDelta(deltaAreaRaw, deltaTimeRaw);
                    this._prevAreaRaw = currentAreaRaw;
                    this._prevTimeRaw = currentTimeRaw;
                }
            }
            if (this.lastVacState === 'cleaning' && ['docked', 'charging', 'stopped'].includes(stateKey)) {
                try {
                    await this._accumulateJobTotals();
                    this._isSessionActive = false;
                    this.log('[SESSION] Cleaning ended. Count incremented.');
                } catch (e) {
                    this.error('Session completion handling failed', e);
                }
            }

            if (this.deviceProperties.supports.mopmode && mop_mode && mop_mode.value != null && this.hasCapability('vacuum_xiaomi_mop_mode_max')) {
                const mappedMop = this.mapMopModeInbound(mop_mode.value);
                if (mappedMop != null) await this.updateCapabilityValue('vacuum_xiaomi_mop_mode_max', mappedMop);
            }

            if (this.deviceProperties.supports.cleaning_mode && cleaning_mode_prop && cleaning_mode_prop.value != null && this.hasCapability('vacuum_xiaomi_cleaning_mode_max')) {
                const mappedCleaning = this.mapCleaningModeInbound(cleaning_mode_prop.value);
                if (mappedCleaning != null) await this.updateCapabilityValue('vacuum_xiaomi_cleaning_mode_max', mappedCleaning);
            }

            if (this.deviceProperties.supports.water_level && water_level_prop && water_level_prop.value != null && this.hasCapability('vacuum_xiaomi_water_level_max')) {
                const mappedWater = this.mapWaterLevelInbound(water_level_prop.value);
                if (mappedWater != null) await this.updateCapabilityValue('vacuum_xiaomi_water_level_max', mappedWater);
            }

            if (this.deviceProperties.supports.path_mode && path_mode_prop && path_mode_prop.value != null && this.hasCapability('vacuum_xiaomi_path_mode_max')) {
                const mappedPath = this.mapPathModeInbound(path_mode_prop.value);
                if (mappedPath != null) await this.updateCapabilityValue('vacuum_xiaomi_path_mode_max', mappedPath);
            }

            if (this.deviceProperties.supports.carpet_avoidance && this.hasCapability('vacuum_xiaomi_carpet_mode_max')) {
                const mappedCarpet = this.mapCarpetModeInbound(carpet_mode_prop ? carpet_mode_prop.value : null);
                if (mappedCarpet != null && mappedCarpet !== this._carpetModeState) {
                    this._carpetModeState = mappedCarpet;
                    try {
                        await this.setStoreValue('carpetModeState', mappedCarpet);
                    } catch (_) {}
                    await this.updateCapabilityValue('vacuum_xiaomi_carpet_mode_max', mappedCarpet);
                } else if (mappedCarpet == null) {
                    await this.updateCapabilityValue('vacuum_xiaomi_carpet_mode_max', this._carpetModeState);
                }
            }

            // Totals
            try {
                await this.vacuumTotals(totalsReport);
            } catch (e) {
                this.error('[Totals] Skipping due to error:', e && e.message ? e.message : e);
            }

            // battery
            if (battery && battery.value != null) {
                await this.updateCapabilityValue('measure_battery', battery.value);
                await this.updateCapabilityValue('alarm_battery', battery.value <= 20);
            }

            // rooms
            if (result_rooms && result_rooms.length === 1 && result_rooms[0].value) {
                try {
                    const rawVal = result_rooms[0].value;
                    if (!this._roomsLogOnce) this.log('[ROOMS] raw:', typeof rawVal === 'string' ? rawVal : JSON.stringify(rawVal));

                    let parsed = null;
                    if (typeof rawVal === 'string') {
                        try {
                            parsed = JSON.parse(rawVal);
                        } catch (_) {
                            try {
                                parsed = JSON.parse(rawVal.replace(/\\"/g, '"'));
                            } catch (_) {
                                try {
                                    if (rawVal.startsWith('"') && rawVal.endsWith('"')) parsed = JSON.parse(JSON.parse(rawVal));
                                } catch (_) {}
                            }
                        }
                    } else if (rawVal && typeof rawVal === 'object') {
                        parsed = rawVal;
                    }

                    if (!parsed) {
                        if (!this._roomsLogOnce) this.log('[ROOMS] Unable to parse rooms payload');
                        return;
                    }

                    let roomsArr = [];
                    if (parsed && Array.isArray(parsed.rooms)) {
                        roomsArr = parsed.rooms;
                    } else if (parsed && Array.isArray(parsed.sections)) {
                        roomsArr = parsed.sections;
                    } else if (Array.isArray(parsed)) {
                        roomsArr = parsed.filter((x) => x && typeof x === 'object' && 'id' in x);
                    } else if (parsed && Array.isArray(parsed.selects)) {
                        const ids = Array.from(new Set(parsed.selects.flat().filter((n) => typeof n === 'number')));
                        roomsArr = ids.map((id) => ({ id, name: 'Room ' + id }));
                    }

                    if (roomsArr.length) {
                        await this.setSettings({ rooms: JSON.stringify(roomsArr), rooms_display: roomsArr.map((r) => r.name || ('Room ' + r.id)).join(', ') });
                        this._roomsDiscovered = true;
                    } else {
                        if (!this._roomsLogOnce) this.log('[ROOMS] No parsable rooms in payload');
                    }
                    this._roomsLogOnce = true;
                } catch (e) {
                    if (!this._roomsLogOnce) this.error('[ROOMS] Failed to parse:', e && e.message ? e.message : e);
                    this._roomsLogOnce = true;
                }
            }

            // consumables only if supported (prevents invalid_flow_card_id logs)
            if (this.deviceProperties.supports.consumables) {
                this.vacuumConsumables(consumables);
            }

            /* error/status tiles + flows */
            let err = 'Everything-is-ok';
            if (device_fault && this.deviceProperties.error_codes.hasOwnProperty(device_fault.value)) {
                err = this.deviceProperties.error_codes[device_fault.value];
            }

            const isWaterTankFault = device_fault && Number(device_fault.value) === 210030;
            if (isWaterTankFault && this._model === 'xiaomi.vacuum.d102gl') {
                const waterCheckValue = water_check_status && water_check_status.value != null ? Number(water_check_status.value) : null;
                const waterCheckSuccess = waterCheckValue === 2;
                const waterCheckFail = waterCheckValue === 3;
                let hasWaterFaultId = null;
                if (fault_ids && typeof fault_ids.value === 'string') {
                    const ids = fault_ids.value.match(/\d+/g);
                    if (!ids) {
                        hasWaterFaultId = false;
                    } else {
                        hasWaterFaultId = ids.map((id) => Number(id)).includes(210030);
                    }
                }

                if (waterCheckSuccess || hasWaterFaultId === false || (stateKey === 'cleaning' && !waterCheckFail && hasWaterFaultId !== true)) {
                    err = 'Everything-is-ok';
                } else if (waterCheckFail) {
                    err = 'Water tank empty';
                }
            }

            if (this.hasCapability('alarm_water_shortage')) {
                const waterShortageErrors = new Set(['Water tank empty', 'No-water-error']);
                let detergentShortage = false;
                if (this.deviceProperties.supports.detergent) {
                    const det = this.getMiotProp(result, 'detergent_depletion_reminder');
                    detergentShortage = !!(det && det.value != null && det.value);
                }
                await this.updateCapabilityValue('alarm_water_shortage', waterShortageErrors.has(err) || detergentShortage);
            }

            let safeError = typeof err === 'string' ? err : 'Unknown Error';
            const okStates = new Set(['Everything-is-ok', 'OK', 'OK / Busy']);
            if (stateKey === 'cleaning' && okStates.has(err)) safeError = 'OK - Working';

            await this.updateCapabilityValue('vacuum_xiaomi_status', safeError);
            if (this.getSetting('error') !== err) {
                await this.setSettings({ error: err }).catch(() => {});
                if (device_fault && err !== 'Everything-is-ok') {
                    try {
                        await this.homey.flow.getDeviceTriggerCard('statusVacuum').trigger(this, { status: safeError });
                    } catch (_) {
                        /* ignore invalid_flow_card_id */
                    }
                }
            }

            this.lastVacState = stateKey;
        } catch (error) {
            this.error(`[POLL] Local processing failed: ${this._getSafeErrorDetails(error)}; keeping the current miIO connection.`);
        } finally {
            this._retrieveDeviceDataInProgress = false;
        }
    }

    /* Safe totals for all models */
    async customVacuumTotals(totals) {
        try {
            const timeDiv = this._timeDivisor || 3600;
            const areaDiv = this._areaDivisor || 100;

            // Clean up any legacy string values (e.g. "0 h") that break numeric settings.
            const currentTimeSetting = Number(this.getSetting('total_work_time'));
            const currentAreaSetting = Number(this.getSetting('total_cleared_area'));
            const currentCountSetting = Number(this.getSetting('total_clean_count'));
            if (!Number.isFinite(currentTimeSetting)) {
                await this.setSettings({ total_work_time: 0 });
                await this.total_work_time_token.setValue(0);
            }
            if (!Number.isFinite(currentAreaSetting)) {
                await this.setSettings({ total_cleared_area: 0 });
                await this.total_cleared_area_token.setValue(0);
            }
            if (!Number.isFinite(currentCountSetting)) {
                await this.setSettings({ total_clean_count: 0 });
                await this.total_clean_count_token.setValue(0);
            }

            if (this.getSetting('total_work_time') === undefined) {
                const h = +((totals.clean_time || 0) / timeDiv).toFixed(3);
                await this.setSettings({ total_work_time: h });
                await this.total_work_time_token.setValue(h);
            }
            if (this.getSetting('total_cleared_area') === undefined) {
                const m2 = +((totals.clean_area || 0) / areaDiv).toFixed(3);
                await this.setSettings({ total_cleared_area: m2 });
                await this.total_cleared_area_token.setValue(m2);
            }
            if (this.getSetting('total_clean_count') === undefined) {
                const cnt = totals.clean_count || 0;
                await this.setSettings({ total_clean_count: cnt });
                await this.total_clean_count_token.setValue(cnt);
            } else {
                const robotCnt = totals.clean_count || 0;
                const current = Number(this.getSetting('total_clean_count'));
                if (robotCnt > current) {
                    await this.setSettings({ total_clean_count: robotCnt });
                    await this.total_clean_count_token.setValue(robotCnt);
                }
            }
            this.initialTokenTotal = true;
        } catch (err) {
            this.error('[ERROR] [CUSTOM_TOTALS] Failed:', err);
        }
    }

    async customVacuumConsumables(consumables) {
        try {
            let main_val = 0,
                side_val = 0,
                filter_val = 0;

            if (Array.isArray(consumables) && consumables.length) {
                const data = consumables[0];

                if (Object.prototype.hasOwnProperty.call(data, 'main_brush_work_time')) {
                    main_val = Number(data.main_brush_work_time) || 0;
                    const str = main_val + '%';
                    if (this.getSetting('main_brush_work_time') !== str) {
                        await this.setSettings({ main_brush_work_time: str });
                        if (this.main_brush_lifetime_token) await this.main_brush_lifetime_token.setValue(main_val);
                    }
                    if (main_val < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_main_brush_work_time')) {
                        await this.updateCapabilityValue('alarm_main_brush_work_time', true);
                        try {
                            await this.homey.flow.getDeviceTriggerCard('alertVacuum').trigger(this, { consumable: 'Main Brush', value: str });
                        } catch (_) {}
                    } else if (main_val > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_main_brush_work_time')) {
                        this.updateCapabilityValue('alarm_main_brush_work_time', false);
                    }
                }

                if (Object.prototype.hasOwnProperty.call(data, 'side_brush_work_time')) {
                    side_val = Number(data.side_brush_work_time) || 0;
                    const str = side_val + '%';
                    if (this.getSetting('side_brush_work_time') !== str) {
                        await this.setSettings({ side_brush_work_time: str });
                        if (this.side_brush_lifetime_token) await this.side_brush_lifetime_token.setValue(side_val);
                    }
                    if (side_val < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_side_brush_work_time')) {
                        await this.updateCapabilityValue('alarm_side_brush_work_time', true);
                        try {
                            await this.homey.flow.getDeviceTriggerCard('alertVacuum').trigger(this, { consumable: 'Side Brush', value: str });
                        } catch (_) {}
                    } else if (side_val > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_side_brush_work_time')) {
                        this.updateCapabilityValue('alarm_side_brush_work_time', false);
                    }
                }

                if (Object.prototype.hasOwnProperty.call(data, 'filter_work_time')) {
                    filter_val = Number(data.filter_work_time) || 0;
                    const str = filter_val + '%';
                    if (this.getSetting('filter_work_time') !== str) {
                        await this.setSettings({ filter_work_time: str });
                        if (this.filter_lifetime_token) await this.filter_lifetime_token.setValue(filter_val);
                    }
                    if (filter_val < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_filter_work_time')) {
                        await this.updateCapabilityValue('alarm_filter_work_time', true);
                        try {
                            await this.homey.flow.getDeviceTriggerCard('alertVacuum').trigger(this, { consumable: 'Filter', value: str });
                        } catch (_) {}
                    } else if (filter_val > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_filter_work_time')) {
                        this.updateCapabilityValue('alarm_filter_work_time', false);
                    }
                }

                if (!this.initialTokenConsumable) {
                    if (this.main_brush_lifetime_token) await this.main_brush_lifetime_token.setValue(main_val);
                    if (this.side_brush_lifetime_token) await this.side_brush_lifetime_token.setValue(side_val);
                    if (this.filter_lifetime_token) await this.filter_lifetime_token.setValue(filter_val);
                    this.initialTokenConsumable = true;
                }
            }
        } catch (error) {
            this.error('Error in customVacuumConsumables:', error);
        }
    }

    async getOrCreateToken(id, title) {
        try {
            return await this.homey.flow.createToken(id, { type: 'number', title });
        } catch (err) {
            if (err && err.statusCode === 409) return await this.homey.flow.getToken(id);
            if (err && err.message === 'token_not_registered') return await this.homey.flow.createToken(id, { type: 'number', title });
            throw err;
        }
    }

    async _accumulateJobTotals() {
        const prevRaw = Number(this.getSetting('total_clean_count'));
        const prev = Number.isFinite(prevRaw) ? prevRaw : 0;
        const next = prev + 1;
        await this.setSettings({ total_clean_count: next });
        await this.total_clean_count_token.setValue(next);
        this.log(`[DIAG] [FINAL] Clean count incremented: ${prev} → ${next}`);
    }

    async _addLiveDelta(deltaAreaRaw, deltaTimeRaw) {
        if (deltaAreaRaw <= 0 && deltaTimeRaw <= 0) return;
        const areaDiv = this._areaDivisor || 100;
        const timeDiv = this._timeDivisor || 3600;
        const deltaAreaM2 = deltaAreaRaw / areaDiv;
        const deltaHours = deltaTimeRaw / timeDiv;
        const prevAreaRaw = Number(this.getSetting('total_cleared_area'));
        const prevTimeRaw = Number(this.getSetting('total_work_time'));
        const prevArea = Number.isFinite(prevAreaRaw) ? prevAreaRaw : 0;
        const prevTime = Number.isFinite(prevTimeRaw) ? prevTimeRaw : 0;
        const newArea = +(prevArea + deltaAreaM2).toFixed(2);
        const newTime = +(prevTime + deltaHours).toFixed(3);
        const safeArea = Number.isFinite(newArea) ? newArea : 0;
        const safeTime = Number.isFinite(newTime) ? newTime : 0;
        await this.setSettings({ total_cleared_area: safeArea, total_work_time: safeTime });
        await this.total_cleared_area_token.setValue(safeArea);
        await this.total_work_time_token.setValue(safeTime);
        this.log(`[SESSION] deltaArea=${deltaAreaM2.toFixed(2)}m², deltaTime=${deltaHours.toFixed(2)}h`);
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (super.onSettings) await super.onSettings({ oldSettings, newSettings, changedKeys });

        const lifetimeKeys = ['total_work_time', 'total_cleared_area', 'total_clean_count'];
        const changedLifetime = changedKeys.filter((k) => lifetimeKeys.includes(k));
        if (!changedLifetime.length) return true;

        try {
            if (changedLifetime.includes('total_work_time')) {
                await this.total_work_time_token.setValue(parseFloat(newSettings.total_work_time) || 0);
            }
            if (changedLifetime.includes('total_cleared_area')) {
                await this.total_cleared_area_token.setValue(parseFloat(newSettings.total_cleared_area) || 0);
            }
            if (changedLifetime.includes('total_clean_count')) {
                await this.total_clean_count_token.setValue(parseInt(newSettings.total_clean_count) || 0);
            }
        } catch (err) {
            this.error('Failed to sync lifetime totals from settings', err);
            return Promise.reject(err);
        }
        return true;
    }

    prettyPrintProperties(rawProps, propertyDefs) {
        return rawProps
            .map((item) => {
                const def = propertyDefs.find((d) => d.siid === item.siid && d.piid === item.piid);
                const name = def ? def.did : `siid:${item.siid}/piid:${item.piid}`;
                return `${name}: ${item.value} (code:${item.code})`;
            })
            .join(', ');
    }


    _isValidRoomId(value) {
        const id = Number(value);
        return Number.isSafeInteger(id) && id > 0;
    }

    _normalizeRoomName(value) {
        if (typeof value !== 'string') return null;
        const name = value.trim();
        return name || null;
    }

    _roomNameKey(value) {
        const name = this._normalizeRoomName(value);
        return name ? name.toLowerCase() : null;
    }

    _normalizeRoomList(rooms, { fromStoredSetting = false } = {}) {
        if (!Array.isArray(rooms)) return [];

        return rooms
            .filter((room) => room && typeof room === 'object' && room.id != null)
            .map((room) => {
                const id = Number(room.id);
                if (!this._isValidRoomId(id)) return null;

                const suppliedName = this._normalizeRoomName(room.name);
                const normalizedRoom = {
                    ...room,
                    id,
                    name: suppliedName || ('Room ' + id)
                };

                // Room maps that only contain an ID get a display label, but that
                // label must never become a semantic alias for a future map.
                Object.defineProperty(normalizedRoom, '_hasSemanticRoomName', {
                    value:
                        Boolean(suppliedName) &&
                        (!fromStoredSetting || suppliedName !== ('Room ' + id)),
                    enumerable: false
                });

                return normalizedRoom;
            })
            .filter(Boolean);
    }

    _parseRoomsSetting(rawRooms) {
        let value = rawRooms;

        for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
            const text = value.trim();
            if (!text) return [];

            try {
                value = JSON.parse(text);
            } catch (_) {
                try {
                    value = JSON.parse(text.replace(/\\\"/g, '"'));
                } catch (_) {
                    return [];
                }
            }
        }

        return this._normalizeRoomList(value, { fromStoredSetting: true });
    }

    _parseRoomsPayload(rawValue) {
        let parsed = rawValue;

        for (let depth = 0; depth < 3 && typeof parsed === 'string'; depth += 1) {
            const text = parsed.trim();
            if (!text) return [];

            try {
                parsed = JSON.parse(text);
            } catch (_) {
                try {
                    parsed = JSON.parse(text.replace(/\\\"/g, '"'));
                } catch (_) {
                    return [];
                }
            }
        }

        let rooms = [];

        if (parsed && Array.isArray(parsed.rooms)) {
            rooms = parsed.rooms;
        } else if (parsed && Array.isArray(parsed.sections)) {
            rooms = parsed.sections;
        } else if (Array.isArray(parsed)) {
            rooms = parsed.filter((room) => room && typeof room === 'object' && room.id != null);
        } else if (parsed && Array.isArray(parsed.selects)) {
            const ids = Array.from(
                new Set(
                    parsed.selects
                        .flat()
                        .map((id) => Number(id))
                        .filter((id) => this._isValidRoomId(id))
                )
            );
            rooms = ids.map((id) => ({ id }));
        }

        return this._normalizeRoomList(rooms);
    }

    _getRoomSettingValue(key) {
        if (typeof this.getSetting !== 'function') return undefined;

        try {
            return this.getSetting(key);
        } catch (error) {
            this.error(
                '[ROOMS] Failed to read cached ' +
                key +
                ': ' +
                this._getSafeErrorDetails(error) +
                '.'
            );
            return undefined;
        }
    }

    _getCachedRoomsForCleaning() {
        return this._parseRoomsSetting(this._getRoomSettingValue('rooms'));
    }

    _getSemanticRoomName(room) {
        if (!room || room._hasSemanticRoomName === false) return null;
        return this._normalizeRoomName(room.name);
    }

    _normalizeRoomAlias(entry) {
        if (!entry || typeof entry !== 'object' || !this._isValidRoomId(entry.id)) {
            return null;
        }

        const name = this._normalizeRoomName(entry.name);
        if (!name) return null;

        return {
            id: Number(entry.id),
            name
        };
    }

    _mergeRoomAliasEntries(existingEntries, additions) {
        const aliases = [];

        for (const entry of [...(existingEntries || []), ...(additions || [])]) {
            const alias = this._normalizeRoomAlias(entry);
            if (!alias) continue;

            const aliasNameKey = this._roomNameKey(alias.name);
            const previousIndex = aliases.findIndex(
                (existing) =>
                    existing.id === alias.id &&
                    this._roomNameKey(existing.name) === aliasNameKey
            );
            if (previousIndex !== -1) aliases.splice(previousIndex, 1);
            aliases.push(alias);
        }

        return aliases.slice(-MAX_ROOM_ALIAS_ENTRIES);
    }

    _roomAliasEntriesFromRooms(rooms) {
        if (!Array.isArray(rooms)) return [];

        return rooms
            .map((room) => {
                if (!room || !this._isValidRoomId(room.id)) return null;
                const name = this._getSemanticRoomName(room);
                return name ? { id: Number(room.id), name } : null;
            })
            .filter(Boolean);
    }

    _getRoomAliasHistory() {
        if (this._roomAliasHistory) return this._roomAliasHistory;

        let storedHistory;
        try {
            storedHistory =
                typeof this.getStoreValue === 'function'
                    ? this.getStoreValue(ROOM_ALIAS_STORE_KEY)
                    : undefined;
        } catch (error) {
            this.error(
                '[ROOMS] Failed to read room-name aliases: ' +
                this._getSafeErrorDetails(error) +
                '.'
            );
            this._roomAliasHistory = { version: ROOM_ALIAS_SCHEMA_VERSION, aliases: [] };
            this._roomAliasHistoryPersisted = false;
            return this._roomAliasHistory;
        }

        if (typeof storedHistory === 'string') {
            try {
                storedHistory = JSON.parse(storedHistory);
            } catch (_) {
                storedHistory = null;
            }
        }

        const aliases =
            storedHistory &&
            storedHistory.version === ROOM_ALIAS_SCHEMA_VERSION &&
            Array.isArray(storedHistory.aliases)
                ? this._mergeRoomAliasEntries([], storedHistory.aliases)
                : [];

        this._roomAliasHistory = {
            version: ROOM_ALIAS_SCHEMA_VERSION,
            aliases
        };
        this._roomAliasHistoryPersisted = true;
        return this._roomAliasHistory;
    }

    async _persistRoomAliases(...roomLists) {
        const existingHistory = this._getRoomAliasHistory();
        const additions = roomLists.flatMap((rooms) => this._roomAliasEntriesFromRooms(rooms));
        const aliases = this._mergeRoomAliasEntries(existingHistory.aliases, additions);
        const nextHistory = {
            version: ROOM_ALIAS_SCHEMA_VERSION,
            aliases
        };
        const contentChanged = JSON.stringify(existingHistory) !== JSON.stringify(nextHistory);
        const historyIsDurable = this._roomAliasHistoryPersisted === true;

        this._roomAliasHistory = nextHistory;

        // A prior failed write leaves current aliases usable in memory, but they
        // must be retried before rooms settings can advance past their fallback.
        if (!contentChanged && historyIsDurable) {
            return { history: nextHistory, persisted: true };
        }

        try {
            await this.setStoreValue(ROOM_ALIAS_STORE_KEY, nextHistory);
        } catch (error) {
            this.error(
                '[ROOMS] Failed to persist room-name aliases: ' +
                this._getSafeErrorDetails(error) +
                '.'
            );
            this._roomAliasHistoryPersisted = false;
            return { history: nextHistory, persisted: false };
        }

        this._roomAliasHistoryPersisted = true;
        return { history: nextHistory, persisted: true };
    }

    _getRoomAliasesForResolution(cachedRooms) {
        const history = this._getRoomAliasHistory();
        return this._mergeRoomAliasEntries(
            history.aliases,
            this._roomAliasEntriesFromRooms(cachedRooms)
        );
    }

    async _resolveAdvancedRoomCleaningSelection(roomArgument) {
        // Room IDs can change after editing the map in Xiaomi Home. Resolve the
        // argument only after a live refresh; cached rooms are a read-failure
        // fallback and never replace a successfully parsed live map.
        const cachedRooms = this._getCachedRoomsForCleaning();
        let rooms = cachedRooms;

        try {
            const refreshedRooms = await this._refreshRoomsBeforeCleaning();
            if (refreshedRooms.length) rooms = refreshedRooms;
        } catch (error) {
            this.error(
                '[ROOMS] Refresh before room clean failed: ' +
                this._getSafeErrorDetails(error) +
                '; using cached room list.'
            );
        }

        return {
            rooms,
            selectedIds: this._resolveRoomIdsForCleaning(roomArgument, rooms, cachedRooms)
        };
    }

    _resolveRoomIdsForCleaning(roomArgument, currentRooms, cachedRooms) {
        const rooms = (Array.isArray(currentRooms) ? currentRooms : []).filter(
            (room) => room && this._isValidRoomId(room.id)
        );
        const aliases = this._getRoomAliasesForResolution(cachedRooms);
        const aliasesById = new Map();

        for (const alias of aliases) {
            const nameKey = this._roomNameKey(alias.name);
            if (!nameKey) continue;
            if (!aliasesById.has(alias.id)) aliasesById.set(alias.id, new Set());
            aliasesById.get(alias.id).add(nameKey);
        }

        const selectedIds = [];
        if (roomArgument === 'all') {
            selectedIds.push(...rooms.map((room) => Number(room.id)));
        } else {
            for (const rawToken of String(roomArgument || '').split(',')) {
                const token = rawToken.trim();
                if (!token) continue;

                if (/^\d+$/.test(token)) {
                    const requestedId = Number(token);
                    if (!this._isValidRoomId(requestedId)) {
                        this.log('[ROOMS] Requested numeric room id is not a positive integer.');
                        continue;
                    }

                    const exactCurrentRooms = rooms.filter(
                        (room) => Number(room.id) === requestedId
                    );
                    const historicalNames = aliasesById.get(requestedId) || new Set();

                    if (exactCurrentRooms.length === 1) {
                        const currentNameKey = this._roomNameKey(
                            this._getSemanticRoomName(exactCurrentRooms[0])
                        );
                        const isReused = [...historicalNames].some(
                            (historicalNameKey) =>
                                !currentNameKey || historicalNameKey !== currentNameKey
                        );

                        if (!isReused) {
                            selectedIds.push(Number(exactCurrentRooms[0].id));
                            continue;
                        }

                        this.log(
                            '[ROOMS] Requested numeric room id ' +
                            requestedId +
                            ' is ambiguous because the current room map reuses it.'
                        );
                        continue;
                    }

                    if (exactCurrentRooms.length > 1) {
                        this.log(
                            '[ROOMS] Requested numeric room id ' +
                            requestedId +
                            ' is ambiguous in the current room map.'
                        );
                        continue;
                    }

                    if (historicalNames.size !== 1) {
                        this.log(
                            '[ROOMS] Stale numeric room id ' +
                            requestedId +
                            ' has no unique historical room name.'
                        );
                        continue;
                    }

                    const [historicalNameKey] = historicalNames;
                    const replacementRooms = rooms.filter(
                        (room) =>
                            this._roomNameKey(this._getSemanticRoomName(room)) ===
                            historicalNameKey
                    );

                    if (replacementRooms.length === 1) {
                        const replacementId = Number(replacementRooms[0].id);
                        selectedIds.push(replacementId);
                        this.log(
                            '[ROOMS] Remapped stale numeric room id ' +
                            requestedId +
                            ' -> ' +
                            replacementId +
                            '.'
                        );
                    } else {
                        this.log(
                            '[ROOMS] Stale numeric room id ' +
                            requestedId +
                            ' does not uniquely match the current room map.'
                        );
                    }
                    continue;
                }

                const requestedNameKey = this._roomNameKey(token);
                const matchingRooms = requestedNameKey
                    ? rooms.filter(
                        (room) =>
                            this._roomNameKey(this._getSemanticRoomName(room)) ===
                            requestedNameKey
                    )
                    : [];

                if (matchingRooms.length === 1) {
                    selectedIds.push(Number(matchingRooms[0].id));
                } else if (matchingRooms.length > 1) {
                    this.log('[ROOMS] Requested room name is ambiguous in the current room map.');
                } else {
                    this.log('[ROOMS] Requested room name is not present in the current room map.');
                }
            }
        }

        return Array.from(new Set(selectedIds.filter((id) => this._isValidRoomId(id))));
    }

    _roomListSignature(rooms) {
        return this._normalizeRoomList(rooms)
            .map((room) => ({
                id: Number(room.id),
                name: String(room.name || '')
            }))
            .sort((a, b) => a.id - b.id || a.name.localeCompare(b.name))
            .map((room) => room.id + ':' + room.name)
            .join('|');
    }

    async _refreshRoomsBeforeCleaning() {
        if (
            !this.deviceProperties ||
            !this.deviceProperties.supports ||
            !this.deviceProperties.supports.rooms
        ) {
            return [];
        }

        const candidates = [];

        if (
            Array.isArray(this.deviceProperties.get_rooms) &&
            this.deviceProperties.get_rooms.length
        ) {
            candidates.push(this.deviceProperties.get_rooms);
        }

        // Existing fallback locations retained from the 3.5.19 discovery code.
        candidates.push(
            [{ did: 'rooms', siid: 4, piid: 20 }],
            [{ did: 'rooms', siid: 6, piid: 15 }],
            [{ did: 'rooms', siid: 7, piid: 3 }]
        );

        let lastError = null;

        for (const definition of candidates) {
            let result;
            try {
                result = await this.callVacuumGetProperties(definition, { retries: 2 });
            } catch (error) {
                lastError = error;
                continue;
            }

            if (
                !Array.isArray(result) ||
                !result[0] ||
                result[0].value == null ||
                result[0].value === ''
            ) {
                continue;
            }

            const rooms = this._parseRoomsPayload(result[0].value);
            if (!rooms.length) continue;

            const previousRoomsSetting = this._getRoomSettingValue('rooms');
            const previousRooms = this._parseRoomsSetting(previousRoomsSetting);
            const previousSignature = this._roomListSignature(previousRooms);
            const newSignature = this._roomListSignature(rooms);

            // Persist the old map before replacing its setting. Including the live
            // map also keeps the next refresh recoverable if setting persistence
            // fails after this action has already used the fresh data.
            const aliasPersistence = await this._persistRoomAliases(previousRooms, rooms);

            const settings = {
                rooms: JSON.stringify(rooms),
                rooms_display: rooms.map((room) => room.name || ('Room ' + room.id)).join(', ')
            };
            const previousRoomsDisplay = this._getRoomSettingValue('rooms_display');

            const settingsChanged =
                previousRoomsSetting !== settings.rooms ||
                previousRoomsDisplay !== settings.rooms_display;

            if (!aliasPersistence.persisted && settingsChanged) {
                this.error(
                    '[ROOMS] Skipped persisting refreshed room map because room-name aliases were not persisted; retaining cached room map.'
                );
            } else if (settingsChanged) {
                try {
                    await this.setSettings(settings);
                } catch (error) {
                    this.error(
                        '[ROOMS] Failed to persist refreshed room map: ' +
                        this._getSafeErrorDetails(error) +
                        '.'
                    );
                }
            }

            this._roomsDiscovered = true;

            if (previousSignature !== newSignature) {
                this.log(
                    '[ROOMS] Room map refreshed before cleaning: ' +
                    (previousSignature || '(none)') +
                    ' -> ' +
                    newSignature
                );
            } else {
                this.log('[ROOMS] Room map checked before cleaning: unchanged.');
            }

            return rooms;
        }

        if (lastError) throw lastError;
        throw new Error('No parsable room data returned by the vacuum.');
    }

    getModelIdentifier() {
        return this._model || (this.getStoreValue ? this.getStoreValue('model') : undefined);
    }

    _serializeRoomList(selectedIds) {
        const roomList = selectedIds.join(',');
        if (selectedIds.length === 1 && this.getModelIdentifier() !== 'xiaomi.vacuum.d102gl') {
            return `${roomList},${roomList}`;
        }
        return roomList;
    }

    _queuePropertyOperation(operation) {
        if (!this._propertyOperationQueue) {
            this._propertyOperationQueue = Promise.resolve();
        }

        const queuedOperation = this._propertyOperationQueue
            .catch(() => {})
            .then(operation);

        this._propertyOperationQueue = queuedOperation.catch(() => {});
        return queuedOperation;
    }

    callVacuumGetProperties(properties, options = { retries: 2 }) {
        return this._queuePropertyOperation(() => {
            const chunkSize = GET_PROPERTIES_CHUNK_SIZE[this.getModelIdentifier()] ?? DEFAULT_GET_PROPERTIES_CHUNK_SIZE;
            return this.callMiotGetProperties(properties, { ...options, chunkSize, delayMs: GET_PROPERTIES_CHUNK_DELAY_MS });
        });
    }

    _getSafeErrorDetails(error) {
        const rawMessage = error && typeof error.message === 'string' ? error.message : 'Unknown error';
        const safeMessage = rawMessage
            .replace(/\b(password|token|secret|api[_-]?key|authorization|cookie)\b\s*[:=]\s*[^,;\r\n]*/gi, '$1=[redacted]')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 180) || 'Unknown error';
        const rawCode = error && error.code != null ? String(error.code) : '';
        const safeCode = /^[A-Za-z0-9_.-]{1,64}$/.test(rawCode) ? rawCode : '';

        return safeCode ? `${safeMessage} (code: ${safeCode})` : safeMessage;
    }

    async _handleMainPollFailure(error) {
        const failures = (this._mainPollFailures || 0) + 1;
        this._mainPollFailures = failures;
        const details = this._getSafeErrorDetails(error);

        if (failures < 3) {
            this.error(`[POLL] Main property read failed (${failures}/3): ${details}; keeping the current connection and polling.`);
            return;
        }

        this._mainPollFailures = 0;
        this.homey.clearInterval(this.pollingInterval);
        if (this.recreateTimeout !== undefined && this.recreateTimeout !== null) {
            this.homey.clearTimeout(this.recreateTimeout);
        }

        try {
            await this.setUnavailable(this.homey.__('device.unreachable'));
        } catch (error) {
            this.error(`[POLL] Failed to mark device unavailable after repeated property read failures: ${this._getSafeErrorDetails(error)}.`);
        }

        this.recreateTimeout = this.homey.setTimeout(() => {
            this.recreateTimeout = null;
            this.createDevice();
        }, 60000);
        this.error(`[POLL] Main property read failed (3/3): ${details}; reconnecting in 60 seconds.`);
    }

    callVacuumSetProperties(properties, options = { retries: 2 }) {
        return this._queuePropertyOperation(() => {
            if (this.getModelIdentifier() === 'xiaomi.vacuum.d109gl') {
                return this.callMiotSetProperties(properties, options);
            }
            if (!this.miio || typeof this.miio.call !== 'function') {
                throw new Error('MIoT set_properties requires an active miio device with callable call');
            }
            return this.miio.call('set_properties', properties, options);
        });
    }

    mapMopModeInbound(raw) {
        if (raw == null) return null;
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const mapping = ['1', '2', '3', '4'];
            const idx = Number(raw);
            return Number.isNaN(idx) ? '1' : (mapping[idx] !== undefined ? mapping[idx] : '1');
        }
        return String(raw);
    }

    mapMopModeOutbound(value) {
        if (value == null) return null;
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const mapping = { '1': 0, '2': 1, '3': 2, '4': 3 };
            const mapped = mapping[String(value)];
            return mapped !== undefined ? mapped : 0;
        }
        const numericValue = Number(value);
        return Number.isNaN(numericValue) ? null : numericValue;
    }

    mapCleaningModeInbound(raw) {
        if (raw == null) return null;
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c108') {
            const mapping = ['1', '2', '3'];
            const idx = Number(raw);
            return Number.isNaN(idx) ? '1' : (mapping[idx] !== undefined ? mapping[idx] : '1');
        }
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const mapping = ['1', '2', '3', '4'];
            const idx = Number(raw);
            return Number.isNaN(idx) ? '1' : (mapping[idx] !== undefined ? mapping[idx] : '1');
        }
        return String(raw);
    }

    mapCleaningModeOutbound(value) {
        if (value == null) return null;
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c108') {
            const mapping = { '1': 0, '2': 1, '3': 2 };
            const mapped = mapping[String(value)];
            return mapped !== undefined ? mapped : 0;
        }
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const mapping = { '1': 0, '2': 1, '3': 2, '4': 3 };
            const mapped = mapping[String(value)];
            return mapped !== undefined ? mapped : 0;
        }
        const numericValue = Number(value);
        return Number.isNaN(numericValue) ? null : numericValue;
    }

    mapWaterLevelInbound(raw) {
        if (raw == null) return null;
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const mapping = ['1', '2', '3'];
            const idx = Number(raw);
            return Number.isNaN(idx) ? '1' : (mapping[idx] !== undefined ? mapping[idx] : '1');
        }
        if (this.getModelIdentifier() === 'xiaomi.vacuum.b108gl') {
            const numeric = Number(raw);
            if (Number.isNaN(numeric)) return '1';
            if (numeric <= 0) return '1';
            if (numeric > 3) return '3';
            return String(numeric);
        }
        return String(raw);
    }

    mapWaterLevelOutbound(value) {
        if (value == null) return null;
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const mapping = { '1': 0, '2': 1, '3': 2 };
            const mapped = mapping[String(value)];
            return mapped !== undefined ? mapped : 0;
        }
        const numericValue = Number(value);
        return Number.isNaN(numericValue) ? null : numericValue;
    }

    mapPathModeInbound(raw) {
        if (raw == null) return null;
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const idx = Number(raw);
            if (Number.isNaN(idx)) return '1';
            const bounded = Math.max(0, Math.min(2, idx));
            return String(bounded + 1);
        }
        return String(raw);
    }

    mapPathModeOutbound(value) {
        if (value == null) return null;
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const mapping = { '1': 0, '2': 1, '3': 2 };
            const mapped = mapping[String(value)];
            return mapped !== undefined ? mapped : 1;
        }
        const numericValue = Number(value);
        return Number.isNaN(numericValue) ? null : numericValue;
    }

    mapCarpetModeInbound(raw) {
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            if (raw == null) return null;
            const mode = Number(raw);
            if (mode === 0) return '2';
            if (mode === 1) return '0';
            return null;
        }
        if (raw == null) return null;
        return String(raw);
    }

    buildCarpetModeSetPayload(value) {
        const model = this.getModelIdentifier();
        const desired = String(value);
        if (model === 'xiaomi.vacuum.c102gl') {
            const primary = this.deviceProperties.set_properties.carpet_avoidance;
            if (!primary) return { payload: [], state: this._carpetModeState };
            const toggle = this.deviceProperties.set_properties.carpet_avoidance_toggle;
            const payload = [];
            const pushToggle = (val) => {
                if (toggle) payload.push({ siid: toggle.siid, piid: toggle.piid, value: val });
            };
            switch (desired) {
                case '0':
                    payload.push({ siid: primary.siid, piid: primary.piid, value: 1 });
                    pushToggle(0);
                    return { payload, state: '0' };
                case '1':
                    payload.push({ siid: primary.siid, piid: primary.piid, value: 1 });
                    pushToggle(1);
                    return { payload, state: '1' };
                case '2':
                    payload.push({ siid: primary.siid, piid: primary.piid, value: 0 });
                    pushToggle(0);
                    return { payload, state: '2' };
                case '3':
                    payload.push({ siid: primary.siid, piid: primary.piid, value: 1 });
                    pushToggle(0);
                    return { payload, state: '3' };
                default:
                    return { payload: [], state: this._carpetModeState };
            }
        }
        if (model === 'xiaomi.vacuum.b108gl') {
            const primary = this.deviceProperties.set_properties.carpet_avoidance;
            if (!primary) {
                return { payload: [], state: this._carpetModeState };
            }
            const normalizedValue = desired === '3' ? 0 : Number(desired);
            if (Number.isNaN(normalizedValue)) {
                return { payload: [], state: this._carpetModeState };
            }
            return {
                payload: [{ siid: primary.siid, piid: primary.piid, value: normalizedValue }],
                state: String(normalizedValue)
            };
        }
        const primary = this.deviceProperties.set_properties.carpet_avoidance;
        if (!primary) {
            return { payload: [], state: desired };
        }
        const numericValue = Number(desired);
        if (Number.isNaN(numericValue)) {
            return { payload: [], state: this._carpetModeState };
        }
        return {
            payload: [{ siid: primary.siid, piid: primary.piid, value: numericValue }],
            state: desired
        };
    }

    async _runOneTimeMiotScan() {
        try {
            if (!this.miio || typeof this.miio.call !== 'function') return;
            const results = [];
            // conservative range to avoid heavy traffic; adjust if needed
            for (let siid = 1; siid <= 18; siid++) {
                for (let piid = 1; piid <= 30; piid++) {
                    try {
                        const res = await this.callVacuumGetProperties([{ siid, piid }], { retries: 2 });
                        if (Array.isArray(res) && res[0] && res[0].code === 0) {
                            results.push({ siid, piid, value: res[0].value });
                        }
                    } catch (_) {
                        // ignore invalid combos
                    }
                }
            }
            this.log('[MIOT_SCAN]', results.length ? JSON.stringify(results) : 'no readable properties in range');
        } catch (e) {
            this.error('[MIOT_SCAN] error', e);
        }
    }
}

module.exports = XiaomiVacuumMiotDeviceMax;

