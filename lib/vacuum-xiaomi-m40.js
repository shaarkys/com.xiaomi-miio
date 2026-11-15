'use strict';

// M40 v2: https://home.miot-spec.com/spec/xiaomi.vacuum.d110ch
// Fault meanings cross-checked against openHAB's exact d110ch profile and
// Tasshack/dreame-vacuum. These are not the X20 Max's fault numbers.
const MODEL = 'xiaomi.vacuum.d110ch';
const ERROR_CODES = {
    0: 'Everything-is-ok',
    1: 'Wheels suspended',
    2: 'Robot suspended',
    3: 'Bumper stuck',
    4: 'Robot tilted',
    5: 'Repeated bumper obstruction',
    6: 'Repeated wheel suspension',
    8: 'Dust box missing',
    12: 'Main brush tangled',
    13: 'Side brush tangled',
    15: 'Left wheel blocked',
    16: 'Right wheel blocked',
    17: 'Robot stuck while turning',
    18: 'Robot stuck while moving forward',
    20: 'Low battery',
    21: 'Charging failed',
    31: 'Left wheel speed fault',
    32: 'Right wheel speed fault',
    48: 'Laser sensor bumper fault',
    49: 'Laser sensor bumper stuck',
    51: 'Filter wet or obstructed',
    61: 'Obstacle prevents access',
    62: 'Virtual wall prevents access',
    63: 'Door blocks cleaning path',
    64: 'Cleaning area out of reach',
    65: 'Robot in restricted area',
    69: 'Mop tray removed',
    70: 'Mop tray removed during mapping',
    71: 'Mop tray stuck',
    72: 'Mop tray motor fault',
    101: 'Dust bag full or air duct obstructed',
    102: 'Dust bag missing',
    103: 'Dust collector cover open',
    104: 'Dust collection obstructed',
    105: 'Clean water tank missing',
    106: 'Dirty water tank missing',
    107: 'Clean water tank empty',
    108: 'Dirty water tank full',
    111: 'Wash tray missing',
    112: 'Wash tray water level too high (112)',
    116: 'Clean water tank empty (116)',
    118: 'Dirty water tank fault (118)',
    119: 'Wash tray water level too high (119)'
};

const properties = {
    get_rooms: [],
    get_properties: [
        { did: 'device_status', siid: 2, piid: 1 },
        { did: 'device_fault', siid: 2, piid: 2 },
        { did: 'cleaning_mode', siid: 2, piid: 3 },
        { did: 'mode', siid: 2, piid: 6 },
        { did: 'water_level', siid: 2, piid: 8 },
        { did: 'battery', siid: 3, piid: 1 },
        { did: 'main_brush_life_level', siid: 9, piid: 2 },
        { did: 'side_brush_life_level', siid: 10, piid: 2 },
        { did: 'filter_life_level', siid: 11, piid: 1 },
        { did: 'total_clean_time', siid: 12, piid: 2 },
        { did: 'total_clean_count', siid: 12, piid: 3 },
        { did: 'total_clean_area', siid: 12, piid: 4 },
        { did: 'fault_ids', siid: 4, piid: 18 }
    ],
    set_properties: {
        start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
        stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
        home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] },
        find: { siid: 7, aiid: 1, did: 'call-7-1', in: [] },
        mopmode: { siid: 2, piid: 6 },
        cleaning_mode: { siid: 2, piid: 3 },
        water_level: { siid: 2, piid: 8 }
    },
    supports: {
        rooms: false,
        mopmode: true,
        cleaning_mode: true,
        water_level: true,
        clean_times: false,
        path_mode: false,
        carpet_avoidance: false,
        consumables: true,
        detergent: false
    },
    scale: { area_divisor: 1, time_divisor: 60 },
    error_codes: ERROR_CODES,
    status_mapping: {
        cleaning: [1, 7, 12, 23],
        spot_cleaning: [],
        docked: [8, 9, 13, 14, 19, 21, 22, 30],
        charging: [5, 6, 10],
        stopped: [2, 3, 11],
        stopped_error: [4]
    }
};

// Both fault sources must report valid success before we clear alarms. A failed
// or malformed read must not turn a previously observed water fault into OK.
function getFaultStatus(primary, additional) {
    const primaryValid = primary && primary.code === 0
        && Number.isInteger(primary.value) && primary.value >= 0 && primary.value <= 255;
    const text = additional && additional.code === 0 && typeof additional.value === 'string'
        ? additional.value.trim() : null;
    const additionalValid = text !== null && /^(?:\d+(?:\s*,\s*\d+)*)?$/.test(text)
        && text.length <= 1024 && text.split(',').every((value) => Number(value) <= 255);
    const codes = new Set();
    if (primaryValid && primary.value !== 0) codes.add(primary.value);
    if (additionalValid && text !== '') {
        for (const value of text.split(',')) {
            const code = Number(value);
            if (code !== 0) codes.add(code);
        }
    }
    if (!codes.size && (!primaryValid || !additionalValid)) return null;
    const ordered = [...codes].sort((a, b) => a - b);
    return {
        message: ordered.length ? ordered.map((code) => ERROR_CODES[code] || `M40 fault ${code}`).join('; ') : ERROR_CODES[0],
        waterShortage: ordered.some((code) => code === 107 || code === 116),
        complete: !!(primaryValid && additionalValid)
    };
}

module.exports = { MODEL, properties, getFaultStatus };
