'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.vacuum.d109gl // Xiaomi Robot Vacuum X20 Max
// https://home.miot-spec.com/spec/xiaomi.vacuum.d102gl // Xiaomi Robot Vacuum X20 Pro
// https://home.miot-spec.com/spec/xiaomi.vacuum.c102gl // Xiaomi Robot Vacuum X20 / X20+

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
    // Robot is actively moving or its station is working
    cleaning: [4, 7, 8, 10, 12, 16, 17, 19],

    // Not used on the X20 Max (kept for compatibility)
    spot_cleaning: [],

    // Robot is on the dock and NOT charging, or the station is busy
    docked: [9, 11, 14, 68], // ← include 68 seen in your logs

    // Robot is charging or driving home to charge
    charging: [2, 6, 13, 21],

    // Robot is paused, waiting, or user-interrupted
    stopped: [1, 3, 5, 18, 20],

    // A real fault state that needs user attention
    stopped_error: [15]
};

/** Model → property-set */
const mapping = {
    'xiaomi.vacuum.d109gl': 'properties_d109gl', // X20 Max
    'xiaomi.vacuum.d102gl': 'properties_d109gl', // X20 Pro (unchanged/working)
    'xiaomi.vacuum.c102gl': 'properties_c102gl' // X20 / X20+ (room action aiid 3, input piid 4)
};

