'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.pet_waterer.iv02 // Xiaomi Smart Pet Fountain 2

const mapping = {
    'xiaomi.pet_waterer.iv02': 'mapping_iv02'
};

const properties = {
    mapping_iv02: {
        get_properties: [
            { did: 'onoff', siid: 2, piid: 1 }, // Power
            { did: 'fault', siid: 2, piid: 2 }, // Error
            { did: 'status', siid: 2, piid: 3 }, // Status (1=Waterless, 2=Watering)
            { did: 'mode', siid: 2, piid: 4 }, // Mode (0=Auto, 1=Interval, 2=Constant)
            { did: 'out_water_interval_15', siid: 2, piid: 7 }, // Out water interval (step 15)
            { did: 'water_shortage_status', siid: 2, piid: 10 }, // Water shortage (bool)
            { did: 'out_water_interval_5', siid: 2, piid: 11 }, // Out water interval (step 5)
            { did: 'filter_life_level', siid: 3, piid: 1 }, // Filter life (%)
            { did: 'filter_left_time', siid: 3, piid: 2 } // Filter left time (days)
        ],
        set_properties: {
            onoff: { siid: 2, piid: 1 },
            mode: { siid: 2, piid: 4 }
        }
    }
};

// Fountain modes (for capability petwaterdispenser_mmgg_mode_3)
const modes_iv02 = {
    0: 'Auto',
    1: 'Interval',
    2: 'Constant'
};

class PetwaterdispenserXiaomiDevice extends Device {
    normalizeBooleanValue(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (typeof value === 'string') {
            const normalized = value.toLowerCase();
            return normalized === '1' || normalized === 'true' || normalized === 'on';
        }
        return false;
    }

    // Helper method to pretty print properties (similar to the reference device)
    prettyPrintProperties(result, propertyDefs) {
        try {
            const formatted = result.map((item) => {
                const def = propertyDefs.find((p) => p.siid === item.siid && p.piid === item.piid);
                return {
                    did: def ? def.did : `unknown_${item.siid}_${item.piid}`,
                    siid: item.siid,
                    piid: item.piid,
                    value: item.value,
                    code: item.code
                };
            });
            return JSON.stringify(formatted, null, 2);
        } catch (error) {
            this.error('Error formatting properties:', error);
            return JSON.stringify(result);
        }
    }

    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            this.log('Xiaomi Smart Pet Fountain 2 initializing...');
            this.bootSequence();

            // Use mapping/properties for model (future-proof)
            this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['xiaomi.pet_waterer.iv02']];

            // FLOW TRIGGER CARDS
            this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

            // Register flow action card for setting mode
            this.homey.flow.getActionCard('petwaterdispenserMmggMode_Xiaomi').registerRunListener(async (args, state) => {
                this.log(`[flow] Setting fountain mode to: ${args.mode} (${modes_iv02[args.mode]})`);
                return await this.triggerCapabilityListener('petwaterdispenser_mmgg_mode_3', args.mode);
            });

            // Capability listeners
            this.registerCapabilityListener('onoff', async (value) => {
                try {
                    this.log(`[onoff] Setting power to: ${value}`);
                    if (this.miio) {
                        return await this.miio.call(
                            'set_properties',
                            [
                                {
                                    siid: this.deviceProperties.set_properties.onoff.siid,
                                    piid: this.deviceProperties.set_properties.onoff.piid,
                                    value: !!value
                                }
                            ],
                            { retries: 1 }
                        );
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((e) => this.error(e));
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            this.registerCapabilityListener('petwaterdispenser_mmgg_mode_3', async (value) => {
                try {
                    this.log(`[mode] Setting mode to: ${value}`);
                    if (this.miio) {
                        return await this.miio.call(
                            'set_properties',
                            [
                                {
                                    siid: this.deviceProperties.set_properties.mode.siid,
                                    piid: this.deviceProperties.set_properties.mode.piid,
                                    value: +value
                                }
                            ],
                            { retries: 1 }
                        );
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((e) => this.error(e));
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

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
            this.refreshDevice();
        }
        return Promise.resolve(true);
    }

    async retrieveDeviceData() {
        try {
            const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
            if (!this.getAvailable()) await this.setAvailable();

            // Store previous values to compare
            const prevProps = this._lastPropertyValues || {};

            // Extract current values into a simple object for comparison
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

            const onoff = result.find((obj) => obj.did === 'onoff');
            const error_value = result.find((obj) => obj.did === 'fault');
            const status = result.find((obj) => obj.did === 'status');
            const mode = result.find((obj) => obj.did === 'mode');
            const water_shortage = result.find((obj) => obj.did === 'water_shortage_status');
            const filter_life = result.find((obj) => obj.did === 'filter_life_level');
            const filter_days_left = result.find((obj) => obj.did === 'filter_left_time');

            /* Capabilities */
            if (onoff) {
                await this.updateCapabilityValue('onoff', this.normalizeBooleanValue(onoff.value));
            }

            if (mode && this.getCapabilityValue('petwaterdispenser_mmgg_mode_3') !== mode.value.toString()) {
                const prev_mode = this.getCapabilityValue('petwaterdispenser_mmgg_mode_3');
                await this.setCapabilityValue('petwaterdispenser_mmgg_mode_3', mode.value.toString());
                await this.homey.flow
                    .getDeviceTriggerCard('triggerModeChanged')
                    .trigger(this, {
                        new_mode: modes_iv02[mode.value],
                        previous_mode: modes_iv02[+prev_mode]
                    })
                    .catch((err) => this.error(err));
                this.log(`[diagnostics] Device mode changed: ${mode.value}`);
            }

            if (water_shortage) {
                await this.updateCapabilityValue('alarm_tank_empty', !!water_shortage.value);
            }

            if (error_value) {
                const errorMsg = error_value.value === 0 ? 'No Error' : `Error code: ${error_value.value}`;
                // Fix: Use dynamic key name for settings update
                const settingsUpdate = { error: errorMsg };
                await this.setSettings(settingsUpdate);
                this.log(`[diagnostics] Device error status: ${errorMsg}`);
            }

            // Update filter status as capabilities
            if (filter_life) {
                const filterLifeSettings = { filter_life_remaining: filter_life.value + '%' };
                await this.setSettings(filterLifeSettings);

                await this.updateCapabilityValue('measure_filter_life', filter_life.value);
            }

            if (filter_days_left) {
                const filterDaysSettings = { filter_days_left: filter_days_left.value };
                await this.setSettings(filterDaysSettings);

                await this.updateCapabilityValue('measure_filter_days_left', filter_days_left.value);
            }
        } catch (error) {
            this.homey.clearInterval(this.pollingInterval);
            if (this.getAvailable()) {
                this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((e) => this.error(e));
            }
            this.homey.setTimeout(() => this.createDevice(), 60000);
            this.error(error.message);
        }
    }
}

module.exports = PetwaterdispenserXiaomiDevice;
