'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/zhimi.heater.mc2
// https://home.miot-spec.com/spec/zhimi.heater.za2
// https://home.miot-spec.com/spec/leshow.heater.bs1s
// https://home.miot-spec.com/spec/zhimi.heater.nb1
// https://home.miot-spec.com/spec/zhimi.heater.zb1a

const mapping = {
  "zhimi.heater.mc2": "properties_mc2",
  "zhimi.heater.za2": "properties_za2",
	"leshow.heater.bs1s": "properties_bs1s",
	"zhimi.heater.nb1": "properties_nb1",
  "zhimi.heater.zb1a": "properties_zb1a",
  "zhimi.heater.*": "properties_mc2"
};

const properties = {
  "properties_mc2": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "target_temperature", siid: 2, piid: 5 }, // heater_zhimi_heater_target_temperature
      { did: "temperature", siid: 4, piid: 7 }, // measure_temperature
      { did: "light", siid: 7, piid: 3 }, // settings.led
      { did: "buzzer", siid: 6, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 5, piid: 1 } // settings.childLock
    ],
    "set_properties": {
      "onoff": { siid: 2, piid: 1 },
      "target_temperature": { siid: 2, piid: 5 },
      "light": {siid: 7, piid: 3 },
      "buzzer": {siid: 6, piid: 1 },
      "child_lock": {siid: 5, piid: 1 }
    }
  },
  "properties_za2": {
    "get_properties": [
      { did: "power", siid: 2, piid: 2 }, // onoff
      { did: "target_temperature", siid: 2, piid: 6 }, // heater_zhimi_heater_target_temperature
      { did: "temperature", siid: 5, piid: 8 }, // measure_temperature
      { did: "humidity", siid: 5, piid: 7 }, // measure_humidity
      { did: "light", siid: 6, piid: 1 }, // settings.led
      { did: "buzzer", siid: 3, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 7, piid: 1 } // settings.childLock
    ],
    "set_properties": {
      "onoff": { siid: 2, piid: 1 },
      "target_temperature": { siid: 2, piid: 6 },
      "light": {siid: 6, piid: 3 },
      "buzzer": {siid: 3, piid: 1 },
      "child_lock": {siid: 7, piid: 1 }
    }
  },
  "properties_bs1s": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "target_temperature", siid: 2, piid: 3 }, // heater_zhimi_heater_target_temperature
      { did: "temperature", siid: 4, piid: 7 }, // measure_temperature
      { did: "light", siid: 7, piid: 1 }, // settings.led
      { did: "buzzer", siid: 5, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 6, piid: 1 } // settings.childLock
    ],
    "set_properties": {
      "onoff": { siid: 2, piid: 1 },
      "target_temperature": { siid: 2, piid: 3 },
      "light": {siid: 7, piid: 7 },
      "buzzer": {siid: 5, piid: 1 },
      "child_lock": {siid: 6, piid: 1 }
    }
  },
  "properties_nb1": {
    "get_properties": [
      { did: "power", siid: 2, piid: 2 }, // onoff
      { did: "target_temperature", siid: 2, piid: 5 }, // heater_zhimi_heater_target_temperature
      { did: "temperature", siid: 9, piid: 7 }, // measure_temperature
      { did: "light", siid: 6, piid: 1 }, // settings.led
      { did: "buzzer", siid: 3, piid: 1 }, // settings.buzzer
      { did: "child_lock", siid: 7, piid: 1 }, // settings.childLock
      { did: "heater_zhimi_heatlevel", siid: 2, piid: 3 }, // heater_zhimi_heatlevel
      { did: "heater_zhimi_oscillation", siid: 2, piid: 4 } // heater_zhimi_oscillation
    ],
    "set_properties": {
      "onoff": { siid: 2, piid: 2 },
      "target_temperature": { siid: 2, piid: 5 },
      "light": {siid: 6, piid: 1 },
      "buzzer": {siid: 3, piid: 1 },
      "child_lock": {siid: 7, piid: 1 },
      "heater_zhimi_heatlevel": { siid: 2, piid: 3 },
      "heater_zhimi_oscillation": { siid: 2, piid: 4 }
    }
  },
  "properties_zb1a": {
    "get_properties": [
      { did: "power", siid: 2, piid: 2 }, // onoff
      { did: "target_temperature", siid: 2, piid: 6 }, // heater_zhimi_heater_target_temperature
      { did: "buzzer", siid: 3, piid: 1 }, // settings.buzzer
      { did: "temperature", siid: 5, piid: 8 }, // measure_temperature
      { did: "light", siid: 6, piid: 1 }, // settings.led
      { did: "child_lock", siid: 7, piid: 1 }, // settings.childLock
    ],
    "set_properties": {
      "onoff": { siid: 2, piid: 2 },
      "target_temperature": { siid: 2, piid: 6 },
      "buzzer": {siid: 3, piid: 1 },
      "light": {siid: 6, piid: 1 },
      "child_lock": {siid: 7, piid: 1 }
    }
  }
}