/** Property sets */
const properties = {
    /* Baseline (d109gl / d102gl) */
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
        error_codes: ERROR_CODES,
        status_mapping: STATUS_MAPPING
    },

    /* X20 / X20+ (c102gl) — identical except room clean action (aiid 3, piid 4). */
    properties_c102gl: {
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
            // X20+/X20 specific
            room_clean_action: { siid: 2, aiid: 3, piid: 4 },
            carpet_avoidance: { siid: 2, piid: 73 }
        },
        error_codes: ERROR_CODES,
        status_mapping: STATUS_MAPPING
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
            this.log(`[DEBUG] MIOT property value for "${propName}" (siid: ${propDef.siid}, piid: ${propDef.piid}) not found in result.`);
        }
        return found;
    }

    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            // GENERIC DEVICE INIT ACTIONS
            this.bootSequence();

            // Add missing capabilities during upgrades
            if (!this.hasCapability('alarm_water_shortage')) {
                await this.addCapability('alarm_water_shortage');
            }
            if (!this.hasCapability('vacuum_xiaomi_carpet_mode_max')) {
                await this.addCapability('vacuum_xiaomi_carpet_mode_max');
            }

            // remember the last reported state so we can spot transitions
            this.lastVacState = 'unknown';
            // Track the session-internal progress (0.01 m² and seconds)
            this._prevArea01 = 0;
            this._prevTimeSec = 0;

            // Track session start values
            this._sessionStartArea = 0;
            this._sessionStartTime = 0;
            this._isSessionActive = false;
            this._forceRefreshTotals = false;

            // DEVICE VARIABLES
            const model = this.getStoreValue('model');
            this.deviceProperties = properties[mapping[model]] || properties.properties_d109gl;

            // Use our safe totals handler for d109gl and c102gl to avoid invalid_setting_type
            if (['xiaomi.vacuum.d109gl', 'xiaomi.vacuum.c102gl'].includes(model)) {
                this.log(`Using custom vacuumTotals/consumables for ${model}`);
                this.vacuumTotals = this.customVacuumTotals;
                this.vacuumConsumables = this.customVacuumConsumables;
            }

            // RESET CONSUMABLE ALARMS
            this.updateCapabilityValue('alarm_main_brush_work_time', false);
            this.updateCapabilityValue('alarm_side_brush_work_time', false);
            this.updateCapabilityValue('alarm_filter_work_time', false);

            // DEVICE TOKENS
            this.main_brush_lifetime_token = await this.getOrCreateToken('main_brush_lifetime' + this.getData().id, `Main Brush Lifetime ${this.getName()} (%)`);
            this.side_brush_lifetime_token = await this.getOrCreateToken('side_brush_lifetime' + this.getData().id, `Side Brush Lifetime ${this.getName()} (%)`);
            this.filter_lifetime_token = await this.getOrCreateToken('filter_lifetime' + this.getData().id, `Filter Lifetime ${this.getName()} (%)`);
            this.sensor_dirty_lifetime_token = await this.getOrCreateToken('sensor_dirty_lifetime' + this.getData().id, `Sensor Dirty Lifetime ${this.getName()} (%)`);
            this.total_work_time_token = await this.getOrCreateToken('total_work_time' + this.getData().id, `Total Work Time ${this.getName()} (h)`);
            this.total_cleared_area_token = await this.getOrCreateToken('total_cleared_area' + this.getData().id, `Total Cleaned Area ${this.getName()} (m²)`);
            this.total_clean_count_token = await this.getOrCreateToken('total_clean_count' + this.getData().id, `Total Clean Count ${this.getName()}`);

            // FLOW TRIGGER CARDS
            this.homey.flow.getDeviceTriggerCard('alertVacuum');
            this.homey.flow.getDeviceTriggerCard('statusVacuum');

            this.homey.flow.getActionCard('advanced_room_cleaning').registerRunListener(async (args, state) => {
                let selected_room = '';
                let list_room;
                try {
                    list_room = JSON.parse(args.device.getSetting('rooms'));
                } catch (e) {
                    this.error('Rooms list in settings is invalid or missing.', e);
                    return Promise.reject('Room list is not available. Please sync device first.');
                }
                if (args.room == 'all') {
                    selected_room = list_room.map((el) => el.id);
                } else {
                    selected_room = [];
                    for (const nameRaw of args.room.split(',')) {
                        const name = nameRaw.toLowerCase().trim();
                        const match = list_room.find((el) => el.name.toLowerCase() === name);
                        if (match) selected_room.push(match.id);
                    }
                }

                if (selected_room.length === 0) {
                    this.error(`No valid room selected for advanced cleaning. Requested: "${args.room}", Available: "${list_room.map((r) => r.name).join(', ')}"`);
                    return Promise.reject(`No valid room selected. Requested: "${args.room}". Available: ${list_room.map((r) => r.name).join(', ')}.`);
                }

                let room_list = selected_room.join(',');
                if (selected_room.length == 1) room_list += ',' + room_list; // single-room workaround

                let propertiesToSet = [
                    {
                        siid: this.deviceProperties.set_properties.mopmode.siid,
                        piid: this.deviceProperties.set_properties.mopmode.piid,
                        value: Number(args.mode)
                    },
                    {
                        siid: this.deviceProperties.set_properties.path_mode.siid,
                        piid: this.deviceProperties.set_properties.path_mode.piid,
                        value: Number(args.accuracy)
                    }
                ];

                if (args.mode == 1 || args.mode == 3) {
                    propertiesToSet.push({
                        siid: this.deviceProperties.set_properties.cleaning_mode.siid,
                        piid: this.deviceProperties.set_properties.cleaning_mode.piid,
                        value: Number(args.mode_sweep)
                    });
                }
                if (args.mode == 2 || args.mode == 3) {
                    propertiesToSet.push({
                        siid: this.deviceProperties.set_properties.water_level.siid,
                        piid: this.deviceProperties.set_properties.water_level.piid,
                        value: Number(args.mode_mop)
                    });
                }

                if (typeof args.carpet_avoidance !== 'undefined') {
                    propertiesToSet.push({
                        siid: this.deviceProperties.set_properties.carpet_avoidance.siid,
                        piid: this.deviceProperties.set_properties.carpet_avoidance.piid,
                        value: Number(args.carpet_avoidance)
                    });
                }

                let actions = {
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

                // debug
                this.log(
                    '[ADV_ROOM_CLEAN] Cleaning rooms:',
                    room_list,
                    '| Room names:',
                    selected_room
                        .map((id) => {
                            let room = list_room.find((r) => r.id === id);
                            return room ? room.name : id;
                        })
                        .join(', ')
                );

                this.log('[ADV_ROOM_CLEAN] → Sending set_properties payload:', JSON.stringify(propertiesToSet));
                this.log('[ADV_ROOM_CLEAN] → Sending action payload:', JSON.stringify(actions));

                if (args.device.miio && typeof args.device.miio.call === 'function') {
                    let responseProperties = await args.device.miio.call('set_properties', propertiesToSet, { retries: 1 });
                    this.log('[ADV_ROOM_CLEAN] Properties response:', JSON.stringify(responseProperties));
                    let responseAction = await args.device.miio.call('action', actions, { retries: 3 });
                    this.log('[ADV_ROOM_CLEAN] Action response:', JSON.stringify(responseAction));
                } else {
                    this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
                    this.createDevice();
                    return Promise.reject('Device unreachable, please try again ...');
                }
            });

            // Register action cards globally
            this.homey.flow.getActionCard('set_sweep_mop_type').registerRunListener(async ({ device, mode }) => {
                const modeValue = Number(mode);
                return device.miio.call('set_properties', [{ siid: device.deviceProperties.set_properties.mopmode.siid, piid: device.deviceProperties.set_properties.mopmode.piid, value: modeValue }], { retries: 1 });
            });

            this.homey.flow.getActionCard('set_cleaning_mode').registerRunListener(async ({ device, power }) => {
                const powerValue = Number(power);
                return device.miio.call('set_properties', [{ siid: device.deviceProperties.set_properties.cleaning_mode.siid, piid: device.deviceProperties.set_properties.cleaning_mode.piid, value: powerValue }], { retries: 1 });
            });

            this.homey.flow.getActionCard('set_water_level').registerRunListener(async ({ device, level }) => {
                const levelValue = Number(level);
                return device.miio.call('set_properties', [{ siid: device.deviceProperties.set_properties.water_level.siid, piid: device.deviceProperties.set_properties.water_level.piid, value: levelValue }], { retries: 1 });
            });

            this.homey.flow.getActionCard('set_path_mode').registerRunListener(async ({ device, mode }) => {
                const pathValue = Number(mode);
                return device.miio.call('set_properties', [{ siid: device.deviceProperties.set_properties.path_mode.siid, piid: device.deviceProperties.set_properties.path_mode.piid, value: pathValue }], { retries: 1 });
            });

            this.homey.flow.getActionCard('set_carpet_avoidance').registerRunListener(async ({ device, mode }) => {
                const numericValue = Number(mode);
                return device.miio.call('set_properties', [{ siid: device.deviceProperties.set_properties.carpet_avoidance.siid, piid: device.deviceProperties.set_properties.carpet_avoidance.piid, value: numericValue }], { retries: 1 });
            });

            // Capability listeners
            this.registerCapabilityListener('vacuum_xiaomi_carpet_mode_max', async (value) => {
                try {
                    const numericValue = Number(value);
                    this.log(`Setting carpet_avoidance to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.carpet_avoidance.siid, piid: this.deviceProperties.set_properties.carpet_avoidance.piid, value: numericValue }], { retries: 1 });
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((err) => this.error(err));
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again …');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            this.registerCapabilityListener('onoff', async (value) => {
                try {
                    if (this.miio) {
                        if (value) return await this.miio.call('action', this.deviceProperties.set_properties.start_clean, { retries: 1 });
                        return await this.miio.call('action', this.deviceProperties.set_properties.stop_clean, { retries: 1 });
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

            this.registerCapabilityListener('vacuum_xiaomi_mop_mode_max', async (value) => {
                try {
                    const numericValue = Number(value);
                    this.log(`Setting Sweep & Mop Mode to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.mopmode.siid, piid: this.deviceProperties.set_properties.mopmode.piid, value: numericValue }], { retries: 1 });
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

            this.registerCapabilityListener('vacuum_xiaomi_cleaning_mode_max', async (value) => {
                try {
                    const numericValue = Number(value);
                    this.log(`Setting Cleaning Power to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.cleaning_mode.siid, piid: this.deviceProperties.set_properties.cleaning_mode.piid, value: numericValue }], { retries: 1 });
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

            this.registerCapabilityListener('vacuum_xiaomi_water_level_max', async (value) => {
                try {
                    const numericValue = Number(value);
                    this.log(`Setting Water Output to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.water_level.siid, piid: this.deviceProperties.set_properties.water_level.piid, value: numericValue }], { retries: 1 });
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

            this.registerCapabilityListener('vacuum_xiaomi_path_mode_max', async (value) => {
                try {
                    const numericValue = Number(value);
                    this.log(`Setting Path Mode to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.path_mode.siid, piid: this.deviceProperties.set_properties.path_mode.piid, value: numericValue }], { retries: 1 });
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
        } catch (error) {
            this.error(error);
        }
    }

    async retrieveDeviceData() {
        try {
            const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
            const result_rooms = await this.miio.call('get_properties', this.deviceProperties.get_rooms, { retries: 1 });

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
            const mop_mode = this.getMiotProp(result, 'mode');
            const battery = this.getMiotProp(result, 'battery');
            const main_brush_life_level = this.getMiotProp(result, 'main_brush_life_level');
            const side_brush_life_level = this.getMiotProp(result, 'side_brush_life_level');
            const filter_life_level = this.getMiotProp(result, 'filter_life_level');
            const total_clean_time = this.getMiotProp(result, 'total_clean_time');
            const total_clean_count = this.getMiotProp(result, 'total_clean_count');
            const total_clean_area = this.getMiotProp(result, 'total_clean_area');
            const device_fault = this.getMiotProp(result, 'device_fault');
            const cleaning_mode = this.getMiotProp(result, 'cleaning_mode');
            const water_level = this.getMiotProp(result, 'water_level');
            const path_mode = this.getMiotProp(result, 'path_mode');
            const carpet_avoidance = this.getMiotProp(result, 'carpet_avoidance');

            const consumables = [
                {
                    main_brush_work_time: main_brush_life_level ? main_brush_life_level.value : 0,
                    side_brush_work_time: side_brush_life_level ? side_brush_life_level.value : 0,
                    filter_work_time: filter_life_level ? filter_life_level.value : 0
                }
            ];

            const totalsReport = {
                clean_time: total_clean_time ? total_clean_time.value : 0,
                clean_count: total_clean_count ? total_clean_count.value : 0,
                clean_area: total_clean_area ? total_clean_area.value : 0
            };

            /* onoff & vacuumcleaner_state */
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

            // state change log (only when changed)
            const lastLogState = this._lastStatusLogState || {};
            const currLogState = {
                device_status: device_status ? device_status.value : 'n/a',
                stateKey: stateKey,
                lastVacState: this.lastVacState
            };
            if (currLogState.device_status !== lastLogState.device_status || currLogState.stateKey !== lastLogState.stateKey || currLogState.lastVacState !== lastLogState.lastVacState) {
                this.log(`status code = ${currLogState.device_status}`, `→ key = ${currLogState.stateKey}`, `| lastVacState = ${currLogState.lastVacState}`);
                this._lastStatusLogState = currLogState;
            }

            // SESSION handling (unchanged)
            if (stateKey === 'cleaning' && !this._isSessionActive) {
                this._isSessionActive = true;
                this._prevArea01 = total_clean_area ? total_clean_area.value : 0;
                this._prevTimeSec = total_clean_time ? total_clean_time.value : 0;
                this._sessionStartArea = this._prevArea01;
                this._sessionStartTime = this._prevTimeSec;
                this.log(`[SESSION] Cleaning started: startArea(0.01m²)=${this._sessionStartArea}, startTime(sec)=${this._sessionStartTime}`);
            }

            if (stateKey === 'cleaning' && this._isSessionActive) {
                let currentArea01 = total_clean_area ? total_clean_area.value : 0;
                let currentTimeSec = total_clean_time ? total_clean_time.value : 0;
                let deltaArea01 = currentArea01 - this._prevArea01;
                let deltaTimeSec = currentTimeSec - this._prevTimeSec;

                if (deltaArea01 > 0 || deltaTimeSec > 0) {
                    let deltaAreaM2 = deltaArea01 / 100;
                    let deltaHours = deltaTimeSec / 3600;

                    this.log(`[SESSION] Incremental delta: Δarea=${deltaAreaM2.toFixed(2)}m² (Δarea01=${deltaArea01}), Δtime=${deltaHours.toFixed(2)}h (Δsec=${deltaTimeSec})`);

                    await this._addLiveDelta(deltaAreaM2, deltaHours);

                    this._prevArea01 = currentArea01;
                    this._prevTimeSec = currentTimeSec;
                }
            }

            if (this.lastVacState === 'cleaning' && ['docked', 'charging', 'stopped'].includes(stateKey)) {
                try {
                    await this._accumulateJobTotals();
                    this._isSessionActive = false;
                    this.log('[SESSION] Cleaning ended. Total clean count incremented.');
                } catch (e) {
                    this.error('Session completion handling failed', e);
                }
            }

            // Totals (guard against invalid_setting_type)
            try {
                await this.vacuumTotals(totalsReport);
            } catch (e) {
                this.error('[Totals] Skipping due to error:', e && e.message ? e.message : e);
            }

            if (!this.initialTokenTotal && this.getSetting('total_work_time') !== undefined && this.getSetting('total_cleared_area') !== undefined && this.getSetting('total_clean_count') !== undefined) {
                this.initialTokenTotal = true;
                this.log(`[DIAG] initialTokenTotal flag is now true.`);
            }

            /* measure_battery & alarm_battery */
            if (battery && battery.value != null) {
                await this.updateCapabilityValue('measure_battery', battery.value);
                await this.updateCapabilityValue('alarm_battery', battery.value <= 20 ? true : false);
            }

            /* Sweep/Mop mode (guard value) */
            if (mop_mode && mop_mode.value != null) {
                await this.updateCapabilityValue('vacuum_xiaomi_mop_mode_max', String(mop_mode.value));
            }

            /* rooms_list (tolerant JSON) */
            if (result_rooms && result_rooms.length === 1 && result_rooms[0].value) {
                try {
                    const parsed = JSON.parse(result_rooms[0].value);
                    const roomsArr = Array.isArray(parsed.rooms) ? parsed.rooms : [];
                    const rooms_list = JSON.stringify(roomsArr);
                    const rooms_names = roomsArr.map((r) => r.name).join(', ');
                    await this.setSettings({ rooms: rooms_list, rooms_display: rooms_names });
                } catch (e) {
                    this.log('[Rooms] Failed to parse rooms JSON:', e && e.message ? e.message : e);
                    await this.setSettings({ rooms: 'Not supported for this model' });
                }
            } else {
                await this.setSettings({ rooms: 'Not supported for this model' });
            }

            /* consumables */
            this.vacuumConsumables(consumables);

            /* Cleaning power (guard value) */
            if (cleaning_mode && cleaning_mode.value != null) {
                await this.updateCapabilityValue('vacuum_xiaomi_cleaning_mode_max', String(cleaning_mode.value));
            }
            /* Water level (guard value) */
            if (water_level && water_level.value != null) {
                await this.updateCapabilityValue('vacuum_xiaomi_water_level_max', String(water_level.value));
            }
            /* Path mode (guard value) */
            if (path_mode && path_mode.value != null) {
                await this.updateCapabilityValue('vacuum_xiaomi_path_mode_max', String(path_mode.value));
            }
            /* Carpet avoidance (guard value) */
            if (carpet_avoidance && carpet_avoidance.value != null) {
                await this.updateCapabilityValue('vacuum_xiaomi_carpet_mode_max', String(carpet_avoidance.value));
            }

            // Detergent near-empty flag
            const detergent_depletion_reminder = this.getMiotProp(result, 'detergent_depletion_reminder');
            if (detergent_depletion_reminder && detergent_depletion_reminder.value != null) {
                const isEmpty = !!detergent_depletion_reminder.value;
                await this.updateCapabilityValue('alarm_water_shortage', isEmpty);
            }

            /* error/status tiles + flows */
            let err = 'Everything-is-ok';
            if (device_fault && this.deviceProperties.error_codes.hasOwnProperty(device_fault.value)) {
                err = this.deviceProperties.error_codes[device_fault.value];
            }
            let safeError = typeof err === 'string' ? err : 'Unknown Error';

            if (stateKey === 'cleaning') safeError = 'OK - Working';

            let currentErrorCap = this.getCapabilityValue('vacuum_xiaomi_status');
            if (safeError !== 'OK' && safeError !== 'OK - Working' && safeError !== currentErrorCap) {
                await this.homey.flow
                    .getDeviceTriggerCard('vacuum_on_error')
                    .trigger(this, { error: safeError })
                    .catch((error) => this.error(error));
            }

            await this.updateCapabilityValue('vacuum_xiaomi_status', safeError);

            if (this.getSetting('error') !== err) {
                await this.setSettings({ error: err });
                if (device_fault && err !== 'Everything-is-ok') {
                    await this.homey.flow
                        .getDeviceTriggerCard('statusVacuum')
                        .trigger(this, { status: safeError })
                        .catch((e) => this.error(e));
                }
            }

            this.lastVacState = stateKey;
        } catch (error) {
            this.log(error);
            this.homey.clearInterval(this.pollingInterval);

            if (this.getAvailable()) {
                this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((err) => this.error(err));
            }

            this.homey.setTimeout(() => this.createDevice(), 60000);
            this.error(error.message);
        }
    }

    /* Custom totals (safe for d109gl and c102gl) */
    async customVacuumTotals(totals) {
        try {
            // Initialize once from robot values if undefined
            if (this.getSetting('total_work_time') === undefined) {
                const initialWorkTimeH = +((totals.clean_time || 0) / 3600).toFixed(3);
                await this.setSettings({ total_work_time: initialWorkTimeH });
                await this.total_work_time_token.setValue(initialWorkTimeH);
                this.log(`[DIAG] Initialized total_work_time to ${initialWorkTimeH}h.`);
            }

            if (this.getSetting('total_cleared_area') === undefined) {
                const initialClearedAreaM2 = +((totals.clean_area || 0) / 100).toFixed(3);
                await this.setSettings({ total_cleared_area: initialClearedAreaM2 });
                await this.total_cleared_area_token.setValue(initialClearedAreaM2);
                this.log(`[DIAG] Initialized total_cleared_area to ${initialClearedAreaM2}m².`);
            }

            if (this.getSetting('total_clean_count') === undefined) {
                const robotCount = totals.clean_count || 0;
                await this.setSettings({ total_clean_count: robotCount });
                await this.total_clean_count_token.setValue(robotCount);
                this.log(`[DIAG] Initialized total_clean_count to ${robotCount}.`);
            } else {
                // If robot count jumps ahead (e.g. app reinstall), sync upward
                const robotCount = totals.clean_count || 0;
                const current = Number(this.getSetting('total_clean_count'));
                if (robotCount > current) {
                    await this.setSettings({ total_clean_count: robotCount });
                    await this.total_clean_count_token.setValue(robotCount);
                    this.log(`[DIAG] Synced total_clean_count ${current} → ${robotCount}.`);
                }
            }

            this.initialTokenTotal = true;
        } catch (err) {
            this.error('[ERROR] [CUSTOM_TOTALS] Failed:', err);
            // Don’t throw — never break polling due to totals
        }
    }

    async customVacuumConsumables(consumables) {
        try {
            let main_brush_remaining_value = 0;
            let side_brush_remaining_value = 0;
            let filter_remaining_value = 0;

            const prevConsumables = this._lastConsumablesJSON || '';
            const currConsumables = JSON.stringify(consumables);
            if (currConsumables !== prevConsumables) {
                this.log('Consumables input:', currConsumables);
                this._lastConsumablesJSON = currConsumables;
            }

            if (Array.isArray(consumables) && consumables.length > 0) {
                const data = consumables[0];

                if (Object.prototype.hasOwnProperty.call(data, 'main_brush_work_time')) {
                    main_brush_remaining_value = Number(data.main_brush_work_time) || 0;
                    const main_brush_remaining = main_brush_remaining_value + '%';

                    if (this.getSetting('main_brush_work_time') !== main_brush_remaining) {
                        await this.setSettings({ main_brush_work_time: main_brush_remaining });
                        if (this.main_brush_lifetime_token) await this.main_brush_lifetime_token.setValue(main_brush_remaining_value);
                    }

                    if (main_brush_remaining_value < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_main_brush_work_time')) {
                        this.log('Triggering alarm for main brush...');
                        await this.updateCapabilityValue('alarm_main_brush_work_time', true);
                        await this.homey.flow
                            .getDeviceTriggerCard('alertVacuum')
                            .trigger(this, { consumable: 'Main Brush', value: main_brush_remaining })
                            .catch((error) => this.error(error));
                    } else if (main_brush_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_main_brush_work_time')) {
                        this.log('Clearing alarm for main brush...');
                        this.updateCapabilityValue('alarm_main_brush_work_time', false);
                    }
                }

                if (Object.prototype.hasOwnProperty.call(data, 'side_brush_work_time')) {
                    side_brush_remaining_value = Number(data.side_brush_work_time) || 0;
                    const side_brush_remaining = side_brush_remaining_value + '%';

                    if (this.getSetting('side_brush_work_time') !== side_brush_remaining) {
                        await this.setSettings({ side_brush_work_time: side_brush_remaining });
                        if (this.side_brush_lifetime_token) await this.side_brush_lifetime_token.setValue(side_brush_remaining_value);
                    }

                    if (side_brush_remaining_value < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_side_brush_work_time')) {
                        this.log('Triggering alarm for side brush...');
                        await this.updateCapabilityValue('alarm_side_brush_work_time', true);
                        await this.homey.flow
                            .getDeviceTriggerCard('alertVacuum')
                            .trigger(this, { consumable: 'Side Brush', value: side_brush_remaining })
                            .catch((error) => this.error(error));
                    } else if (side_brush_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_side_brush_work_time')) {
                        this.log('Clearing alarm for side brush...');
                        this.updateCapabilityValue('alarm_side_brush_work_time', false);
                    }
                }

                if (Object.prototype.hasOwnProperty.call(data, 'filter_work_time')) {
                    filter_remaining_value = Number(data.filter_work_time) || 0;
                    const filter_remaining = filter_remaining_value + '%';

                    if (this.getSetting('filter_work_time') !== filter_remaining) {
                        await this.setSettings({ filter_work_time: filter_remaining });
                        if (this.filter_lifetime_token) await this.filter_lifetime_token.setValue(filter_remaining_value);
                    }

                    if (filter_remaining_value < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_filter_work_time')) {
                        this.log('Triggering alarm for filter...');
                        await this.updateCapabilityValue('alarm_filter_work_time', true);
                        await this.homey.flow
                            .getDeviceTriggerCard('alertVacuum')
                            .trigger(this, { consumable: 'Filter', value: filter_remaining })
                            .catch((error) => this.error(error));
                    } else if (filter_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_filter_work_time')) {
                        this.log('Clearing alarm for filter...');
                        this.updateCapabilityValue('alarm_filter_work_time', false);
                    }
                }

                if (!this.initialTokenConsumable) {
                    if (this.main_brush_lifetime_token) await this.main_brush_lifetime_token.setValue(main_brush_remaining_value);
                    if (this.side_brush_lifetime_token) await this.side_brush_lifetime_token.setValue(side_brush_remaining_value);
                    if (this.filter_lifetime_token) await this.filter_lifetime_token.setValue(filter_remaining_value);
                    this.initialTokenConsumable = true;
                }
            } else {
                this.log('Consumables array is empty or invalid.');
            }
        } catch (error) {
            this.error('Error in customVacuumConsumables:', error);
        }
    }

    /* Helper – always return a usable FlowToken instance */
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
        const prevCount = Number(this.getSetting('total_clean_count') || 0);
        const newCount = prevCount + 1;
        await this.setSettings({ total_clean_count: newCount });
        await this.total_clean_count_token.setValue(newCount);
        this.log(`[DIAG] [FINAL] Clean count incremented: ${prevCount} → ${newCount}`);
    }

    async _addLiveDelta(deltaAreaM2, deltaHours) {
        if (deltaAreaM2 <= 0 && deltaHours <= 0) return;

        const prevArea = Number(this.getSetting('total_cleared_area') || 0);
        const prevTime = Number(this.getSetting('total_work_time') || 0);

        const newArea = prevArea + deltaAreaM2;
        const newTime = prevTime + deltaHours;

        this.log('[DIAG] [LIVE] Cleaned area update:', `Δ=${deltaAreaM2.toFixed(2)} m², Prev=${prevArea.toFixed(2)} m², New=${newArea.toFixed(2)} m²`);
        this.log('[DIAG] [LIVE] Cleaning time update:', `Δ=${deltaHours.toFixed(4)} h, Prev=${prevTime.toFixed(4)} h, New=${newTime.toFixed(4)} h`);

        await this.setSettings({
            total_cleared_area: +newArea.toFixed(2),
            total_work_time: +newTime.toFixed(3)
        });

        await this.total_cleared_area_token.setValue(+newArea.toFixed(2));
        await this.total_work_time_token.setValue(+newTime);
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (super.onSettings) await super.onSettings({ oldSettings, newSettings, changedKeys });

        const lifetimeKeys = ['total_work_time', 'total_cleared_area', 'total_clean_count'];
        const changedLifetime = changedKeys.filter((k) => lifetimeKeys.includes(k));
        if (changedLifetime.length === 0) return true;

        try {
            if (changedLifetime.includes('total_work_time')) {
                const hours = parseFloat(newSettings.total_work_time) || 0;
                await this.total_work_time_token.setValue(hours);
            }
            if (changedLifetime.includes('total_cleared_area')) {
                const m2 = parseFloat(newSettings.total_cleared_area) || 0;
                await this.total_cleared_area_token.setValue(m2);
            }
            if (changedLifetime.includes('total_clean_count')) {
                const cnt = parseInt(newSettings.total_clean_count) || 0;
                await this.total_clean_count_token.setValue(cnt);
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
}

module.exports = XiaomiVacuumMiotDeviceMax;
