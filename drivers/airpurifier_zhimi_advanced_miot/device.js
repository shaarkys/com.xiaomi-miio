'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/zhimi.airpurifier.ma4 // Airpurifier 3
// https://home.miot-spec.com/spec/zhimi.airpurifier.mb3 // Airpurifier 3H
// https://home.miot-spec.com/spec/zhimi.airpurifier.mb3a // Airpurifier 3H
// https://home.miot-spec.com/spec/zhimi.airp.mb3a // Airpurifier 3H
// https://home.miot-spec.com/spec/zhimi.airpurifier.va1 // Airpurifier Pro H
// https://home.miot-spec.com/spec/zhimi.airpurifier.vb2 // Airpurifier ProH
// https://home.miot-spec.com/spec/zhimi.airpurifier.mb4 // Airpurifier 3C
// https://home.miot-spec.com/spec/zhimi.airp.mb4a // Airpurifier 3C
// https://home.miot-spec.com/spec/zhimi.airp.mb5 // Airpurifier 4
// https://home.miot-spec.com/spec/zhimi.airp.mb5a // Airpurifier 4
// https://home.miot-spec.com/spec/zhimi.airp.va2 // Airpurifier 4 Pro
// https://home.miot-spec.com/spec/zhimi.airp.vb4 // Airpurifier 4 Pro
// https://home.miot-spec.com/spec/zhimi.airpurifier.rma1 // Airpurifier 4 Lite
// https://home.miot-spec.com/spec/zhimi.airp.rmb1 // Airpurifier 4 Lite
// https://home.miot-spec.com/spec/zhimi.airpurifier.za1 // Smartmi Air Purifier
// https://home.miot-spec.com/spec/zhimi.airp.za3 // Smartmi Air Purifier 3
// https://home.miot-spec.com/spec/zhimi.airp.meb1 // Xiaomi Smart Air Purifier Elite
// https://home.miot-spec.com/spec/xiaomi.airp.cpa4 // Xiaomi Smart Air Purifier 4 Compact
// https://home.miot-spec.com/spec/zhimi.airp.cpa4 // Xiaomi Smart Air Purifier 4 Compact

const mapping = {
  "zhimi.airpurifier.ma4": "mapping_default", 
  "zhimi.airpurifier.mb3": "mapping_default",
	"zhimi.airpurifier.mb3a": "mapping_default",
	"zhimi.airp.mb3a": "mapping_default",
	"zhimi.airpurifier.va1": "mapping_default",
	"zhimi.airpurifier.vb2": "mapping_default",
	"zhimi.airpurifier.mb4": "mapping_mb4",
	"zhimi.airp.mb4a": "mapping_mb4",
	"zhimi.airp.mb5": "mapping_va2",
  "zhimi.airp.mb5a": "mapping_va2",
  "xiaomi.airp.mb5": "mapping_va2",
  "xiaomi.airp.mb5a": "mapping_va2",
	"zhimi.airp.va2": "mapping_va2",
  "zhimi.airp.vb4": "mapping_vb4",
  "zhimi.airpurifier.rma1": "mapping_rma1",
  "zhimi.airp.rmb1": "mapping_rmb1",
  "zhimi.airpurifier.za1": "mapping_za1",
  "zhimi.airp.za3": "mapping_za3",
  "zhimi.airp.meb1": "mapping_airp_meb1",
  "xiaomi.airp.cpa4": "mapping_cpa4",
  "zhimi.airp.cpa4": "mapping_cpa4",
  "zhimi.airpurifier.*": "mapping_default",
};

const cpa4Models = ['xiaomi.airp.cpa4', 'zhimi.airp.cpa4'];

