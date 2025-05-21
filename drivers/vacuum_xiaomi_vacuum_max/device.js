'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.vacuum.d109gl // Xiaomi Robot Vacuum X20 Max

const mapping = {
    'xiaomi.vacuum.d109gl': 'properties_d109gl'
};

const properties = {
    properties_d109gl: {
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
            { did: 'total_clean_area', siid: 2, piid: 6 }, // cleaning area (m2)
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
            path_mode: { siid: 2, piid: 74 } // Path-mode
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
            210030: 'Water tank empty & paused'
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

            // remember the last reported state so we can spot when a job is finished
            this.lastVacState = 'unknown';
            // Track the session-internal progress (0.01 m² and seconds)
            this._prevArea01 = 0;
            this._prevTimeSec = 0;

            // ADD/REMOVE DEVICES DEPENDANT CAPABILITIES

            // Device-specific logic xiaomi.vacuum.d109gl only as generic logic is using slighly different calcalutions
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

            this.total_work_time_token = await this.getOrCreateToken('total_work_time' + this.getData().id, `Total Work Time ${this.getName()} (h)`);

            this.total_cleared_area_token = await this.getOrCreateToken('total_cleared_area' + this.getData().id, `Total Cleaned Area ${this.getName()} (m²)`);

            this.total_clean_count_token = await this.getOrCreateToken('total_clean_count' + this.getData().id, `Total Clean Count ${this.getName()}`);

            // FLOW TRIGGER CARDS
            this.homey.flow.getDeviceTriggerCard('alertVacuum');
            this.homey.flow.getDeviceTriggerCard('statusVacuum');
            // not implemented
            //this.homey.flow.getDeviceTriggerCard('triggerVacuumRoomSegments');

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

            /* vacuumcleaner xiaomi mop mode max*/
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
            if (!this.getAvailable()) {
                await this.setAvailable();
            }

            // Log the full raw property data for reference
            this.log('Raw property data:', result);

            //temporary debug !!!
            /*
            try {
                this.log('Starting full property scan...');
    
                const results = [];
                
                // Iterate over a reasonable range of SIIDs and PIIDs
                for (let siid = 1; siid <= 18; siid++) {
                    for (let piid = 1; piid <= 90; piid++) {
                        try {
                            // Attempt to fetch property for the current SIID and PIID
                            const response = await this.miio.call('get_properties', [{ siid, piid }], { retries: 1 });
                            
                            // Log successful responses and add them to results
                            if (response && response.length > 0 && response[0].code === 0) {
                                this.log(`Fetched property SIID ${siid}, PIID ${piid}:`, JSON.stringify(response[0]));
                                results.push(response[0]);
                            }
                        } catch (error) {
                            // Ignore errors for invalid SIID/PIID combinations
                            this.log(`SIID ${siid}, PIID ${piid} not accessible.`);
                        }
                    }
                }
    
                // Log all successfully fetched properties
                this.log('Complete property scan result:', JSON.stringify(results, null, 2));
    
            } catch (error) {
                this.error('Error during full property scan:', error);
            } 
            */
            // Assign all properties first
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

            // Now log debug info for property values (with null checks)
            /*
            if (device_status) {
                this.log('Device Status Value:', device_status.value);
            } else {
                this.log('Device Status property not found in response.');
            }

            if (battery) {
                this.log('Battery Value:', battery.value);
            } else {
                this.log('Battery property not found in response.');
            }

            if (mop_mode) {
                this.log('Mop Mode Value:', mop_mode.value);
            } else {
                this.log('Mop Mode property not found in response.');
            }
                */

            const consumables = [
                {
                    main_brush_work_time: main_brush_life_level ? main_brush_life_level.value : 0,
                    side_brush_work_time: side_brush_life_level ? side_brush_life_level.value : 0,
                    filter_work_time: filter_life_level ? filter_life_level.value : 0
                }
            ];

            const totals = {
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
            this.log(`status code = ${device_status ? device_status.value : 'n/a'}`, `→ key = ${stateKey}`, `| lastVacState = ${this.lastVacState}`);
            // -----------------------------------------------------------------------

            /* ── prime the live-trackers when we ENTER "cleaning" ────────────────── */
            if (this.lastVacState !== 'cleaning' && stateKey === 'cleaning') {
                // store the absolute counters as starting point
                this._prevArea01 = total_clean_area ? total_clean_area.value : 0; // 0.01 m²
                this._prevTimeSec = total_clean_time ? total_clean_time.value : 0; // seconds
            }

            /* add every positive delta, no matter what state we’re in  */
            {
                const area01 = total_clean_area ? total_clean_area.value : 0; // 0.01 m²
                const timeSec = total_clean_time ? total_clean_time.value : 0; // seconds

                const deltaArea = (area01 - this._prevArea01) / 100; // → m²
                const deltaH = (timeSec - this._prevTimeSec) / 3600; // → h

                await this._addLiveDelta(deltaArea, deltaH); // always add
                this._prevArea01 = area01; // remember for next poll
                this._prevTimeSec = timeSec;
            }

            /* job finished? (cleaning → docked / charging / stopped) */
            if (this.lastVacState === 'cleaning' && ['docked', 'charging', 'stopped'].includes(stateKey)) {
                try {
                    await this._accumulateJobTotals(); // add the *last* delta & +1 count
                } catch (e) {
                    this.error('accumulateJobTotals failed', e);
                }
            }
            this.lastVacState = stateKey ?? this.lastVacState; // keep for next poll

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
            

            /* detergent left (%) */
            /*if (detergent_left_level) {
                await this.updateCapabilityValue('vacuum_xiaomi_detergent_left_level', detergent_left_level.value);
            }*/

            /* dust-bag life (%) */
            /*
            if (dust_bag_life_level) {
                await this.updateCapabilityValue('vacuum_xiaomi_dust_bag_left_level', dust_bag_life_level.value);
            }*/

            /* settings device error → save + tile + flow */
            let err = 'Everything-is-ok';
            if (device_fault && this.deviceProperties.error_codes.hasOwnProperty(device_fault.value)) {
                err = this.deviceProperties.error_codes[device_fault.value];
            }
            const safeError = typeof err === 'string' ? err : 'Unknown Error';

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
        } catch (error) {
            this.homey.clearInterval(this.pollingInterval);

            if (this.getAvailable()) {
                this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((error) => {
                    this.error(error);
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
        try {
            // the totals object delivers plain numbers in seconds / m² / cycles
            const worktimeSec = totals.clean_time;
            const clearedArea = totals.clean_area; // m²
            const cleanCount = totals.clean_count;

            const worktimeH = +(worktimeSec / 60).toFixed(2); // seconds → hours (keep 2 decimals)

            /* total_work_time -------------------------------------------------- */
            if (this.getSetting('total_work_time') !== worktimeH) {
                await this.setSettings({ total_work_time: worktimeH });
                await this.total_work_time_token.setValue(worktimeH);
            }

            /* total_cleared_area ---------------------------------------------- */
            if (this.getSetting('total_cleared_area') !== clearedArea) {
                await this.setSettings({ total_cleared_area: clearedArea });
                await this.total_cleared_area_token.setValue(clearedArea);
            }

            /* total_clean_count ------------------------------------------------ */
            if (this.getSetting('total_clean_count') !== cleanCount) {
                await this.setSettings({ total_clean_count: cleanCount });
                await this.total_clean_count_token.setValue(cleanCount);
            }

            /* first poll after (re)start – prime the tokens */
            if (!this.initialTokenTotal) {
                await this.total_work_time_token.setValue(worktimeH);
                await this.total_cleared_area_token.setValue(clearedArea);
                await this.total_clean_count_token.setValue(cleanCount);
                this.initialTokenTotal = true;
            }
        } catch (err) {
            this.error('customVacuumTotals() failed', err);
        }
    }

    /* Custom VacuumConsumables for xiaomi.vacuum.d109gl */

    async customVacuumConsumables(consumables) {
        try {
            let main_brush_remaining_value = 0;
            let side_brush_remaining_value = 0;
            let filter_remaining_value = 0;

            // debug purposes only
            this.log('Consumables input:', JSON.stringify(consumables));

            if (Array.isArray(consumables) && consumables.length > 0) {
                const data = consumables[0];

                /* main_brush_work_time */
                if (data.hasOwnProperty('main_brush_work_time')) {
                    main_brush_remaining_value = data.main_brush_work_time;
                    const main_brush_remaining = main_brush_remaining_value + '%';

                    if (this.getSetting('main_brush_work_time') !== main_brush_remaining) {
                        await this.setSettings({ main_brush_work_time: main_brush_remaining });
                        await this.main_brush_lifetime_token.setValue(main_brush_remaining_value);
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
                        await this.side_brush_lifetime_token.setValue(side_brush_remaining_value);
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
                        await this.filter_lifetime_token.setValue(filter_remaining_value);
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
                    await this.main_brush_lifetime_token.setValue(main_brush_remaining_value);
                    await this.side_brush_lifetime_token.setValue(side_brush_remaining_value);
                    await this.filter_lifetime_token.setValue(filter_remaining_value);
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
     * – Adds the still-missing delta (area & duration)
     * – Adds an extra 30 s because Mi Home is always ~30 s ahead
     * – Increments the lifetime clean-count
     * – Resets the live trackers for the next run
     */
    async _accumulateJobTotals() {
        // Final total area (0.01 m²) and time (seconds) reported by the robot
        const [{ value: area01 }, { value: timeSec }] = await this.miio.call(
            'get_properties',
            [
                { siid: 2, piid: 6 }, // total_clean_area  (0.01 m² units)
                { siid: 2, piid: 7 } // total_clean_time  (seconds)
            ],
            { retries: 1 }
        );

        // Delta since our last live sample
        const deltaArea01 = area01 - this._prevArea01; // 0.01 m²
        const deltaTimeSec = timeSec - this._prevTimeSec; // s

        /* ─── false finish? (pit-stop) ──────────────────────────
        If nothing was added since the last sample,
        we’re still in the middle of the run – abort.          */
        if (deltaArea01 === 0 && deltaTimeSec === 0) {
            this.log('pit-stop – ignore, still cleaning');
            return;
        }

        // --- Xiaomi Home is always ~30 s ahead -------------------------------
        const EXTRA_SEC = 30; // constant offset
        const totalSecDelta = deltaTimeSec + EXTRA_SEC; // corrected delta
        // --------------------------------------------------------------------

        const deltaAreaM2 = deltaArea01 / 100; // → m²
        const deltaHours = totalSecDelta / 3600; // → h

        // Lifetime counters (settings are numeric, per settings schema)
        const totArea = Number(this.getSetting('total_cleared_area') || 0) + deltaAreaM2;
        const totTime = Number(this.getSetting('total_work_time') || 0) + deltaHours;
        const totCnt = Number(this.getSetting('total_clean_count') || 0) + 1;

        // Persist the new totals
        await this.setSettings({
            total_cleared_area: +totArea.toFixed(1), // keep one decimal
            total_work_time: +totTime.toFixed(2), // two decimals
            total_clean_count: totCnt
        });

        // Update Flow tokens
        await this.total_cleared_area_token.setValue(totArea);
        await this.total_work_time_token.setValue(totTime);
        await this.total_clean_count_token.setValue(totCnt);

        // Accurate log (shows the real delta incl. the +30 s)
        this.log(`▲ Job finished: +${deltaArea01}×0.01 m², +${totalSecDelta}s (incl. +${EXTRA_SEC}s offset)`);

        // Keep the last values so the *next* delta starts from here
        this._prevArea01 = area01;
        this._prevTimeSec = timeSec;
    }

    /**
     * Add the delta of area [m²] and time [h] to the lifetime totals,
     * update settings **and** tokens in one go.
     */
    async _addLiveDelta(deltaAreaM2, deltaHours) {
        if (deltaAreaM2 <= 0 && deltaHours <= 0) return; // nothing to do

        const totArea = Number(this.getSetting('total_cleared_area') || 0) + deltaAreaM2;
        const totTime = Number(this.getSetting('total_work_time') || 0) + deltaHours;

        await this.setSettings({
            total_cleared_area: +totArea.toFixed(1),
            total_work_time: +totTime.toFixed(2)
        });

        await this.total_cleared_area_token.setValue(totArea);
        await this.total_work_time_token.setValue(totTime);
    }

    /**
     * User changed advanced settings.
     * We want the generic wifi_device.js handling **plus**
     * updating our lifetime FlowTokens when the user manually edits them.
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
}

module.exports = XiaomiVacuumMiotDeviceMax;
