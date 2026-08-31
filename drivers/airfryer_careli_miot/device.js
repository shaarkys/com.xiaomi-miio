'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const {
  getModelProfile,
  findValidResult,
  encodePreheat,
  decodePreheat
} = require('../../lib/airfryer-careli-miot.js');

/* supported devices */
// https://home.miot-spec.com/spec/careli.fryer.maf05a // Xiaomi Smart Air Fryer Pro 4L
// https://home.miot-spec.com/spec/careli.fryer.ybaf04 // KitchenMi Smart Air Fryer 6007WAB
// https://home.miot-spec.com/spec/careli.fryer.ybaf03 // KitchenMi Smart Air Fryer 6007WA
// https://home.miot-spec.com/spec/careli.fryer.maf02c // Mi Smart Air Fryer (3.5L)
// https://home.miot-spec.com/spec/careli.fryer.maf07  // Mi Smart Air Fryer (3.5L)
// https://home.miot-spec.com/spec/careli.fryer.maf02  // Mi Smart Air Fryer (3.5L)
// https://home.miot-spec.com/spec/careli.fryer.maf10a  // Mi Smart Air Fryer 6.5L
// https://miot-spec.org/miot-spec-v2/instance?type=urn:miot-spec-v2:device:air-fryer:0000A0A4:xiaomi-maf65:1:0000D043 // Xiaomi Smart Air Fryer 6.5L

class AirfryerCareliMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // DEVICE VARIABLES
      this.modelProfile = getModelProfile(this.getStoreValue('model'));
      this.deviceProperties = this.modelProfile.properties;
      await this.configureModelCapabilities();

      this.errorCodes = {
        0: "No Error",
        1: "E1",
        2: "E2",
        3: "E3"
      }

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async ( value ) => {
        try {
          if (this.miio) {
            if (value) {
              return await this.miio.call("action", this.deviceProperties.actions.start_cook, { retries: 1 });
            } else {
              return await this.miio.call("action", this.deviceProperties.actions.stop_cook, { retries: 1 });
            }
          } else {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error) });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      this.registerCapabilityListener('airfryer_careli_target_time', async ( value ) => {
        try {
          if (this.miio) {
            return await this.setMiotProperty('target_time', +value);
          } else {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error) });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      this.registerCapabilityListener('airfryer_careli_target_temperature', async ( value ) => {
        try {
          if (this.miio) {
            return await this.setMiotProperty('target_temperature', +value);
          } else {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error) });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      this.registerCapabilityListener('onoff.preheat', async ( value ) => {
        try {
          if (this.miio) {
            return await this.setMiotProperty('preheat_switch', encodePreheat(this.modelProfile, value));
          } else {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error) });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      this.registerCapabilityListener('airfryer_careli_food_quantity', async ( value ) => {
        try {
          if (this.miio) {
            return await this.setMiotProperty('food_quantity', +value);
          } else {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error) });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

    } catch (error) {
      this.error(error);
    }
  }

  async configureModelCapabilities() {
    const options = this.modelProfile.target_temperature_options;
    if (!options || !this.hasCapability('airfryer_careli_target_temperature')) return;

    try {
      const current = this.getCapabilityOptions('airfryer_careli_target_temperature');
      if (current?.min === options.min && current?.max === options.max && current?.step === options.step) return;
    } catch (error) {
      // Older paired devices can lack stored per-device options; applying the released model range below is safe.
    }

    try {
      await this.setCapabilityOptions('airfryer_careli_target_temperature', options);
    } catch (error) {
      this.error('Failed to configure target temperature range for', this.getStoreValue('model'), error);
    }
  }

  async setMiotProperty(property, value) {
    const definition = this.deviceProperties.set_properties[property];
    if (!definition) throw new Error(`Unsupported air fryer property: ${property}`);

    return this.miio.call('set_properties', [{ ...definition, value }], { retries: 1 });
  }

  async retrieveDeviceData() {
    try {

      const result = await this.miio.call("get_properties", this.deviceProperties.get_properties, { retries: 1 });

      /* data */
      const status = findValidResult(result, 'status');
      const fault = findValidResult(result, 'fault');
      const target_time = findValidResult(result, 'target_time');
      const target_temperature = findValidResult(result, 'target_temperature');
      const food_quantity = findValidResult(result, 'food_quantity');
      const onoff_preheat = findValidResult(result, 'preheat_switch');
      const missingRequired = [
        ['status', status],
        ['fault', fault],
        ['target_time', target_time],
        ['target_temperature', target_temperature]
      ].filter(([, entry]) => entry === undefined).map(([did]) => did);

      if (missingRequired.length > 0) {
        throw new Error(`Invalid MIoT response: missing valid ${missingRequired.join(', ')}`);
      }

      if (!this.getAvailable()) { await this.setAvailable(); }

      /* capabilities */
      await this.updateCapabilityValue("airfryer_careli_target_time", target_time.value);
      await this.updateCapabilityValue("airfryer_careli_target_temperature", target_temperature.value);

      if (food_quantity) {
        await this.updateCapabilityValue("airfryer_careli_food_quantity", food_quantity.value.toString());
      }

      /* settings */
      const error = this.errorCodes[fault.value];
      await this.updateSettingValue("error", error);

      /* onoff */
      await this.updateCapabilityValue("onoff", this.modelProfile.active_statuses.has(status.value));

      /* onoff.preheat */
      if (onoff_preheat) {
        await this.updateCapabilityValue("onoff.preheat", decodePreheat(this.modelProfile, onoff_preheat.value));
      }

      /* mode capability */
      if (this.getCapabilityValue('airfryer_careli_mode') !== status.value.toString()) {
        const previous_mode = this.getCapabilityValue('airfryer_careli_mode');
        await this.setCapabilityValue('airfryer_careli_mode', status.value.toString());
        await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, {"new_mode": this.modelProfile.status_names[status.value], "previous_mode": this.modelProfile.status_names[+previous_mode] }).catch(error => { this.error(error) });
      }

    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);
      const message = error?.message || String(error);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + message).catch(error => { this.error(error) });
      }

      this.homey.clearTimeout(this.recreateTimeout);
      this.recreateTimeout = this.homey.setTimeout(() => { this.createDevice(); }, 60000);

      this.error(message);
    }
  }

}

module.exports = AirfryerCareliMiotDevice;