const properties = {
  "mapping_default": {
    "get_properties": [
      { did: "power", siid: 2, piid: 2 }, // onoff
      { did: "fanlevel", siid : 2, piid: 4 }, // airpurifier_zhimi_fanlevel
      { did: "mode", siid: 2, piid: 5 }, // airpurifier_zhimi_mode
      { did: "humidity", siid: 3, piid: 7 }, // measure_humidity
      { did: "temperature", siid: 3, piid: 8 }, // measure_temperature
      { did: "aqi", siid: 3, piid: 6 }, // measure_pm25
      { did: "buzzer", siid: 5, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 18, piid: 13 }, // settings.childLock
      { did: "light", siid: 6, piid: 1 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 3 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 5 }, // settings.filter_hours_used
      { did: "purify_volume", siid: 13, piid: 1 } // settings.purify_volume
    ],
    "set_properties": {
      "power": { siid: 2, piid: 2 },
      "fanlevel": { siid: 2, piid: 4 },
      "mode": { siid: 2, piid: 5 },
      "buzzer": { siid: 5, piid: 1 },
      "child_lock": { siid: 18, piid: 13 },
      "light": { siid: 6, piid: 1 }
    },
    "device_properties": {
      "light": { "min": 2, "max": 0 }
    }
  },
  "mapping_mb4": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "mode", siid: 2, piid: 4 }, // airpurifier_zhimi_mode
      { did: "aqi", siid: 3, piid: 4 }, // measure_pm25
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 8, piid: 1 }, // settings.childLock
      { did: "light", siid: 7, piid: 2 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 1 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 3 } // settings.filter_hours_used
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "mode": { siid: 2, piid: 4 },
      "buzzer": { siid: 6, piid: 1 },
      "child_lock": { siid: 8, piid: 1 },
      "light": { siid: 7, piid: 2 }
    },
    "device_properties": {
      "light": { "min": 0, "max": 8 }
    }
  },
  "mapping_va2": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "fanlevel", siid : 2, piid: 5 }, // airpurifier_zhimi_fanlevel
      { did: "mode", siid: 2, piid: 4 }, // airpurifier_zhimi_mode
      { did: "humidity", siid: 3, piid: 1 }, // measure_humidity
      { did: "temperature", siid: 3, piid: 7 }, // measure_temperature
      { did: "aqi", siid: 3, piid: 4 }, // measure_pm25
      { did: "anion", siid: 2, piid: 6 }, // onoff.ion
      { did: "uv", siid: 2, piid: 7 }, // onoff.uv
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 8, piid: 1 }, // settings.childLock
      { did: "light", siid: 13, piid: 2 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 1 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 3 }, // settings.filter_hours_used
      { did: "purify_volume", siid: 11, piid: 1 } // settings.purify_volume
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "ion": { siid: 2, piid: 6 },
      "uv": { siid: 2, piid: 7 },
      "fanlevel": { siid: 2, piid: 5 },
      "mode": {siid: 2, piid: 4 },
      "buzzer": { siid: 5, piid: 1 },
      "child_lock": { siid: 8, piid: 1 },
      "light": { siid: 13, piid: 2 }
    },
    "device_properties": {
      "light": { "min": 0, "max": 2 }
    }
  },
  "mapping_vb4": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "fanlevel", siid : 2, piid: 5 }, // airpurifier_zhimi_fanlevel
      { did: "mode", siid: 2, piid: 4 }, // airpurifier_zhimi_mode
      { did: "humidity", siid: 3, piid: 1 }, // measure_humidity
      { did: "temperature", siid: 3, piid: 7 }, // measure_temperature
      { did: "aqi", siid: 3, piid: 4 }, // measure_pm25
      { did: "anion", siid: 2, piid: 6 }, // onoff.ion
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 8, piid: 1 }, // settings.childLock
      { did: "light", siid: 13, piid: 2 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 1 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 3 }, // settings.filter_hours_used
      { did: "purify_volume", siid: 11, piid: 1 } // settings.purify_volume
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "ion": { siid: 2, piid: 6 },
      "fanlevel": { siid: 2, piid: 5 },
      "mode": {siid: 2, piid: 4 },
      "buzzer": { siid: 6, piid: 1 },
      "child_lock": { siid: 8, piid: 1 },
      "light": { siid: 13, piid: 2 }
    },
    "device_properties": {
      "light": { "min": 0, "max": 2 }
    }
  },
  "mapping_rma1": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "mode", siid: 2, piid: 4 }, // airpurifier_zhimi_mode
      { did: "humidity", siid: 3, piid: 1 }, // measure_humidity
      { did: "temperature", siid: 3, piid: 7 }, // measure_temperature
      { did: "aqi", siid: 3, piid: 4 }, // measure_pm25
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 8, piid: 1 }, // settings.childLock
      { did: "light", siid: 13, piid: 2 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 1 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 3 } // settings.filter_hours_used
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "mode": {siid: 2, piid: 4 },
      "buzzer": { siid: 6, piid: 1 },
      "child_lock": { siid: 8, piid: 1 },
      "light": { siid: 13, piid: 2 }
    },
    "device_properties": {
      "light": { "min": 0, "max": 2 }
    }
  },
  "mapping_rmb1": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "mode", siid: 2, piid: 4 }, // airpurifier_zhimi_mode
      { did: "humidity", siid: 3, piid: 1 }, // measure_humidity
      { did: "temperature", siid: 3, piid: 7 }, // measure_temperature
      { did: "aqi", siid: 3, piid: 4 }, // measure_pm25
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 8, piid: 1 }, // settings.childLock
      { did: "light", siid: 13, piid: 2 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 1 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 3 } // settings.filter_hours_used
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "mode": {siid: 2, piid: 4 },
      "buzzer": { siid: 6, piid: 1 },
      "child_lock": { siid: 8, piid: 1 },
      "light": { siid: 13, piid: 2 }
    },
    "device_properties": {
      "light": { "min": 0, "max": 2 }
    }
  },
  "mapping_za1": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "mode", siid: 2, piid: 5 }, // airpurifier_zhimi_mode
      { did: "humidity", siid: 3, piid: 7 }, // measure_humidity
      { did: "temperature", siid: 3, piid: 8 }, // measure_temperature
      { did: "aqi", siid: 3, piid: 6 }, // measure_pm25
      { did: "buzzer", siid: 5, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 7, piid: 1 }, // settings.childLock
      { did: "light", siid: 6, piid: 1 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 3 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 5 }, // settings.filter_hours_used
      { did: "purify_volume", siid: 13, piid: 1 } // settings.purify_volume
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "mode": {siid: 2, piid: 5 },
      "buzzer": { siid: 5, piid: 1 },
      "child_lock": { siid: 7, piid: 1 },
      "light": { siid: 6, piid: 1 }
    },
    "device_properties": {
      "light": { "min": 2, "max": 0 }
    }
  },
  "mapping_airp_meb1": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "mode", siid: 2, piid: 4 }, // airpurifier_zhimi_mode
      { did: "fanlevel", siid : 2, piid: 5 }, // airpurifier_zhimi_fanlevel
      { did: "humidity", siid: 3, piid: 1 }, // measure_humidity
      { did: "aqi", siid: 3, piid: 4 }, // measure_pm25
      { did: "temperature", siid: 3, piid: 7 }, // measure_temperature
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 8, piid: 1 }, // settings.childLock
      { did: "light", siid: 13, piid: 2 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 1 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 3 } // settings.filter_hours_used
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "fanlevel": { siid: 2, piid: 5 },
      "mode": { siid: 2, piid: 4 },
      "buzzer": { siid: 6, piid: 1 },
      "child_lock": { siid: 8, piid: 1 },
      "light": { siid: 13, piid: 2 }
    },
    "device_properties": {
      "light": { "min": 0, "max": 2 }
    }
  },
  "mapping_za3": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "mode", siid: 2, piid: 4 }, // airpurifier_zhimi_mode
      { did: "humidity", siid: 3, piid: 1 }, // measure_humidity
      { did: "aqi", siid: 3, piid: 4 }, // measure_pm25
      { did: "temperature", siid: 3, piid: 7 }, // measure_temperature
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "light", siid: 7, piid: 2 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 1 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 3 } // settings.filter_hours_used
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "mode": { siid: 2, piid: 4 },
      "buzzer": { siid: 6, piid: 1 },
      "light": { siid: 7, piid: 2 }
    },
    "device_properties": {
      "light": { "min": 0, "max": 2 }
    }
  },
  "mapping_cpa4": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "mode", siid: 2, piid: 4 }, // airpurifier_zhimi_mode
      { did: "aqi", siid: 3, piid: 4 }, // measure_pm25
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 8, piid: 1 }, // settings.childLock
      { did: "light", siid: 13, piid: 2 }, // settings.led
      { did: "filter_life_remaining", siid: 4, piid: 1 }, // settings.filter_life_remaining
      { did: "filter_hours_used", siid: 4, piid: 3 }, // settings.filter_hours_used
      { did: "fanlevel", siid: 9, piid: 11 }, // airpurifier_xiaomi_fanlevel
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "mode": { siid: 2, piid: 4 },
      "buzzer": { siid: 6, piid: 1 },
      "child_lock": { siid: 8, piid: 1 },
      "light": { siid: 13, piid: 2 },
      "fanlevel": { siid: 9, piid: 11 }
    },
    "device_properties": {
      "light": { "min": 0, "max": 2 }
    }
  },
}

