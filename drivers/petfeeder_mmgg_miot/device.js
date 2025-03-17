'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/mmgg.feeder.fi1 // Xiaomi Smart Pet Food Feeder
// https://home.miot-spec.com/spec/mmgg.feeder.inland // ?
// https://home.miot-spec.com/spec/mmgg.feeder.spec // XIAOWAN Smart Pet Feeder
// https://home.miot-spec.com/spec/xiaomi.feeder.pi2001 // Xiaomi Smart Pet Food Feeder 2
// https://home.miot-spec.com/spec/xiaomi.feeder.iv2001 // Mi Smart Pet Food Feeder 2 CN

const mapping = {
    'mmgg.feeder.fi1': 'default',
    'mmgg.feeder.inland': 'default',
    'mmgg.feeder.spec': 'default',
    'xiaomi.feeder.pi2001': 'pi2001',
    'xiaomi.feeder.iv2001': 'pi2001',
    'mmgg.feeder.*': 'default'
};

const properties = {
    default: {
        get_properties: [
            { did: 'error', siid: 2, piid: 1 }, // settings.error
            { did: 'foodlevel', siid: 2, piid: 6 }, // petfeeder_foodlevel
            { did: 'light', siid: 3, piid: 1 }, // settings.led
            { did: 'buzzer', siid: 6, piid: 1 } // settings.buzzer
        ],
        set_properties: {
            serve_food: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
            light: { siid: 3, piid: 1 },
            buzzer: { siid: 6, piid: 1 }
        }
    },
    pi2001: {
        get_properties: [
            { did: 'error', siid: 2, piid: 1 }, // settings.error
            { did: 'foodlevel', siid: 2, piid: 6 }, // petfeeder_foodlevel
            { did: 'battery', siid: 4, piid: 4 } // measure_battery
        ],
        set_properties: {
            serve_food: { siid: 2, aiid: 1, did: 'call-2-1', in: [] }
        }
    }
};

class PetwaterFeederMmggMiotDevice extends Device {
    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            // GENERIC DEVICE INIT ACTIONS
            this.bootSequence();

            // DEVICE VARIABLES
            this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping[this.getStoreValue('mmgg.feeder.*')]];

            this.errorCodes = {
                0: 'No Error',
                1: 'OK',
                3: 'Error',
                5: 'Timeout'
            };

            this.modes = {
                0: 'Normal',
                1: 'Low',
                2: 'Empty'
            };

            // DEVICE CAPABILITIES
            if ((this.getStoreValue('model') === 'xiaomi.feeder.pi2001' || this.getStoreValue('model') === 'xiaomi.feeder.iv2001') && !this.hasCapability('measure_battery')) {
                this.addCapability('measure_battery');
            }

            // FLOW TRIGGER CARDS
            this.homey.flow.getDeviceTriggerCard('triggerModeChanged');
        } catch (error) {
            this.error(error);
        }
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
            this.refreshDevice();
        }

        if (changedKeys.includes('led')) {
            const led = await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.light.siid, piid: this.deviceProperties.set_properties.light.piid, value: newSettings.led ? 1 : 0 }], { retries: 1 });
        }

        if (changedKeys.includes('buzzer')) {
            const buzzer = await this.miio.call('set_properties', [{ siid: this.deviceProperties.set_properties.buzzer.siid, piid: this.deviceProperties.set_properties.buzzer.piid, value: newSettings.buzzer ? 1 : 0 }], { retries: 1 });
        }

        return Promise.resolve(true);
    }

    async retrieveDeviceData() {
        try {
            this.log('Retrieving device data for model:', this.getStoreValue('model'));

            const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
            this.log('Received data:', result);

            if (!this.getAvailable()) {
                await this.setAvailable();
                this.log('Device set as available');
            }

            // Extract properties
            const battery = result.find((obj) => obj.did === 'battery');
            const led = result.find((obj) => obj.did === 'light');
            const buzzer = result.find((obj) => obj.did === 'buzzer');

            // Update battery capability
            if (battery !== undefined) {
                if (this.hasCapability('measure_battery')) {
                    this.log('Battery level:', battery.value);
                    await this.updateCapabilityValue('measure_battery', battery.value);
                } else {
                    this.warn('Battery capability missing, adding capability.');
                    await this.addCapability('measure_battery');
                    await this.updateCapabilityValue('measure_battery', battery.value);
                }
            } else {
                this.warn('Battery data missing from response:', result);
            }

            // Update settings if applicable
            if (led !== undefined) {
                await this.updateSettingValue('led', led.value !== 0);
            }

            if (buzzer !== undefined) {
                await this.updateSettingValue('buzzer', buzzer.value !== 0);
            }

            // Update error setting
            const error_value = result.find((obj) => obj.did === 'error');
            if (error_value) {
                const error = this.errorCodes[error_value.value] || 'Unknown Error';
                await this.updateSettingValue('error', error);
            } else {
                this.warn('Error value missing from response:', result);
            }

            // Update food level capability
            const foodlevel = result.find((obj) => obj.did === 'foodlevel');
            if (foodlevel && foodlevel.value !== undefined) {
                if (this.getCapabilityValue('petfeeder_foodlevel') !== foodlevel.value.toString()) {
                    const previous_mode = this.getCapabilityValue('petfeeder_foodlevel');
                    await this.setCapabilityValue('petfeeder_foodlevel', foodlevel.value.toString());
                    this.log('Food level changed from', previous_mode, 'to', foodlevel.value);

                    await this.homey.flow
                        .getDeviceTriggerCard('triggerModeChanged')
                        .trigger(this, { new_mode: this.modes[foodlevel.value], previous_mode: this.modes[+previous_mode] })
                        .catch((error) => this.error('Flow trigger error:', error));
                }
            } else {
                this.warn('Food level missing from response:', result);
            }
        } catch (error) {
            this.error('Failed retrieving device data:', error);

            this.homey.clearInterval(this.pollingInterval);

            if (this.getAvailable()) {
                this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch(this.error);
            }

            this.homey.setTimeout(() => {
                this.createDevice();
            }, 60000);
        }
    }
}

module.exports = PetwaterFeederMmggMiotDevice;
