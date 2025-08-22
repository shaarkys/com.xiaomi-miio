'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.vacuum.b112gl
// https://home.miot-spec.com/spec/xiaomi.vacuum.b106eu
// https://home.miot-spec.com/spec/xiaomi.vacuum.b112
// https://home.miot-spec.com/spec/xiaomi.vacuum.c101
// https://home.miot-spec.com/spec/xiaomi.vacuum.c102gl // Xiaomi Robot Vacuum X20+

const mapping = {
    'xiaomi.vacuum.b112gl': 'properties_default',
    'xiaomi.vacuum.b106eu': 'properties_default',
    'xiaomi.vacuum.b112': 'properties_default',
    'xiaomi.vacuum.c101': 'properties_c101',
    'xiaomi.vacuum.c102gl': 'properties_c102',
    'xiaomi.vacuum.*': 'properties_default'
};

const properties = {
    properties_default: {
        get_properties: [
            { did: 'device_status', siid: 2, piid: 1 }, // vacuumcleaner_state
            { did: 'device_fault', siid: 2, piid: 2 }, // settings.error
            { did: 'mode', siid: 2, piid: 4 }, // vacuum_xiaomi_mop_mode
            { did: 'battery', siid: 3, piid: 1 }, // measure_battery
            { did: 'main_brush_life_level', siid: 7, piid: 10 }, // settings.main_brush_work_time
            { did: 'side_brush_life_level', siid: 7, piid: 8 }, // settings.side_brush_work_time
            { did: 'filter_life_level', siid: 7, piid: 12 }, // settings.filter_work_time
            { did: 'total_clean_time', siid: 7, piid: 28 }, // settings.total_work_time
            { did: 'total_clean_count', siid: 7, piid: 22 }, // settings.clean_count
            { did: 'total_clean_area', siid: 7, piid: 29 } // settings.total_cleared_area
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
            find: { siid: 6, aiid: 6, did: 'call-6-6', in: [] },
            home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] },
            mopmode: { siid: 2, piid: 4 }
        },
        error_codes: {
            0: 'Everything-is-ok',
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
            12: 'Pick-up-error'
        },
        status_mapping: {
            cleaning: [3, 5, 6, 7],
            spot_cleaning: [],
            docked: [0],
            charging: [4],
            stopped: [1, 2, 8],
            stopped_error: []
        }
    },
    properties_c101: {
        get_properties: [
            { did: 'device_status', siid: 2, piid: 1 }, // vacuumcleaner_state
            { did: 'device_fault', siid: 2, piid: 2 }, // settings.error
            { did: 'mode', siid: 2, piid: 4 }, // vacuum_xiaomi_mop_mode
            { did: 'battery', siid: 3, piid: 1 }, // measure_battery
            { did: 'main_brush_life_level', siid: 16, piid: 1 }, // settings.main_brush_work_time
            { did: 'side_brush_life_level', siid: 17, piid: 1 }, // settings.side_brush_work_time
            { did: 'filter_life_level', siid: 15, piid: 1 }, // settings.filter_work_time
            { did: 'total_clean_time', siid: 7, piid: 28 }, // settings.total_work_time
            { did: 'total_clean_count', siid: 7, piid: 22 }, // settings.clean_count
            { did: 'total_clean_area', siid: 7, piid: 29 } // settings.total_cleared_area
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
            find: { siid: 6, aiid: 6, did: 'call-6-6', in: [] },
            home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] },
            mopmode: { siid: 2, piid: 4 }
        },
        error_codes: {
            0: 'No Error',
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
            0: 'Everything-is-ok',
            12: 'Pick-up-error'
        },
        status_mapping: {
            cleaning: [3, 5, 6, 7],
            spot_cleaning: [],
            docked: [0, 9, 10, 11, 12],
            charging: [4],
            stopped: [1, 2, 8],
            stopped_error: []
        }
    },
    properties_c102: {
        get_properties: [
            { did: 'device_status', siid: 2, piid: 1 }, // vacuumcleaner_state
            { did: 'device_fault', siid: 2, piid: 2 }, // settings.error
            { did: 'mode', siid: 2, piid: 3 }, // vacuum_xiaomi_mop_mode
            { did: 'battery', siid: 3, piid: 1 }, // measure_battery
            { did: 'main_brush_life_level', siid: 9, piid: 2 }, // settings.main_brush_work_level
            { did: 'side_brush_life_level', siid: 10, piid: 2 }, // settings.side_brush_work_level
            { did: 'filter_life_level', siid: 11, piid: 1 }, // settings.filter_work_level
            { did: 'total_clean_time', siid: 12, piid: 2 }, // settings.total_work_time
            { did: 'total_clean_count', siid: 12, piid: 3 }, // settings.clean_count
            { did: 'total_clean_area', siid: 12, piid: 4 } // settings.total_cleared_area
        ],
        set_properties: {
            start_clean: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            stop_clean: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
            find: { siid: 7, aiid: 2, did: 'call-7-2', in: [] },
            home: { siid: 3, aiid: 1, did: 'call-3-1', in: [] },
            mopmode: { siid: 2, piid: 6 }
        },
        error_codes: {
            0: 'Everything-is-ok',
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
            12: 'Pick-up-error'
        },
        status_mapping: {
            cleaning: [1, 5, 7, 8, 9, 10, 12],
            spot_cleaning: [],
            docked: [0, 11, 13, 14, 19],
            charging: [6],
            stopped: [2, 3, 21, 22, 23],
            stopped_error: [4]
        }
    }
};