class ZhimiHeaterMiotDevice extends Device {

  isNb1() {
    return this.getStoreValue('model') === 'zhimi.heater.nb1';
  }

  async callHeater(method, params) {
    if (!this.isNb1()) return this.miio.call(method, params, { retries: 1 });
    const connection = this.miio;
    if (method === 'get_properties' && params.length > 1) {
      // openHAB's nb1 profile also limits reads to one property per request.
      const result = [];
      for (const property of params) {
        if (this._wifiStopped || this.miio !== connection) {
          throw new Error('Heater connection changed, please try again');
        }
        result.push(...await this.callHeater(method, [property]));
      }
      return result;
    }
    return this.queueHeaterCall(connection, () => this.callNb1(connection, method, params));
  }

  queueHeaterCall(connection, callback) {
    // Keep an older retried command from overtaking a newer power-off request.
    const request = (this._heaterCalls || Promise.resolve()).then(() => {
      if (this._wifiStopped || !connection || this.miio !== connection) {
        throw new Error('Heater connection changed, please try again');
      }
      return callback();
    });
    this._heaterCalls = request.catch(() => {});
    return request;
  }

  async callNb1(connection, method, params) {
    if (method === 'set_properties') {
      // A timed-out write may still have reached the heater, so invalidate reads too.
      this._heaterWriteRevision = (this._heaterWriteRevision || 0) + 1;
    }
    // miio counts retries as total attempts, and only retries transport timeouts.
    const result = await connection.call(method, params, { retries: 3 });

    if (!Array.isArray(result)) throw new Error('nb1 returned an invalid MIoT response');
    return params.map(property => {
      // Match the actual property address, not response order or an echoed did.
      const entry = result.find(item => item && item.siid === property.siid && item.piid === property.piid);
      if (!entry) throw new Error(`nb1 MIoT property ${property.siid}/${property.piid} missing from response`);
      if (entry.code !== 0) {
        const code = Number.isInteger(entry.code) ? entry.code : 'missing';
        throw new Error(`nb1 MIoT property ${property.siid}/${property.piid} failed (code ${code})`);
      }
      if (method === 'get_properties') {
        if (entry.value === undefined || entry.value === null) {
          throw new Error(`nb1 MIoT property ${property.siid}/${property.piid} has no value`);
        }
        if ((property.did === 'temperature' || property.did === 'target_temperature')
          && (typeof entry.value !== 'number' || !Number.isFinite(entry.value))) {
          throw new Error(`nb1 MIoT property ${property.siid}/${property.piid} has an invalid temperature`);
        }
      }
      return { ...entry, did: property.did };
    });
  }

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // ADD DEVICES DEPENDANT CAPABILITIES
      if (this.getStoreValue('model') === 'zhimi.heater.za2') {
        if (!this.hasCapability('measure_humidity')) {
          this.addCapability('measure_humidity');
        }
      }

      if (this.getStoreValue('model') === 'zhimi.heater.nb1') {
        if (!this.hasCapability('heater_zhimi_heatlevel')) {
          this.addCapability('heater_zhimi_heatlevel');
        }
        if (!this.hasCapability('heater_zhimi_oscillation')) {
          this.addCapability('heater_zhimi_oscillation');
        }
      }

