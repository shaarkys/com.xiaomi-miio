'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/zhimi.airpurifier.v1 // Air Purifier
// https://home.miot-spec.com/spec/zhimi.airpurifier.v2 // Air Purifier v2
// https://home.miot-spec.com/spec/zhimi.airpurifier.v3 // Air Purifier v3
// https://home.miot-spec.com/spec/zhimi.airpurifier.v5 // Air Purifier v5
// https://home.miot-spec.com/spec/zhimi.airpurifier.v6 // Air Purifier Pro
// https://home.miot-spec.com/spec/zhimi.airpurifier.v7 // Air Purifier Pro v7
// https://home.miot-spec.com/spec/zhimi.airpurifier.m1 // Air Purifier 2 Mini
// https://home.miot-spec.com/spec/zhimi.airpurifier.m2 // Air Purifier Mini
// https://home.miot-spec.com/spec/zhimi.airpurifier.ma1 // Air Purifier 2S
// https://home.miot-spec.com/spec/zhimi.airpurifier.ma2 // Air Purifier 2S
// https://home.miot-spec.com/spec/zhimi.airpurifier.sa1 // Air Purifier Super/Max
// https://home.miot-spec.com/spec/zhimi.airpurifier.sa2 // Air Purifier Super/Max 2
// https://home.miot-spec.com/spec/zhimi.airpurifier.mc1 // Air Purifier 2S
// https://home.miot-spec.com/spec/zhimi.airpurifier.mc2 // Air Purifier 2H

const MIOT_MODE_TO_CAPABILITY = {
  0: 'auto',
  1: 'silent',
  2: 'favorite',
  3: 'idle',
};

const CAPABILITY_MODE_TO_MIOT = {
  auto: 0,
  silent: 1,
  favorite: 2,
  idle: 3,
};

const V7_SUPPORTED_MODES = new Set(['auto', 'silent', 'favorite']);
const V7_MODE_OPTIONS = [
  { id: 'auto', title: 'Auto' },
  { id: 'silent', title: 'Night' },
  { id: 'favorite', title: 'Favorite' },
];
const V7_FAVORITE_LEVEL_MAX = 16;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeV7FavoriteLevel = (value) => clamp(Number(value) || 0, 0, V7_FAVORITE_LEVEL_MAX) / V7_FAVORITE_LEVEL_MAX;
const denormalizeV7FavoriteLevel = (value) => Math.round(clamp(Number(value) || 0, 0, 1) * V7_FAVORITE_LEVEL_MAX);

const MIOT_PROPERTIES = {
  'zhimi.airp.meb1': {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 },
      { did: 'mode', siid: 2, piid: 4 },
      { did: 'fanlevel', siid: 2, piid: 5 },
      { did: 'humidity', siid: 3, piid: 1 },
      { did: 'aqi', siid: 3, piid: 4 },
      { did: 'temperature', siid: 3, piid: 7 },
      { did: 'buzzer', siid: 6, piid: 1 },
      { did: 'child_lock', siid: 8, piid: 1 },
      { did: 'light', siid: 13, piid: 2 },
      { did: 'filter_life_remaining', siid: 4, piid: 1 },
      { did: 'filter_hours_used', siid: 4, piid: 3 },
    ],
    set_properties: {
      power: { siid: 2, piid: 1 },
      mode: { siid: 2, piid: 4 },
      fanlevel: { siid: 2, piid: 5 },
      buzzer: { siid: 6, piid: 1 },
      child_lock: { siid: 8, piid: 1 },
      light: { siid: 13, piid: 2 },
    },
    device_properties: {
      light: { min: 0, max: 2 },
    },
  },
};

class AdvancedOlderMiAirPurifierDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.model = this.getStoreValue('model');
      this.isV7 = this.model === 'zhimi.airpurifier.v7';
      this.isMiot = Object.prototype.hasOwnProperty.call(MIOT_PROPERTIES, this.model);
      if (this.isMiot) {
        this.deviceProperties = MIOT_PROPERTIES[this.model];
      }

      if (this.isV7) {
        await this.setCapabilityOptions('airpurifier_mode', {
          values: V7_MODE_OPTIONS,
        });
        await this.setCapabilityOptions('fan_speed', {
          min: 0,
          max: 1,
          step: 1 / V7_FAVORITE_LEVEL_MAX,
        });
      }
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async (value) => {
        try {
          if (!this.miio) {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error); });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }

          if (this.isMiot) {
            return await this.miio.call('set_properties', [{
              siid: this.deviceProperties.set_properties.power.siid,
              piid: this.deviceProperties.set_properties.power.piid,
              value: Boolean(value),
            }], { retries: 1 });
          }

          return await this.onCapabilityOnoff(value);
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      this.registerCapabilityListener('fan_speed', async (value) => {
        try {
          if (!this.miio) {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error); });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }

          if (this.isMiot) {
            const numericFanLevel = Number(value);
            if (Number.isNaN(numericFanLevel)) {
              return Promise.reject(new Error('Invalid fan speed value: ' + value));
            }

            return await this.miio.call('set_properties', [{
              siid: this.deviceProperties.set_properties.fanlevel.siid,
              piid: this.deviceProperties.set_properties.fanlevel.piid,
              value: numericFanLevel,
            }], { retries: 1 });
          }

          const numericFanLevel = Number(value);
          if (Number.isNaN(numericFanLevel)) {
            return Promise.reject(new Error('Invalid fan speed value: ' + value));
          }

          return await this.miio.setFavoriteLevel(this.isV7 ? denormalizeV7FavoriteLevel(numericFanLevel) : numericFanLevel);
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      this.registerCapabilityListener('airpurifier_mode', async (value) => {
        try {
          if (!this.miio) {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error); });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }

          const previousMode = this.getCapabilityValue('airpurifier_mode');
          let result;

          if (this.isMiot) {
            const miotValue = CAPABILITY_MODE_TO_MIOT[value];
            if (miotValue === undefined) {
              return Promise.reject(new Error('Unsupported mode for MIoT device: ' + value));
            }

            result = await this.miio.call('set_properties', [{
              siid: this.deviceProperties.set_properties.mode.siid,
              piid: this.deviceProperties.set_properties.mode.piid,
              value: miotValue,
            }], { retries: 1 });
          } else {
            if (this.isV7 && !V7_SUPPORTED_MODES.has(value)) {
              return Promise.reject(new Error('Unsupported mode for v7 device: ' + value));
            }
            result = await this.miio.call('set_mode', [value], { retries: 1 });
          }

          if (previousMode !== value) {
            await this.setCapabilityValue('airpurifier_mode', value);
            await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, { new_mode: value, previous_mode: previousMode }).catch(error => { this.error(error); });
          }

          return result;
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

    if (!this.miio) {
      return Promise.reject('Device unreachable, please try again ...');
    }

    if (this.isMiot) {
      if (changedKeys.includes('led')) {
        await this.miio.call('set_properties', [{
          siid: this.deviceProperties.set_properties.light.siid,
          piid: this.deviceProperties.set_properties.light.piid,
          value: newSettings.led ? this.deviceProperties.device_properties.light.max : this.deviceProperties.device_properties.light.min,
        }], { retries: 1 });
      }

      if (changedKeys.includes('buzzer')) {
        await this.miio.call('set_properties', [{
          siid: this.deviceProperties.set_properties.buzzer.siid,
          piid: this.deviceProperties.set_properties.buzzer.piid,
          value: Boolean(newSettings.buzzer),
        }], { retries: 1 });
      }

      if (changedKeys.includes('childLock')) {
        await this.miio.call('set_properties', [{
          siid: this.deviceProperties.set_properties.child_lock.siid,
          piid: this.deviceProperties.set_properties.child_lock.piid,
          value: Boolean(newSettings.childLock),
        }], { retries: 1 });
      }

      return Promise.resolve(true);
    }

    if (changedKeys.includes('led')) {
      await this.miio.call('set_led', [newSettings.led ? 'on' : 'off'], { retries: 1 });
    }

    if (changedKeys.includes('buzzer')) {
      await this.miio.call('set_buzzer', [newSettings.buzzer ? 'on' : 'off'], { retries: 1 });
    }

    if (changedKeys.includes('childLock')) {
      await this.miio.call('set_child_lock', [newSettings.childLock ? 'on' : 'off'], { retries: 1 });
    }

    return Promise.resolve(true);
  }

  async retrieveDeviceData() {
    try {
      if (this.isMiot) {
        await this.retrieveMiotData();
        return;
      }

      const result = await this.miio.call('get_prop', ['power', 'aqi', 'humidity', 'temp_dec', 'bright', 'mode', 'favorite_level', 'buzzer', 'led', 'child_lock', 'filter1_life', 'f1_hour_used'], { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      /* capabilities */
      await this.updateCapabilityValue('onoff', result[0] === 'on');
      await this.updateCapabilityValue('measure_pm25', result[1]);
      await this.updateCapabilityValue('measure_humidity', result[2]);
      await this.updateCapabilityValue('measure_temperature', result[3] / 10);
      await this.updateCapabilityValue('measure_luminance', result[4]);
      await this.updateCapabilityValue('fan_speed', this.isV7 ? normalizeV7FavoriteLevel(result[6]) : result[6]);

      /* settings */
      await this.updateSettingValue('buzzer', result[7] === 'on');
      await this.updateSettingValue('led', result[8] === 'on');
      await this.updateSettingValue('childLock', result[9] === 'on');
      await this.updateSettingValue('filter1_life', `${result[10]}%`);
      await this.updateSettingValue('f1_hour_used', `${result[11]}h`);

      /* mode capability */
      if (this.isV7 && !V7_SUPPORTED_MODES.has(result[5])) {
        return;
      }

      if (this.getCapabilityValue('airpurifier_mode') !== result[5]) {
        const previousMode = this.getCapabilityValue('airpurifier_mode');
        await this.setCapabilityValue('airpurifier_mode', result[5]);
        await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, { new_mode: result[5], previous_mode: previousMode }).catch(error => { this.error(error); });
      }

    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch(err => { this.error(err); });
      }

      this.homey.setTimeout(() => { this.createDevice(); }, 60000);

      this.error(error.message);
    }
  }

  async retrieveMiotData() {
    const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
    if (!this.getAvailable()) { await this.setAvailable(); }

    const findValue = (did) => {
      const property = result.find(obj => obj.did === did);
      return property !== undefined ? property.value : undefined;
    };

    const onoff = findValue('power');
    if (onoff !== undefined) {
      await this.updateCapabilityValue('onoff', Boolean(onoff));
    }

    const aqi = findValue('aqi');
    if (aqi !== undefined) {
      await this.updateCapabilityValue('measure_pm25', aqi);
    }

    const humidity = findValue('humidity');
    if (humidity !== undefined) {
      await this.updateCapabilityValue('measure_humidity', humidity);
    }

    const temperature = findValue('temperature');
    if (temperature !== undefined) {
      await this.updateCapabilityValue('measure_temperature', temperature);
    }

    const fanlevel = findValue('fanlevel');
    if (fanlevel !== undefined) {
      await this.updateCapabilityValue('fan_speed', Number(fanlevel));
    }

    const buzzer = findValue('buzzer');
    if (buzzer !== undefined) {
      await this.updateSettingValue('buzzer', Boolean(buzzer));
    }

    const childLock = findValue('child_lock');
    if (childLock !== undefined) {
      await this.updateSettingValue('childLock', Boolean(childLock));
    }

    const led = findValue('light');
    if (led !== undefined) {
      const ledOn = led !== this.deviceProperties.device_properties.light.min;
      await this.updateSettingValue('led', ledOn);
    }

    const filterLife = findValue('filter_life_remaining');
    if (filterLife !== undefined) {
      await this.updateSettingValue('filter1_life', `${filterLife}%`);
    }

    const filterHours = findValue('filter_hours_used');
    if (filterHours !== undefined) {
      await this.updateSettingValue('f1_hour_used', `${filterHours}h`);
    }

    const modeValue = findValue('mode');
    if (modeValue !== undefined && modeValue !== null) {
      const mode = MIOT_MODE_TO_CAPABILITY[modeValue] ?? modeValue.toString();
      if (this.getCapabilityValue('airpurifier_mode') !== mode) {
        const previousMode = this.getCapabilityValue('airpurifier_mode');
        await this.setCapabilityValue('airpurifier_mode', mode);
        await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, { new_mode: mode, previous_mode: previousMode }).catch(error => { this.error(error); });
      }
    }
  }

}

module.exports = AdvancedOlderMiAirPurifierDevice;






