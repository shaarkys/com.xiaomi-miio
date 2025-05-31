'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.vacuum.d109gl // Xiaomi Robot Vacuum X20 Max
// https://home.miot-spec.com/spec/xiaomi.vacuum.d102gl // Xiaomi Robot Vacuum X20 Pro
// https://home.miot-spec.com/spec/xiaomi.vacuum.c102gl // Xiaomi Robot Vacuum X20

const mapping = {
    'xiaomi.vacuum.d109gl': 'properties_d109gl',
    'xiaomi.vacuum.d102gl': 'properties_d109gl',
    'xiaomi.vacuum.c102gl': 'properties_d109gl'
};

const properties = {
    properties_d109gl: {
        get_rooms: [
            { did: 'rooms', siid: 2, piid: 16 } // get list of rooms property (separated from the others because if included with others the api don't respond)
        ],
        get_properties: [
            { did: 'device_status', siid: 2, piid: 2 }, // status
            { did: 'device_fault', siid: 2, piid: 3 }, // fault
            { did: 'mode', siid: 2, piid: 4 }, // sweep-mop-type
            { did: 'battery', siid: 3, piid: 1 }, // battery-level
            { did: 'main_brush_life_level', siid: 12, piid: 1 }, // brush-life-level (main)
            { did: 'side_brush_life_level', siid: 13, piid: 1 }, // brush-life-level (side)
            { did: 'filter_life_level', siid: 14, piid: 1 }, // filter-life-level
            { did: 'total_clean_time', siid: 2, piid: 7 }, // cleaning time (seconds)
            { did: 'total_clean_count', siid: 2, piid: 8 }, // clean times
            { did: 'total_clean_area', siid: 2, piid: 6 }, // cleaning area (0.01 m²)
            { did: 'cleaning_mode', siid: 2, piid: 9 }, // Cleaning Mode (1-4)
            { did: 'water_level', siid: 2, piid: 10 }, // Water Output Level (0-3)
            { did: 'path_mode', siid: 2, piid: 74 }, // Path-mode (1-3)
            { did: 'detergent_left_level', siid: 18, piid: 1 }, // 0-100 % - not available on d109gl ??
            { did: 'detergent_self_delivery', siid: 18, piid: 2 }, // bool
            { did: 'detergent_self_delivery_lvl', siid: 18, piid: 3 }, // 0–3
            { did: 'dust_bag_life_level', siid: 19, piid: 1 }, // 0-100 % - not available on d109gl ??
            { did: 'dust_bag_left_time', siid: 19, piid: 2 } // h - not available on d109gl ??
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] }, // start-sweep
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] }, // stop-sweeping
            find: { siid: 6, aiid: 1, did: 'call-6-1', in: [] }, // identify
            home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] }, // start-charge
            mopmode: { siid: 2, piid: 4 }, // sweep-mop-type
            cleaning_mode: { siid: 2, piid: 9 }, // Cleaning Mode
            water_level: { siid: 2, piid: 10 }, // Water Level
            path_mode: { siid: 2, piid: 74 }, // Path-mode
            room_clean_action: { siid: 2, aiid: 16, piid: 15 } // Room cleaning action (used in advanced_room_cleaning flow action)
        },
        error_codes: {
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
            210002: 'Wheel-error',
            210013: 'Dustbin-error',
            210050: 'No-water-error',
            320002: 'Cliff-error'
        },
        status_mapping: {
            // Robot is actively moving or its station is working
            cleaning: [4, 7, 8, 10, 12, 16, 17, 19],

            // Not used on the X20 Max (kept for compatibility)
            spot_cleaning: [],

            // Robot is on the dock and NOT charging, or the station is busy
            docked: [1, 9, 11, 14],

            // Robot is charging or driving home to charge
            charging: [2, 6, 13, 21],

            // Robot is paused, waiting, or user-interrupted
            stopped: [3, 5, 18, 20],

            // A real fault state that needs user attention
            stopped_error: [15]
        }
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

            // Device-specific logic xiaomi.vacuum.d109gl only
            if (['xiaomi.vacuum.d109gl'].includes(this.getStoreValue('model'))) {
                this.log('Using custom vacuumTotals and custom vacuumConsumables method for xiaomi.vacuum.d109gl');
                this.vacuumTotals = this.customVacuumTotals;
                this.vacuumConsumables = this.customVacuumConsumables;
            }

            // DEVICE VARIABLES
            this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['xiaomi.vacuum.*']];

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
                    let selected_room_name = args.room.split(',');
                    selected_room_name = selected_room_name.map((name) => name.toLowerCase().trim());
                    selected_room = list_room
                        .filter((el) => {
                            return selected_room_name.includes(el.name.toLowerCase());
                        })
                        .map((el) => el.id);
                }

                if (selected_room.length === 0) {
                    this.error(`No valid room selected for advanced cleaning. Requested: "${args.room}", Available: "${list_room.map((r) => r.name).join(', ')}"`);
                    return Promise.reject(`No valid room selected. Requested: "${args.room}". Available: ${list_room.map((r) => r.name).join(', ')}. Check room names in device settings.`);
                }

                let room_list = selected_room.join(',');
                // For a bug/issue of protocol, it's impossible to handle single room cleaning,
                // so in case of single room I will duplicate it for bypass this issue
                if (selected_room.length == 1) room_list += ',' + room_list;

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

                if (args.device.miio && typeof args.device.miio.call === 'function') {
                    let responseProperties = await args.device.miio.call('set_properties', propertiesToSet, { retries: 1 });
                    // debug
                    this.log('[ADV_ROOM_CLEAN] Properties response:', JSON.stringify(responseProperties));

                    let responseAction = await args.device.miio.call('action', actions, { retries: 3 });
                    // debug
                    this.log('[ADV_ROOM_CLEAN] Action response:', JSON.stringify(responseAction));
                } else {
                    this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                        this.error(error);
                    });
                    this.createDevice();
                    return Promise.reject('Device unreachable, please try again ...');
                }
            });

            // Register action cards globally for all devices
            // 1. Set vacuum mode
            this.homey.flow.getActionCard('set_sweep_mop_type').registerRunListener(async ({ device, mode }) => {
                const modeValue = Number(mode);
                return device.miio.call(
                    'set_properties',
                    [
                        {
                            siid: device.deviceProperties.set_properties.mopmode.siid,
                            piid: device.deviceProperties.set_properties.mopmode.piid,
                            value: modeValue
                        }
                    ],
                    { retries: 1 }
                );
            });

            // 2. Set cleaning power
            this.homey.flow.getActionCard('set_cleaning_mode').registerRunListener(async ({ device, power }) => {
                const powerValue = Number(power);
                return device.miio.call(
                    'set_properties',
                    [
                        {
                            siid: device.deviceProperties.set_properties.cleaning_mode.siid,
                            piid: device.deviceProperties.set_properties.cleaning_mode.piid,
                            value: powerValue
                        }
                    ],
                    { retries: 1 }
                );
            });

            // 3. Set water output level
            this.homey.flow.getActionCard('set_water_level').registerRunListener(async ({ device, level }) => {
                const levelValue = Number(level);
                return device.miio.call(
                    'set_properties',
                    [
                        {
                            siid: device.deviceProperties.set_properties.water_level.siid,
                            piid: device.deviceProperties.set_properties.water_level.piid,
                            value: levelValue
                        }
                    ],
                    { retries: 1 }
                );
            });

            // 4. Set path mode
            this.homey.flow.getActionCard('set_path_mode').registerRunListener(async ({ device, mode }) => {
                const pathValue = Number(mode);
                return device.miio.call(
                    'set_properties',
                    [
                        {
                            siid: device.deviceProperties.set_properties.path_mode.siid,
                            piid: device.deviceProperties.set_properties.path_mode.piid,
                            value: pathValue
                        }
                    ],
                    { retries: 1 }
                );
            });

            // LISTENERS FOR UPDATING CAPABILITIES
            this.registerCapabilityListener('onoff', async (value) => {
                try {
                    if (this.miio) {
                        if (value) {
                            return await this.miio.call('action', this.deviceProperties.set_properties.start_clean, { retries: 1 });
                        } else {
                            return await this.miio.call('action', this.deviceProperties.set_properties.stop_clean, { retries: 1 });
                        }
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                            this.error(error);
                        });
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
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                            this.error(error);
                        });
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            /* vacuumcleaner xiaomi mop mode max */
            this.registerCapabilityListener('vacuum_xiaomi_mop_mode_max', async (value) => {
                try {
                    const numericValue = Number(value); // Homey gives string, device expects number
                    this.log(`Setting Sweep & Mop Mode to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call(
                            'set_properties',
                            [
                                {
                                    siid: this.deviceProperties.set_properties.mopmode.siid,
                                    piid: this.deviceProperties.set_properties.mopmode.piid,
                                    value: numericValue
                                }
                            ],
                            { retries: 1 }
                        );
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

            // Cleaning Mode
            this.registerCapabilityListener('vacuum_xiaomi_cleaning_mode_max', async (value) => {
                try {
                    const numericValue = Number(value);
                    this.log(`Setting Cleaning Power to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call(
                            'set_properties',
                            [
                                {
                                    siid: this.deviceProperties.set_properties.cleaning_mode.siid,
                                    piid: this.deviceProperties.set_properties.cleaning_mode.piid,
                                    value: numericValue
                                }
                            ],
                            { retries: 1 }
                        );
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

            // Water Level
            this.registerCapabilityListener('vacuum_xiaomi_water_level_max', async (value) => {
                try {
                    const numericValue = Number(value);
                    this.log(`Setting Water Output to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call(
                            'set_properties',
                            [
                                {
                                    siid: this.deviceProperties.set_properties.water_level.siid,
                                    piid: this.deviceProperties.set_properties.water_level.piid,
                                    value: numericValue
                                }
                            ],
                            { retries: 1 }
                        );
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

            // Path Mode (vacuum_xiaomi_path_mode_max)
            this.registerCapabilityListener('vacuum_xiaomi_path_mode_max', async (value) => {
                try {
                    const numericValue = Number(value);
                    this.log(`Setting Path Mode to: ${numericValue}`);
                    if (this.miio) {
                        return await this.miio.call(
                            'set_properties',
                            [
                                {
                                    siid: this.deviceProperties.set_properties.path_mode.siid,
                                    piid: this.deviceProperties.set_properties.path_mode.piid,
                                    value: numericValue
                                }
                            ],
                            { retries: 1 }
                        );
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

            if (!this.getAvailable()) {
                await this.setAvailable();
            }

            // Store previous values to compare
            const prevProps = this._lastPropertyValues || {};

            const resultValues = {};
            for (const def of this.deviceProperties.get_properties) {
                const found = result.find((obj) => obj.siid === def.siid && obj.piid === def.piid);
                resultValues[def.did] = found ? found.value : null;
            }

            // Compare all props, only log if any value changed
            let valueChanged = false;
            for (const key of Object.keys(resultValues)) {
                if (prevProps[key] !== resultValues[key]) {
                    valueChanged = true;
                    break;
                }
            }
            if (valueChanged) {
                this.log('Raw property data: ' + this.prettyPrintProperties(result, this.deviceProperties.get_properties));
            }
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
            const detergent_left_level = this.getMiotProp(result, 'detergent_left_level'); // not available on d109gl ??
            const dust_bag_life_level = this.getMiotProp(result, 'dust_bag_life_level'); // not available on d109gl ??

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
            let stateKey = null; // textual state we mapped to

            if (device_status) {
                for (const key in this.deviceProperties.status_mapping) {
                    if (this.deviceProperties.status_mapping[key].includes(device_status.value)) {
                        matched = true;
                        stateKey = key; // remember for after-job check

                        if (this.getCapabilityValue('measure_battery') === 100 && (key === 'stopped' || key === 'charging')) {
                            this.vacuumCleanerState('docked');
                        } else {
                            this.vacuumCleanerState(key);
                        }
                        break;
                    }
                }
                if (!matched) {
                    this.log('Not a valid vacuumcleaner_state (driver level)', device_status.value);
                }
            } else {
                this.log('device_status not found, cannot set vacuumcleaner_state!');
            }

            // --- DEBUG --------------------------------------------------------------
            // Only log state if it actually changed since last time
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
            // -----------------------------------------------------------------------

            // ── SESSION HANDLING ──────────────────────────────────────────────────
            // If we just transitioned INTO 'cleaning', record session start
            if (stateKey === 'cleaning' && !this._isSessionActive) {
                this._isSessionActive = true;
                this._prevArea01 = total_clean_area ? total_clean_area.value : 0;
                this._prevTimeSec = total_clean_time ? total_clean_time.value : 0;
                this._sessionStartArea = this._prevArea01;
                this._sessionStartTime = this._prevTimeSec;
                this.log(`[SESSION] Cleaning started: startArea(0.01m²)=${this._sessionStartArea}, startTime(sec)=${this._sessionStartTime}`);
            }

            // While cleaning, accumulate deltas each poll
            if (stateKey === 'cleaning' && this._isSessionActive) {
                let currentArea01 = total_clean_area ? total_clean_area.value : 0;
                let currentTimeSec = total_clean_time ? total_clean_time.value : 0;
                let deltaArea01 = currentArea01 - this._prevArea01;
                let deltaTimeSec = currentTimeSec - this._prevTimeSec;

                if (deltaArea01 > 0 || deltaTimeSec > 0) {
                    let deltaAreaM2 = deltaArea01 / 100; // convert 0.01m² → m²
                    let deltaHours = deltaTimeSec / 3600; // convert seconds → hours

                    this.log(`[SESSION] Incremental delta: Δarea=${deltaAreaM2.toFixed(2)}m² (Δarea01=${deltaArea01}), Δtime=${deltaHours.toFixed(2)}h (Δsec=${deltaTimeSec})`);

                    await this._addLiveDelta(deltaAreaM2, deltaHours);

                    this._prevArea01 = currentArea01;
                    this._prevTimeSec = currentTimeSec;
                }
            }

            // If we just transitioned OUT OF 'cleaning', increment only the clean count
            if (this.lastVacState === 'cleaning' && ['docked', 'charging', 'stopped'].includes(stateKey)) {
                try {
                    await this._accumulateJobTotals();
                    this._isSessionActive = false;
                    this.log('[SESSION] Cleaning ended. Total clean count incremented.');
                } catch (e) {
                    this.error('Session completion handling failed', e);
                }
            }
            // ────────────────────────────────────────────────────────────────────────

            // Call customVacuumTotals (one-time init or count sync for d109gl)
            await this.vacuumTotals(totalsReport);

            // After the first run of customVacuumTotals, mark initialTokenTotal
            if (!this.initialTokenTotal && this.getSetting('total_work_time') !== undefined && this.getSetting('total_cleared_area') !== undefined && this.getSetting('total_clean_count') !== undefined) {
                this.initialTokenTotal = true;
                this.log(`[DIAG] initialTokenTotal flag is now true.`);
            }

            /* measure_battery & alarm_battery */
            if (battery) {
                await this.updateCapabilityValue('measure_battery', battery.value);
                await this.updateCapabilityValue('alarm_battery', battery.value <= 20 ? true : false);
            } else {
                this.log('battery not found, skipping battery update.');
            }

            /* vacuum_xiaomi_mop_mode */
            if (mop_mode) {
                await this.updateCapabilityValue('vacuum_xiaomi_mop_mode_max', mop_mode.value.toString());
            }

            /* rooms_list */
            if (result_rooms && result_rooms.length === 1 && result_rooms[0].value) {
                let roomsArr = JSON.parse(result_rooms[0].value).rooms;
                let rooms_list = JSON.stringify(roomsArr);
                let rooms_names = roomsArr.map((r) => r.name).join(', ');
                await this.setSettings({ rooms: rooms_list, rooms_display: rooms_names });
            } else {
                await this.setSettings({ rooms: 'Not supported for this model' });
            }

            /* consumable settings */
            this.vacuumConsumables(consumables);

            /* xiaomi_cleaning_mode */
            if (cleaning_mode) {
                await this.updateCapabilityValue('vacuum_xiaomi_cleaning_mode_max', cleaning_mode.value.toString());
            }
            /* xiaomi_water_level */
            if (water_level) {
                await this.updateCapabilityValue('vacuum_xiaomi_water_level_max', water_level.value.toString());
            }
            /* path_mode */
            if (path_mode) {
                await this.updateCapabilityValue('vacuum_xiaomi_path_mode_max', path_mode.value.toString());
            }

            /* settings device error → save + tile + flow */
            let err = 'Everything-is-ok';
            if (device_fault && this.deviceProperties.error_codes.hasOwnProperty(device_fault.value)) {
                err = this.deviceProperties.error_codes[device_fault.value];
            }
            let safeError = typeof err === 'string' ? err : 'Unknown Error';

            // If state is cleaning, force status to OK - Working
            if (stateKey === 'cleaning') {
                if (safeError !== 'OK - Working') {
                    this.log(`Overriding error "${safeError}" with "OK - Working" because cleaning is active.`);
                }
                safeError = 'OK - Working';
            }

            // In case of error, Trigger the flow with the error code
            let currentErrorCap = this.getCapabilityValue('vacuum_xiaomi_status');
            if (safeError !== 'OK' && safeError !== 'OK - Working' && safeError !== currentErrorCap) {
                await this.homey.flow
                    .getDeviceTriggerCard('vacuum_on_error')
                    .trigger(this, { error: safeError })
                    .catch((error) => {
                        this.error(error);
                    });
            }

            /* 1️⃣  capability tile */
            await this.updateCapabilityValue('vacuum_xiaomi_status', safeError);

            /* 2️⃣  advanced-setting + optional flow trigger */
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
                this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((err) => {
                    this.error(err);
                });
            }

            this.homey.setTimeout(() => {
                this.createDevice();
            }, 60000);

            this.error(error.message);
        }
    }

    /* Custom vacuumTotals for xiaomi.vacuum.d109gl */
    /**
     * X20 Max: lifetime counters arrive already aggregated on the robot.
     * We just mirror them into settings and tokens (numbers only).
     */
    async customVacuumTotals(totals) {
        // 'totals' object contains robot's current report for PII 6, 7, 8
        try {
            //this.log(`[DIAG] Received totals from robot: clean_time=${totals.clean_time}, clean_area=${totals.clean_area}, clean_count=${totals.clean_count}`);

            const robotReportedCleanCount = totals.clean_count;

            // Initialize settings if they are undefined (e.g., first ever poll)
            // These initial values will be based on what the robot reports at that moment.
            // forceUpdateTotals will handle accumulation from the first cleaning session onwards.
            if (this.getSetting('total_work_time') === undefined) {
                const initialWorkTimeSec = totals.clean_time;
                const initialWorkTimeH = +(initialWorkTimeSec / 3600).toFixed(1);
                await this.setSettings({ total_work_time: initialWorkTimeH });
                await this.total_work_time_token.setValue(initialWorkTimeH);
                this.log(`[DIAG] Initialized total_work_time to ${initialWorkTimeH}h from robot report.`);
            }

            if (this.getSetting('total_cleared_area') === undefined) {
                const initialClearedArea01 = totals.clean_area;
                const initialClearedAreaM2 = +(initialClearedArea01 / 100).toFixed(0);
                await this.setSettings({ total_cleared_area: initialClearedAreaM2 });
                await this.total_cleared_area_token.setValue(initialClearedAreaM2);
                this.log(`[DIAG] Initialized total_cleared_area to ${initialClearedAreaM2}m² from robot report.`);
            }

            if (this.getSetting('total_clean_count') === undefined) {
                await this.setSettings({ total_clean_count: robotReportedCleanCount });
                await this.total_clean_count_token.setValue(robotReportedCleanCount);
                this.log(`[DIAG] Initialized total_clean_count to ${robotReportedCleanCount} from robot report.`);
            } else {
                // Optional: Sync count if robot's count is higher (e.g. if Homey's count got reset somehow)
                // forceUpdateTotals is the primary incrementer during normal operation.
                const currentHomeyCount = Number(this.getSetting('total_clean_count'));
                if (robotReportedCleanCount > currentHomeyCount) {
                    this.log(`[DIAG] Robot count (${robotReportedCleanCount}) is higher than Homey count (${currentHomeyCount}). Syncing count.`);
                    await this.setSettings({ total_clean_count: robotReportedCleanCount });
                    await this.total_clean_count_token.setValue(robotReportedCleanCount);
                }
            }
            this.initialTokenTotal = true; // Mark that initial value consideration has occurred.
        } catch (err) {
            this.error('[ERROR] [CUSTOM_TOTALS] Failed:', err);
        }
    }

    async customVacuumConsumables(consumables) {
        try {
            let main_brush_remaining_value = 0;
            let side_brush_remaining_value = 0;
            let filter_remaining_value = 0;

            // debug purposes only
            // Compare with previous consumables, only log if changed
            const prevConsumables = this._lastConsumablesJSON || '';
            const currConsumables = JSON.stringify(consumables);

            if (currConsumables !== prevConsumables) {
                this.log('Consumables input:', currConsumables);
                this._lastConsumablesJSON = currConsumables;
            }

            if (Array.isArray(consumables) && consumables.length > 0) {
                const data = consumables[0];

                /* main_brush_work_time */
                if (data.hasOwnProperty('main_brush_work_time')) {
                    main_brush_remaining_value = data.main_brush_work_time;
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
                            .catch((error) => this.error('Error triggering alert for main brush:', error));
                    } else if (main_brush_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_main_brush_work_time')) {
                        this.log('Clearing alarm for main brush...');
                        this.updateCapabilityValue('alarm_main_brush_work_time', false);
                    }
                } else {
                    this.log('main_brush_work_time not found in consumables.');
                }

                /* side_brush_work_time */
                if (data.hasOwnProperty('side_brush_work_time')) {
                    side_brush_remaining_value = data.side_brush_work_time;
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
                            .catch((error) => this.error('Error triggering alert for side brush:', error));
                    } else if (side_brush_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_side_brush_work_time')) {
                        this.log('Clearing alarm for side brush...');
                        this.updateCapabilityValue('alarm_side_brush_work_time', false);
                    }
                } else {
                    this.log('side_brush_work_time not found in consumables.');
                }

                /* filter_work_time */
                if (data.hasOwnProperty('filter_work_time')) {
                    filter_remaining_value = data.filter_work_time;
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
                            .catch((error) => this.error('Error triggering alert for filter:', error));
                    } else if (filter_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_filter_work_time')) {
                        this.log('Clearing alarm for filter...');
                        this.updateCapabilityValue('alarm_filter_work_time', false);
                    }
                } else {
                    this.log('filter_work_time not found in consumables.');
                }

                /* initial update tokens */
                if (!this.initialTokenConsumable || this.initialTokenConsumable === undefined) {
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

    /* Helper – always return a usable FlowToken instance
       1. First try to create (fast path)
       2. If it already exists → grab it
       3. If Homey says “token_not_registered” when we tried to grab it first
          → simply create it then.
    */
    async getOrCreateToken(id, title) {
        try {
            // 1️⃣  Fast-path: create, will succeed the very first time
            return await this.homey.flow.createToken(id, { type: 'number', title });
        } catch (err) {
            // 2️⃣  It’s already there → fetch it
            if (err && err.statusCode === 409) {
                return await this.homey.flow.getToken(id);
            }
            // 3️⃣  “token_not_registered” means getToken() was called before createToken()
            //     during a previous crash → fall back to create again
            if (err && err.message === 'token_not_registered') {
                return await this.homey.flow.createToken(id, { type: 'number', title });
            }
            throw err; // anything else is still an error
        }
    }

    /**
     * Called exactly once when a cleaning run ends.
     * – Since we already did incremental updates during cleaning,
     *   we only need to bump the clean-count here.
     */
    async _accumulateJobTotals(extraAreaM2 = 0, extraHours = 0) {
        // Increment the clean count only
        const prevCount = Number(this.getSetting('total_clean_count') || 0);
        const newCount = prevCount + 1;

        await this.setSettings({ total_clean_count: newCount });
        await this.total_clean_count_token.setValue(newCount);

        this.log(`[DIAG] [FINAL] Clean count incremented: ${prevCount} → ${newCount}`);
    }

    /**
     * Add a delta to the lifetime totals (area & duration)
     * This is called every poll while cleaning is active, so totals are live.
     */
    async _addLiveDelta(deltaAreaM2, deltaHours) {
        if (deltaAreaM2 <= 0 && deltaHours <= 0) return; // nothing to do

        // Previous values before update
        const prevArea = Number(this.getSetting('total_cleared_area') || 0);
        const prevTime = Number(this.getSetting('total_work_time') || 0);

        const newArea = prevArea + deltaAreaM2;
        const newTime = prevTime + deltaHours;

        // Logging
        this.log('[DIAG] [LIVE] Cleaned area update:', `Read (delta): ${deltaAreaM2.toFixed(2)} m², Previous: ${prevArea.toFixed(2)} m², New: ${newArea.toFixed(2)} m²`);
        this.log('[DIAG] [LIVE] Cleaning time update:', `Read (delta): ${deltaHours.toFixed(4)} h, Previous: ${prevTime.toFixed(4)} h, New: ${newTime.toFixed(4)} h`);

        await this.setSettings({
            total_cleared_area: +newArea.toFixed(1),
            total_work_time: +newTime.toFixed(2)
        });

        await this.total_cleared_area_token.setValue(+newArea.toFixed(1));
        await this.total_work_time_token.setValue(+newTime.toFixed(2));
    }

    /**
     * When the user manually edits “total_work_time” / “total_cleared_area” / “total_clean_count”
     * in Settings, we want to sync those new values to flow tokens immediately.
     */
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (super.onSettings) {
            await super.onSettings({ oldSettings, newSettings, changedKeys });
        }
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
