'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.vacuum.d109gl // Xiaomi Robot Vacuum X20 Max
// https://home.miot-spec.com/spec/xiaomi.vacuum.d102gl // Xiaomi Robot Vacuum X20 Pro  (original mapping kept)
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

/** Model → property-set */
const mapping = {
    'xiaomi.vacuum.d109gl': 'properties_d109gl',
    'xiaomi.vacuum.d102gl': 'properties_d109gl', // unchanged — you said it’s flawless
    'xiaomi.vacuum.c102gl': 'properties_c102gl' // X20 / X20+ specific minimal + room action change
};

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

    _getDeviceModel() {
        if (this.miio) {
            return this.miio.miioModel || (this.miio.management && this.miio.management.model) || null;
        }
        return null;
    }

    _applyModelProperties(model) {
        const mappedKey = mapping[model];
        this.deviceProperties = properties[mappedKey] || properties.properties_d109gl;
        this._model = model;
        if (this._model === 'xiaomi.vacuum.d102gl') {
            this.deviceProperties = {
                ...this.deviceProperties,
                get_properties: [...this.deviceProperties.get_properties]
            };
            const extraProps = [
                { did: 'water_check_status', siid: 2, piid: 54 },
                { did: 'fault_ids', siid: 2, piid: 66 }
            ];
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

            const model = this.getStoreValue('model');
            this._applyModelProperties(model);
            this._carpetModeState = this.getStoreValue('carpetModeState') || '0';
            if (!this.getStoreValue('carpetModeState')) {
                try {
                    await this.setStoreValue('carpetModeState', this._carpetModeState);
                } catch (_) {}
            }

            // Only add optional caps if model actually supports them
            if (this.deviceProperties.supports.carpet_avoidance && !this.hasCapability('vacuum_xiaomi_carpet_mode_max')) {
                await this.addCapability('vacuum_xiaomi_carpet_mode_max');
            }
            if (!this.hasCapability('alarm_water_shortage') && this.deviceProperties.supports.detergent) {
                await this.addCapability('alarm_water_shortage');
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

            // Advanced room cleaning (works for all, just skips unsupported set_properties)
            this.homey.flow.getActionCard('advanced_room_cleaning').registerRunListener(async (args) => {
                const rawRooms = args.device.getSetting('rooms');
                let list_room = [];
                try {
                    if (Array.isArray(rawRooms)) {
                        list_room = rawRooms;
                    } else if (typeof rawRooms === 'string') {
                        try {
                            list_room = JSON.parse(rawRooms);
                        } catch (_) {
                            try {
                                list_room = JSON.parse(rawRooms.replace(/\\"/g, '"'));
                            } catch (_) {
                                if (rawRooms.startsWith('"') && rawRooms.endsWith('"')) {
                                    list_room = JSON.parse(JSON.parse(rawRooms));
                                }
                            }
                        }
                    }
                } catch (e) {
                    this.error('Rooms list in settings is invalid/missing.', e);
                    return Promise.reject('Room list is not available. Please sync device first.');
                }
                if (!Array.isArray(list_room)) list_room = [];

                let selected_ids;
                if (args.room === 'all') {
                    selected_ids = list_room.map((el) => el.id);
                } else {
                    selected_ids = [];
                    for (const rawToken of String(args.room || '').split(',')) {
                        const token = rawToken.trim();
                        if (!token) continue;
                        if (/^\d+$/.test(token)) {
                            selected_ids.push(Number(token));
                            continue;
                        }
                        const name = token.toLowerCase();
                        const match = list_room.find((el) => (el.name || '').toLowerCase() === name);
                        if (match) selected_ids.push(match.id);
                    }
                }

                if (!selected_ids.length) {
                    return Promise.reject(`No valid room selected. Requested: "${args.room}". Available: ${list_room.map((r) => r.name).join(', ')}.`);
                }

                let room_list = selected_ids.join(',');
                if (selected_ids.length === 1) room_list += ',' + room_list; // single room workaround

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
                    if (props.length) await args.device.miio.call('set_properties', props, { retries: 1 });
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
                            const result = await this.miio.call('set_properties', payload, { retries: 1 });
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
                            return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.mopmode.siid, piid: this.deviceProperties.set_properties.mopmode.piid, value: mappedValue }], { retries: 1 });
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
                            return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.cleaning_mode.siid, piid: this.deviceProperties.set_properties.cleaning_mode.piid, value: mappedValue }], { retries: 1 });
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
                            return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.water_level.siid, piid: this.deviceProperties.set_properties.water_level.piid, value: mappedValue }], { retries: 1 });
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
                            return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.path_mode.siid, piid: this.deviceProperties.set_properties.path_mode.piid, value: mappedValue }], { retries: 1 });
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
        try {
            if (!this.miio || typeof this.miio.call !== 'function') {
                if (this.getAvailable()) {
                    this.setUnavailable(this.homey.__('device.unreachable')).catch((error) => this.error(error));
                }
                this.createDevice();
                return;
            }
            if (!this._syncModelFromDevice()) return;
            const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });

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
                    result_rooms = await this.miio.call('get_properties', this.deviceProperties.get_rooms, { retries: 1 });
                    if (!result_rooms || !result_rooms.length || !result_rooms[0].value) {
                        const candidates = [
                            [{ did: 'rooms', siid: 4, piid: 20 }],
                            [{ did: 'rooms', siid: 6, piid: 15 }], // user-facing strings sometimes here
                            [{ did: 'rooms', siid: 7, piid: 3 }]
                        ];
                        for (const c of candidates) {
                            try {
                                const r = await this.miio.call('get_properties', c, { retries: 1 });
                                if (r && r[0] && r[0].value) {
                                    result_rooms = r;
                                    break;
                                }
                            } catch (_) {}
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
            const water_level_prop = this.getMiotProp(result, 'water_level');
            const path_mode_prop = this.getMiotProp(result, 'path_mode');
            const carpet_mode_prop = this.getMiotProp(result, 'carpet_avoidance');
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

            // detergent near-empty flag only if supported
            if (this.deviceProperties.supports.detergent) {
                const det = this.getMiotProp(result, 'detergent_depletion_reminder');
                if (det && det.value != null) {
                    await this.updateCapabilityValue('alarm_water_shortage', !!det.value);
                }
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
            this.log(error);
            this.homey.clearInterval(this.pollingInterval);
            if (this.getAvailable()) {
                this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((err) => this.error(err));
            }
            this.homey.setTimeout(() => this.createDevice(), 60000);
            this.error(error.message);
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


    getModelIdentifier() {
        return this._model || (this.getStoreValue ? this.getStoreValue('model') : undefined);
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
        if (this.getModelIdentifier() === 'xiaomi.vacuum.c102gl') {
            const mapping = ['1', '2', '3', '4'];
            const idx = Number(raw);
            return Number.isNaN(idx) ? '1' : (mapping[idx] !== undefined ? mapping[idx] : '1');
        }
        return String(raw);
    }

    mapCleaningModeOutbound(value) {
        if (value == null) return null;
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
                        const res = await this.miio.call('get_properties', [{ siid, piid }], { retries: 1 });
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