const modes = {
  0: "Auto",
  1: "Night",
  2: "Favorite",
  3: "Idle"
};

class AdvancedMiAirPurifierMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // ADD DEVICES DEPENDANT CAPABILITIES
      if (cpa4Models.includes(this.getStoreValue('model')) && this.hasCapability('airpurifier_zhimi_fanlevel')) {
        this.removeCapability('airpurifier_zhimi_fanlevel');
      }
      if (cpa4Models.includes(this.getStoreValue('model')) && !this.hasCapability('airpurifier_xiaomi_fanlevel')) {
        this.addCapability('airpurifier_xiaomi_fanlevel');
      }

      // DEVICE VARIABLES
      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['zhimi.airpurifier.*']];

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async (value) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.power.siid, piid: this.deviceProperties.set_properties.power.piid, value: value }], { retries: 1 });
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

      this.registerCapabilityListener('onoff.ion', async (value) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.ion.siid, piid: this.deviceProperties.set_properties.ion.piid, value: value }], { retries: 1 });
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

      this.registerCapabilityListener('onoff.uv', async (value) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.uv.siid, piid: this.deviceProperties.set_properties.uv.piid, value: value }], { retries: 1 });
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

      this.registerCapabilityListener('airpurifier_zhimi_fanlevel', async (value) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.fanlevel.siid, piid: this.deviceProperties.set_properties.fanlevel.piid, value: +value }], { retries: 1 });
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

      this.registerCapabilityListener('airpurifier_xiaomi_fanlevel', async (value) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.fanlevel.siid, piid: this.deviceProperties.set_properties.fanlevel.piid, value: +value }], { retries: 1 });
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

      this.registerCapabilityListener('airpurifier_zhimi_mode', async (value) => {
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
      const led = await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.light.siid, piid: this.deviceProperties.set_properties.light.piid, value: newSettings.led ? this.deviceProperties.device_properties.light.max : this.deviceProperties.device_properties.light.min }], { retries: 1 });
    }

    if (changedKeys.includes("buzzer")) {
      const buzzer = await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.buzzer.siid, piid: this.deviceProperties.set_properties.buzzer.piid, value: newSettings.buzzer }], { retries: 1 });
    }

    if (changedKeys.includes("childLock") && this.deviceProperties.set_properties.child_lock !== undefined) {
      const childlock = await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.child_lock.siid, piid: this.deviceProperties.set_properties.child_lock.piid, value: newSettings.childLock }], { retries: 1 });
    }

    return Promise.resolve(true);
  }

  async retrieveDeviceData() {
    try {

      const result = await this.miio.call("get_properties", this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      /* data */
      const onoff = result.find(obj => obj.did === 'power');
      const fanlevel = result.find(obj => obj.did === 'fanlevel');
      const measure_humidity = result.find(obj => obj.did === 'humidity');
      const measure_temperature = result.find(obj => obj.did === 'temperature');
      const measure_pm25 = result.find(obj => obj.did === 'aqi');
      const onoff_ion = result.find(obj => obj.did === 'anion');
      const onoff_uv = result.find(obj => obj.did === 'uv');

      const buzzer = result.find(obj => obj.did === 'buzzer');
      const child_lock = result.find(obj => obj.did === 'child_lock');
      const led = result.find(obj => obj.did === 'light');
      const filter_life_remaining = result.find(obj => obj.did === 'filter_life_remaining');
      const filter_hours_used = result.find(obj => obj.did === 'filter_hours_used');
      const purify_volume = result.find(obj => obj.did === 'purify_volume');

      /* capabilities */
      await this.updateCapabilityValue("onoff", onoff.value);
      if (measure_humidity !== undefined) {
        await this.updateCapabilityValue("measure_humidity", measure_humidity.value);
      }
      if (measure_temperature !== undefined) {
        await this.updateCapabilityValue("measure_temperature", measure_temperature.value);
      }
      await this.updateCapabilityValue("measure_pm25", measure_pm25.value);

      if (onoff_ion !== undefined) {
        await this.updateCapabilityValue("onoff.ion", onoff_ion.value);
      }

      if (onoff_uv !== undefined) {
        await this.updateCapabilityValue("onoff.uv", onoff_uv.value);
      }

      /* settings */
      await this.updateSettingValue("led", led.value === this.deviceProperties.device_properties.light.min ? false : true);
      await this.updateSettingValue("buzzer", buzzer.value);
      if (child_lock !== undefined) {
        await this.updateSettingValue("childLock", child_lock.value);
      }
      await this.updateSettingValue("filter_life_remaining", filter_life_remaining.value + '%');
      await this.updateSettingValue("filter_hours_used", filter_hours_used.value + 'h');
      if (purify_volume !== undefined) {
        await this.updateSettingValue("purify_volume", purify_volume.value + 'm3');
      }

      /* mode capability */
      const mode = result.find(obj => obj.did === 'mode');
      if (this.getCapabilityValue('airpurifier_zhimi_mode') !== mode.value.toString()) {
        const previous_mode = this.getCapabilityValue('airpurifier_zhimi_mode');
        await this.setCapabilityValue('airpurifier_zhimi_mode', mode.value.toString());
        await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, {"new_mode": modes[mode.value], "previous_mode": modes[+previous_mode] }).catch(error => { this.error(error) });
      }

      /* device specific settings */
      if (cpa4Models.includes(this.getStoreValue('model')) && fanlevel !== undefined) {
        await this.updateCapabilityValue("airpurifier_xiaomi_fanlevel", Number(fanlevel.value));
      } else if (fanlevel !== undefined) {
        await this.updateCapabilityValue("airpurifier_zhimi_fanlevel", fanlevel.value.toString());
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

module.exports = AdvancedMiAirPurifierMiotDevice;
