"use strict";

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/zhimi.fan.za5

const params = [
  { did: "power", siid: 2, piid: 1 }, // onoff
  { did: "fan_speed", siid: 2, piid: 2 }, // fan_speed
  { did: "swing_mode", siid: 2, piid: 3 }, // oscillating
  { did: "swing_mode_angle", siid: 2, piid: 5 }, // fan_zhimi_angle
  { did: "mode", siid: 2, piid: 7 }, // fan_zhimi_mode
  { did: "anion", siid: 2, piid: 11 }, // onoff.ion
  { did: "child_lock", siid: 3, piid: 1 }, // settings.childLock
  { did: "light", siid: 4, piid: 3 }, // settings.led
  { did: "buzzer", siid: 5, piid: 1 }, // settings.buzzer
  { did: "humidity", siid: 7, piid: 1 }, // measure_humidity
  { did: "temperature", siid: 7, piid: 7 }, // measure_temperature
  { did: "percentage_speed", siid: 6, piid: 8 }, // fan_zhimi_percentage_speed
];

const modes = {
  1: "Natural Wind",
  2: "Straight Wind"
};

class ZhiMiFanZA5Device extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      if (!this.hasCapability('fan_zhimi_percentage_speed')) {
        await this.addCapability('fan_zhimi_percentage_speed');
      }

      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 1, value: value }], { retries: 1 });
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

      this.registerCapabilityListener('oscillating', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 3, value: value }], { retries: 1 });
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

      this.registerCapabilityListener('onoff.ion', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 11, value: value }], { retries: 1 });
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

      this.registerCapabilityListener('fan_speed', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 2, value: value }], { retries: 1 });
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

      this.registerCapabilityListener('fan_zhimi_percentage_speed', async ( value ) => {
        try {
          if (this.miio) {
            const speed = this.util.clamp(Math.round(Number(value)), 1, 100);
            return await this.miio.call("set_properties", [{ siid: 6, piid: 8, value: speed }], { retries: 1 });
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

      this.registerCapabilityListener('fan_zhimi_angle', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 5, value: +value }], { retries: 1 });
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

      this.registerCapabilityListener('fan_zhimi_mode', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 7, value: +value }], { retries: 1 });
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
      const led = await this.miio.call("set_properties", [{ siid: 4, piid: 3, value: newSettings.led ? 100 : 0 }], { retries: 1 });
    }

    if (changedKeys.includes("buzzer")) {
      const buzzer = await this.miio.call("set_properties", [{ siid: 5, piid: 1, value: newSettings.buzzer }], { retries: 1 });
    }

    if (changedKeys.includes("childLock")) {
      const childlock = await this.miio.call("set_properties", [{ siid: 3, piid: 1, value: newSettings.childLock }], { retries: 1 });
    }

    return Promise.resolve(true);
  }

  async retrieveDeviceData() {
    try {
      const result = await this.miio.call("get_properties", params, { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      /* data */
      const onoff = result.find(obj => obj.did === 'power');
      const fan_speed = result.find(obj => obj.did === 'fan_speed');
      const oscillating = result.find(obj => obj.did === 'swing_mode');
      const onoff_ion = result.find(obj => obj.did === 'anion');
      const fan_zhimi_angle = result.find(obj => obj.did === 'swing_mode_angle');
      const percentage_speed = result.find(obj => obj.did === 'percentage_speed');
      const measure_humidity = result.find(obj => obj.did === 'humidity');
      const measure_temperature = result.find(obj => obj.did === 'temperature');

      const childLock = result.find(obj => obj.did === 'child_lock');
      const led = result.find(obj => obj.did === 'light');
      const buzzer = result.find(obj => obj.did === 'buzzer');
      
      /* capabilities */
      await this.updateCapabilityValue("onoff", onoff.value);
      await this.updateCapabilityValue("fan_speed", fan_speed.value);
      if (percentage_speed !== undefined && this.hasCapability('fan_zhimi_percentage_speed')) {
        await this.updateCapabilityValue("fan_zhimi_percentage_speed", percentage_speed.value);
      }
      await this.updateCapabilityValue("oscillating", oscillating.value);
      await this.updateCapabilityValue("onoff.ion", onoff_ion.value);
      await this.updateCapabilityValue("fan_zhimi_angle", fan_zhimi_angle.value.toString());
      await this.updateCapabilityValue("measure_humidity", measure_humidity.value);
      await this.updateCapabilityValue("measure_temperature", measure_temperature.value);

      /* settings */
      await this.updateSettingValue("childLock", childLock.value);
      await this.updateSettingValue("led", led.value);
      await this.updateSettingValue("buzzer", buzzer.value);

      /* mode capability */
      const mode = result.find(obj => obj.did === 'mode');
      if (this.getCapabilityValue('fan_zhimi_mode') !== mode.value.toString()) {
        const previous_mode = this.getCapabilityValue('fan_zhimi_mode');
        await this.setCapabilityValue('fan_zhimi_mode', mode.value.toString());
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

module.exports = ZhiMiFanZA5Device;
