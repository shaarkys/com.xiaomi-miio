'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/mmgg.pet_waterer.s1 // Xiaomi Smart Pet Fountain
// https://home.miot-spec.com/spec/mmgg.pet_waterer.s4 // Xiaomi Smart Pet Fountain
// https://home.miot-spec.com/spec/mmgg.pet_waterer.wi11 // Xiaomi Smart Pet Fountain
// https://home.miot-spec.com/spec/xiaomi.pet_waterer.iv02 // Xiaomi Smart Pet Fountain 2

const mapping = {
  "mmgg.pet_waterer.s1": "mapping_sx", 
  "mmgg.pet_waterer.s4": "mapping_sx",
	"mmgg.pet_waterer.wi11": "mapping_wix",
  "mmgg.pet_waterer.*": "mapping_sx",
};

const properties = {
  "mapping_sx": {
    "get_properties": [
      { did: "onoff", siid: 2, piid: 2 }, // onoff
      { did: "mode", siid: 2, piid: 3 }, // petwaterdispenser_mmgg_mode
      { did: "no_water_flag", siid : 7, piid: 1 }, // alarm_tank_empty
      { did: "pump_block_flag", siid : 7, piid: 3 }, // alarm_pump_supply
      { did: "error", siid: 2, piid: 1 }, // settings.error
      { did: "filter_life_remaining", siid: 3, piid: 1 }, // settings.filter_life_remaining
      { did: "cotton_life_remaining", siid: 5, piid: 1 }, // settings.cotton_life_remaining
      { did: "cleaning_time_remaining", siid: 6, piid: 1 }, // settings.cleaning_time_remaining
      { did: "light", siid: 4, piid: 1 }, // settings.led
    ],
    "set_properties": {
      "onoff": { siid: 2, piid: 2 },
      "mode": { siid: 2, piid: 3 },
      "light": { siid: 4, piid: 1 }
    }
  },
  "mapping_wix": {
    "get_properties": [
      { did: "onoff", siid: 2, piid: 1 }, // onoff
      { did: "mode", siid: 2, piid: 3 }, // petwaterdispenser_mmgg_mode
      { did: "no_water_flag", siid : 7, piid: 1 }, // alarm_tank_empty
      { did: "pump_block_flag", siid : 7, piid: 3 }, // alarm_pump_supply
      { did: "error", siid: 2, piid: 2 }, // settings.error
      { did: "filter_life_remaining", siid: 3, piid: 1 }, // settings.filter_life_remaining
      { did: "cotton_life_remaining", siid: 5, piid: 1 }, // settings.cotton_life_remaining
      { did: "cleaning_time_remaining", siid: 6, piid: 1 }, // settings.cleaning_time_remaining
      { did: "light", siid: 4, piid: 1 }, // settings.led
    ],
    "set_properties": {
      "onoff": { siid: 2, piid: 1 },
      "mode": { siid: 2, piid: 3 },
      "light": { siid: 4, piid: 1 }
    }
  }
}

const modes = {
  1: "Common",
  2: "Smart"
};

class PetwaterdispenserMmggMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence(); 

      // DEVICE VARIABLES
      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping[this.getStoreValue('mmgg.pet_waterer.*')]];

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async (value) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.onoff.siid, piid: this.deviceProperties.set_properties.onoff.piid, value: value }], { retries: 1 });
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

      this.registerCapabilityListener('petwaterdispenser_mmgg_mode', async (value) => {
        try {
          if (this.miio) {
            const mode = modes[value];
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.mode.siid, piid: this.deviceProperties.set_properties.mode.piid, value: +value }], { retries: 1 });
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

    } catch (error) {
      this.error(error);
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes("address") || changedKeys.includes("token") || changedKeys.includes("polling")) {
      this.refreshDevice();
    }

    if (changedKeys.includes("led")) {
      const led = await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.light.siid, piid: this.deviceProperties.set_properties.light.piid, value: newSettings.led ? 1 : 0 }], { retries: 1 });
    }

    return Promise.resolve(true);
  }

  async retrieveDeviceData() {
    try {

      const result = await this.miio.call("get_properties", this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      /* data */
      const onoff = result.find(obj => obj.did === 'onoff');
      const alarm_tank_empty = result.find(obj => obj.did === 'no_water_flag');
      const alarm_pump_supply = result.find(obj => obj.did === 'pump_block_flag');
      const error_value = result.find(obj => obj.did === 'error');
      const led = result.find(obj => obj.did === 'light');
      const filter_life_remaining = result.find(obj => obj.did === 'filter_life_remaining');
      const cotton_life_remaining = result.find(obj => obj.did === 'cotton_life_remaining');
      const cleaning_time_remaining = result.find(obj => obj.did === 'cleaning_time_remaining');

      /* capabilities */
      await this.updateCapabilityValue("onoff", onoff.value);
      await this.updateCapabilityValue("alarm_tank_empty", alarm_tank_empty.value ? false : true);
      await this.updateCapabilityValue("alarm_pump_supply", alarm_pump_supply.value);

      /* settings */
      await this.updateSettingValue("led", led.value === 0 ? false : true);
      await this.updateSettingValue("filter_life_remaining", filter_life_remaining.value + '%');
      await this.updateSettingValue("cotton_life_remaining", cotton_life_remaining.value + '%');
      await this.updateSettingValue("cleaning_time_remaining", cleaning_time_remaining.value);

      /* settings device error */
      if (error_value.value === 0) {
        var error = "No Error";
      } else {
        var error = "Error with code "+ error_value.value ;
      }
      if ( this.getSetting('error') !== error ) {
        await this.setSettings({ error: error });
      }

      /* mode capability */
      const mode = result.find(obj => obj.did === 'mode');
      if (this.getCapabilityValue('petwaterdispenser_mmgg_mode') !== mode.value.toString()) {
        const previous_mode = this.getCapabilityValue('petwaterdispenser_mmgg_mode');
        await this.setCapabilityValue('petwaterdispenser_mmgg_mode', mode.value.toString());
        await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, {"new_mode": modes[mode.value], "previous_mode": modes[+previous_mode] }).catch(error => { this.error(error) });
      }

    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch(error => { this.error(error) });
      }

      this.homey.setTimeout(() => { this.createDevice(); }, 60000);

      this.error(error.message);
    }
  }

}

module.exports = PetwaterdispenserMmggMiotDevice;