class XiaomiVacuumMiotDevice extends Device {
    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            // GENERIC DEVICE INIT ACTIONS
            this.bootSequence();

            // ADD/REMOVE DEVICES DEPENDANT CAPABILITIES

            // Device-specific logic - currently for xiaomi.vacuum.c102gl only as generic logic is using slighly different calcalutions
            if (this.getStoreValue('model') === 'xiaomi.vacuum.c102gl') {
                this.log('Using custom vacuumTotals and custom vacuumConsumables method for xiaomi.vacuum.c102gl');
                this.vacuumTotals = this.customVacuumTotals; // Override method dynamically
                this.vacuumConsumables = this.customVacuumConsumables; // Override method dynamically
            }

            // DEVICE VARIABLES
            this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['xiaomi.vacuum.*']];

            // RESET CONSUMABLE ALARMS
            this.updateCapabilityValue('alarm_main_brush_work_time', false);
            this.updateCapabilityValue('alarm_side_brush_work_time', false);
            this.updateCapabilityValue('alarm_filter_work_time', false);

            // DEVICE TOKENS
            this.main_brush_lifetime_token = await this.homey.flow.createToken('main_brush_lifetime' + this.getData().id, { type: 'number', title: 'Main Brush Lifetime ' + this.getName() + ' (%)' }).catch((error) => {
                this.error(error);
            });
            this.side_brush_lifetime_token = await this.homey.flow.createToken('side_brush_lifetime' + this.getData().id, { type: 'number', title: 'Side Brush Lifetime ' + this.getName() + ' (%)' }).catch((error) => {
                this.error(error);
            });
            this.filter_lifetime_token = await this.homey.flow.createToken('filter_lifetime' + this.getData().id, { type: 'number', title: 'Filter LifeTime ' + this.getName() + ' (%)' }).catch((error) => {
                this.error(error);
            });
            this.total_work_time_token = await this.homey.flow.createToken('total_work_time' + this.getData().id, { type: 'number', title: 'Total Work Time ' + this.getName() + ' h)' }).catch((error) => {
                this.error(error);
            });
            this.total_cleared_area_token = await this.homey.flow.createToken('total_cleared_area' + this.getData().id, { type: 'number', title: 'Total Cleaned Area ' + this.getName() + ' (m2)' }).catch((error) => {
                this.error(error);
            });
            this.total_clean_count_token = await this.homey.flow.createToken('total_clean_count' + this.getData().id, { type: 'number', title: 'Total Clean Count ' + this.getName() }).catch((error) => {
                this.error(error);
            });

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

            /* vacuumcleaner dreame fanspeed */
            this.registerCapabilityListener('vacuum_dreame_fanspeed', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.fanspeed.siid, piid: this.deviceProperties.set_properties.fanspeed.piid, value: Number(value) }], { retries: 1 });
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

            /* vacuumcleaner xiaomi mop mode */
            this.registerCapabilityListener('vacuum_xiaomi_mop_mode', async (value) => {
                try {
                    // Existing code, do not remove:
                    const numericValue = Number(value); // Ensure value is treated as a number
                    this.log(`Received mop mode value: ${value} (type: ${typeof value}), Converted: ${numericValue}`);

                    // Default to original numeric value for non-c102gl models
                    let adjustedValue = numericValue;

                    // Outbound (setting to the vacuum) mapping ONLY if model is xiaomi.vacuum.c102gl
                    if (this.getStoreValue('model') === 'xiaomi.vacuum.c102gl') {
                        // Example: device sees 0 => Mop & Sweep, 1 => Mop, 2 => Sweep
                        // but our JSON is 0 => Sweep, 1 => Sweep & Mop, 2 => Mop
                        // We'll invert them as needed. 
                        const mapOutboundMopMode = (homeyValue) => {
                            switch (homeyValue) {
                                case 0: // Homey 0 => "Sweep"
                                    return 2; // Device wants 2 => "Sweep"
                                case 1: // Homey 1 => "Sweep & Mop"
                                    return 0; // Device wants 0 => "Sweep & Mop"
                                case 2: // Homey 2 => "Mop"
                                    return 1; // Device wants 1 => "Mop"
                                default:
                                    return 2; // fallback, or pick something safe
                            }
                        };
                        const mapped = mapOutboundMopMode(numericValue);
                        this.log(`(c102gl) Outbound remap: Homey value=${numericValue} => deviceValue=${mapped}`);
                        adjustedValue = mapped;
                    }

                    if (this.miio) {
                        return await this.miio.call(
                            'set_properties',
                            [
                                {
                                    siid: this.deviceProperties.set_properties.mopmode.siid,
                                    piid: this.deviceProperties.set_properties.mopmode.piid,
                                    value: adjustedValue
                                }
                            ],
                            { retries: 1 }
                        );
                    } else {
                        // Handle device unreachable scenario
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

            // debug purposes only
            //this.log('Raw property data:', result);

            //temporary debug !!!
            //const resultmop = await this.miio.call('get_properties', [{ siid: 2, piid: 6 }], { retries: 1 });
            //this.log('Supported mop mode values:', resultmop);
            //this.log('Device Properties:', this.deviceProperties);
            //this.log('Status Mapping:', this.deviceProperties.status_mapping);
            //this.log('Device Status Value:', device_status.value);

            //temporary debug !!!
            /*
            try {
                this.log('Starting full property scan...');
    
                const results = [];
                
                // Iterate over a reasonable range of SIIDs and PIIDs
                for (let siid = 1; siid <= 18; siid++) {
                    for (let piid = 1; piid <= 50; piid++) {
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
            } */

            /* data */
            const device_status = result.find((obj) => obj.did === 'device_status');
            const mop_mode = result.find((obj) => obj.did === 'mode');
            const battery = result.find((obj) => obj.did === 'battery');
            const fan_speed = result.find((obj) => obj.did === 'fan_speed');
            const main_brush_life_level = result.find((obj) => obj.did === 'main_brush_life_level');
            const side_brush_life_level = result.find((obj) => obj.did === 'side_brush_life_level');
            const filter_life_level = result.find((obj) => obj.did === 'filter_life_level');
            const total_clean_time = result.find((obj) => obj.did === 'total_clean_time');
            const total_clean_count = result.find((obj) => obj.did === 'total_clean_count');
            const total_clean_area = result.find((obj) => obj.did === 'total_clean_area');
            const device_fault = result.find((obj) => obj.did === 'device_fault');

            const consumables = [
                {
                    main_brush_work_time: main_brush_life_level.value,
                    side_brush_work_time: side_brush_life_level.value,
                    filter_work_time: filter_life_level.value
                }
            ];

            const totals = {
                clean_time: total_clean_time.value,
                clean_count: total_clean_count.value,
                clean_area: total_clean_area.value
            };

            /* onoff & vacuumcleaner_state */
            let matched = false;

            for (let key in this.deviceProperties.status_mapping) {
                if (this.deviceProperties.status_mapping[key].includes(device_status.value)) {
                    matched = true;
                    if (this.getCapabilityValue('measure_battery') === 100 && (key === 'stopped' || key === 'charging')) {
                        this.vacuumCleanerState('docked');
                    } else {
                        this.vacuumCleanerState(key);
                    }
                    break; // Exit the loop once a match is found - it was causing errors previously
                }
            }

            if (!matched) {
                this.log('Not a valid vacuumcleaner_state (driver level)', device_status.value);
            }

            /* measure_battery & alarm_battery */
            await this.updateCapabilityValue('measure_battery', battery.value);
            await this.updateCapabilityValue('alarm_battery', battery.value <= 20 ? true : false);

            /* vacuum_dreame_fanspeed */
            if (fan_speed !== undefined && this.hasCapability('vacuum_dreame_fanspeed')) {
                await this.updateCapabilityValue('vacuum_dreame_fanspeed', fan_speed.value.toString());
            }

            /* vacuum_xiaomi_mop_mode */
            // Original code
            let finalMopModeValue = mop_mode.value;

            // Inbound (getting status from Vacuum) mapping ONLY if model is c102gl
            if (this.getStoreValue('model') === 'xiaomi.vacuum.c102gl') {
                const deviceVal = device_status.value;
                const mapInboundMopMode = (statusVal) => {
                    switch (statusVal) {
                        case 1: // Sweeping
                            return 0; // Homey’s "0" => Sweep
                        case 7: // Mopping
                            return 2; // Homey’s "2" => Mop
                        case 12: // Sweeping & Mopping
                            return 1; // Homey’s "1" => Sweep & Mop
                        default:
                            // fallback: pick "0" => Sweep if unknown
                            return 0;
                    }
                };

                finalMopModeValue = mapInboundMopMode(deviceVal);
                this.log(`(c102gl) inbound statusVal=${deviceVal}, mapped to Homey mop mode=${finalMopModeValue}`);
            }

            // Now set the capability with finalMopModeValue
            await this.updateCapabilityValue('vacuum_xiaomi_mop_mode', finalMopModeValue.toString());
            
            /* consumable settings */
            this.vacuumConsumables(consumables);

            /* totals */
            this.vacuumTotals(totals);

            /* settings device error */
            const error = this.deviceProperties.error_codes[device_fault.value];
            // If the lookup failed, error is undefined. Provide a fallback string:
            let safeError = typeof error === 'string' ? error : 'Unknown Error';
            if (this.getSetting('error') !== error) {
                await this.setSettings({ error: error });
                if (error !== 0) {
                    await this.homey.flow
                        .getDeviceTriggerCard('statusVacuum')
                        .trigger(this, { status: safeError })
                        .catch((error) => {
                            this.error(error);
                        });
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

    /* Custom vacuumTotals for xiaomi.vacuum.c102gl */
    async customVacuumTotals(totals) {
        try {
            let worktime = 0;
            let cleared_area = 0;
            let clean_count = 0;

            // Use correct properties for the totals
            if (totals.hasOwnProperty('clean_time')) {
                worktime = totals.clean_time;
                cleared_area = totals.clean_area;
                clean_count = totals.clean_count;
            } else {
                worktime = totals[0];
                cleared_area = totals[1];
                clean_count = totals[2];
            }

            /* Corrected total_work_time calculation */
            const total_work_time_value = Math.round(worktime / 60); // Convert minutes to hours
            const total_work_time = total_work_time_value + ' h';
            if (this.getSetting('total_work_time') !== total_work_time) {
                await this.setSettings({ total_work_time: total_work_time });
                await this.total_work_time_token.setValue(total_work_time_value);
            }

            /* Corrected total_cleared_area calculation */
            const total_cleared_area_value = cleared_area; // Already in m²
            const total_cleared_area = total_cleared_area_value + ' m2';
            if (this.getSetting('total_cleared_area') !== total_cleared_area) {
                await this.setSettings({ total_cleared_area: total_cleared_area });
                await this.total_cleared_area_token.setValue(total_cleared_area_value);
            }

            /* Corrected total_clean_count */
            if (this.getSetting('total_clean_count') !== clean_count) {
                await this.setSettings({ total_clean_count: String(clean_count) });
                await this.total_clean_count_token.setValue(clean_count);
            }

            /* Initial token updates */
            if (!this.initialTokenTotal || this.initialTokenTotal == undefined) {
                await this.total_work_time_token.setValue(total_work_time_value);
                await this.total_cleared_area_token.setValue(total_cleared_area_value);
                await this.total_clean_count_token.setValue(clean_count);
                this.initialTokenTotal = true;
            }
        } catch (error) {
            this.error('Custom vacuumTotals error:', error);
        }
    }

    /* Custom VacuumConsumables for xiaomi.vacuum.c102gl */

    async customVacuumConsumables(consumables) {
        try {
            let main_brush_remaining_value = 0;
            let side_brush_remaining_value = 0;
            let filter_remaining_value = 0;

            // debug purposes only
            // this.log('Consumables input:', JSON.stringify(consumables));

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
}

module.exports = XiaomiVacuumMiotDevice;