      // DEVICE VARIABLES
      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['zhimi.heater.*']];

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async ( value ) => {
        try {
          if (this.miio) {
            return await this.callHeater("set_properties", [{ did: "onoff", siid: this.deviceProperties.set_properties.onoff.siid, piid: this.deviceProperties.set_properties.onoff.piid, value: value }]);
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

      this.registerCapabilityListener('heater_zhimi_heater_target_temperature', async ( value ) => {
        try {
          if (this.miio) {
            return await this.callHeater("set_properties", [{ did: "target_temperature", siid: this.deviceProperties.set_properties.target_temperature.siid, piid: this.deviceProperties.set_properties.target_temperature.piid, value: Number(value) }]);
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

      this.registerCapabilityListener('heater_zhimi_heatlevel', async ( value ) => {
        try {
          if (this.miio) {
            return await this.callHeater("set_properties", [{ did: "heater_zhimi_heatlevel", siid: this.deviceProperties.set_properties.heater_zhimi_heatlevel.siid, piid: this.deviceProperties.set_properties.heater_zhimi_heatlevel.piid, value: Number(value) }]);
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

      this.registerCapabilityListener('heater_zhimi_oscillation', async ( value ) => {
        try {
          if (this.miio) {
            return await this.callHeater("set_properties", [{ did: "heater_zhimi_oscillation", siid: this.deviceProperties.set_properties.heater_zhimi_oscillation.siid, piid: this.deviceProperties.set_properties.heater_zhimi_oscillation.piid, value: value ? 1 : 0 }]);
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
      const ledValue = this.isNb1() ? (newSettings.led ? 0 : 2) : (newSettings.led === 0 ? false : true);
      await this.callHeater("set_properties", [{ did: "light", siid: this.deviceProperties.set_properties.light.siid, piid: this.deviceProperties.set_properties.light.piid, value: ledValue }]);
    }

    if (changedKeys.includes("buzzer")) {
      await this.callHeater("set_properties", [{ did: "buzzer", siid: this.deviceProperties.set_properties.buzzer.siid, piid: this.deviceProperties.set_properties.buzzer.piid, value: newSettings.buzzer }]);
    }

    if (changedKeys.includes("childLock")) {
      await this.callHeater("set_properties", [{ did: "child_lock", siid: this.deviceProperties.set_properties.child_lock.siid, piid: this.deviceProperties.set_properties.child_lock.piid, value: newSettings.childLock }]);
    }

    return Promise.resolve(true);
  }

  async retrieveDeviceData() {
    if (this._wifiStopped || this.isRetrievingDeviceData) return;
    this.isRetrievingDeviceData = true;
    const connection = this.miio;
    const writeRevision = this._heaterWriteRevision || 0;
    try {
      const result = await this.callHeater("get_properties", this.deviceProperties.get_properties);
      const publish = async () => {
        if (this._wifiStopped || this.miio !== connection) return;
        if (this.isNb1() && (this._heaterWriteRevision || 0) !== writeRevision) return;
        if (!this.getAvailable()) { await this.setAvailable(); }

        /* data */
        const onoff = result.find(obj => obj.did === 'power');
        const target_temperature = result.find(obj => obj.did === 'target_temperature');
        const measure_temperature = result.find(obj => obj.did === 'temperature');
        if (this.isNb1() && this._temperatureLoggedConnection !== connection) {
          this.log(`nb1 temperatures: room (9/7) ${measure_temperature.value} C, target (2/5) ${target_temperature.value} C`);
          this._temperatureLoggedConnection = connection;
        }
      
        const led = result.find(obj => obj.did === 'light');
        const buzzer = result.find(obj => obj.did === 'buzzer');
        const child_lock = result.find(obj => obj.did === 'child_lock');

        /* capabilities */
        await this.updateCapabilityValue("onoff", onoff.value);
        await this.updateCapabilityValue("heater_zhimi_heater_target_temperature", target_temperature.value);
        await this.updateCapabilityValue("measure_temperature", measure_temperature.value);
      
        if (this.hasCapability('measure_humidity')) {
          const measure_humidity = result.find(obj => obj.did === 'humidity');
          await this.updateCapabilityValue("measure_humidity", measure_humidity.value);
        }

        if (this.hasCapability('heater_zhimi_heatlevel')) {
          const heater_zhimi_heatlevel = result.find(obj => obj.did === 'heater_zhimi_heatlevel');
          await this.updateCapabilityValue("heater_zhimi_heatlevel", heater_zhimi_heatlevel.value.toString());
        }

        if (this.hasCapability('heater_zhimi_oscillation')) {
          const heater_zhimi_oscillation = result.find(obj => obj.did === 'heater_zhimi_oscillation');
          await this.updateCapabilityValue("heater_zhimi_oscillation", heater_zhimi_oscillation.value === 0 ? false : true);
        }
      
        /* settings */
        await this.updateSettingValue("led", this.isNb1() ? led.value !== 2 : !!led.value);
        await this.updateSettingValue("buzzer", buzzer.value);
        await this.updateSettingValue("childLock", child_lock.value);
      };
      // Finish publication before a later command can change the heater again.
      if (this.isNb1()) await this.queueHeaterCall(connection, publish);
      else await publish();

    } catch (error) {
      if (this._wifiStopped || this.miio !== connection) return;
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch(error => { this.error(error) });
      }

      this.homey.clearTimeout(this.recreateTimeout);
      this.recreateTimeout = this.homey.setTimeout(() => { this.createDevice(); }, 60000);

      this.error(error.message);
    } finally {
      this.isRetrievingDeviceData = false;
    }
  }

}

module.exports = ZhimiHeaterMiotDevice;
