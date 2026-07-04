'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/yeelink.light.lamp22 // Xiaomi Monitor Light Bar S1 (MJGJD02YL)

const COLOR_TEMPERATURE_MIN = 2700;
const COLOR_TEMPERATURE_MAX = 6500;
const MODE_CAPABILITY = 'yeelight_lamp22_mode';
const LEGACY_LIGHT_MODE_CAPABILITY = 'yeelight_lamp22_light_mode';
const SCENE_MODE_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const SCENE_MODE_OPTIONS = [
  { id: '0', title: 'No mode/scene selected (Free mode)' },
  { id: '1', title: 'My mode 1' },
  { id: '2', title: 'My mode 2' },
  { id: '3', title: 'My mode 3' },
  { id: '4', title: 'My mode 4' },
  { id: '5', title: 'Reading' },
  { id: '6', title: 'Office (Working)' },
  { id: '7', title: 'Leisure (Movie)' },
  { id: '8', title: 'Warm' },
  { id: '9', title: 'Computer (Anti blue-light)' },
  { id: '10', title: 'Blinking (Flow)' }
];

const mapping = {
  'yeelink.light.lamp22': 'mapping_default',
  'yeelink.light.*': 'mapping_default'
};

const properties = {
  mapping_default: {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 },
      { did: 'brightness', siid: 2, piid: 2 },
      { did: 'color_temperature', siid: 2, piid: 3 },
      { did: 'scene_mode', siid: 3, piid: 9 }
    ],
    set_properties: {
      power: { siid: 2, piid: 1 },
      brightness: { siid: 2, piid: 2 },
      color_temperature: { siid: 2, piid: 3 },
      scene_mode: { siid: 3, piid: 9 }
    }
  }
};

class XiaomiMonitorLightBarS1Device extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.bootSequence();

      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined
        ? properties[mapping[this.getStoreValue('model')]]
        : properties[mapping['yeelink.light.*']];

      await this.removeLegacyCapability(LEGACY_LIGHT_MODE_CAPABILITY);
      await this.ensureCapability(MODE_CAPABILITY);
      await this.applyModeCapabilityOptions();

      this.registerCapabilityListener('onoff', (value) => this.setMiotProperty('power', value));
      this.registerCapabilityListener(MODE_CAPABILITY, (value) => this.setMiotProperty('scene_mode', Number(value)));

      this.registerMultipleCapabilityListener(
        ['dim', 'light_temperature'],
        this.onLightCapabilities.bind(this),
        500
      );

    } catch (error) {
      this.error(error);
    }
  }

  async ensureCapability(capability) {
    if (!this.hasCapability(capability)) {
      await this.addCapability(capability);
    }
  }

  async removeLegacyCapability(capability) {
    if (this.hasCapability(capability)) {
      await this.removeCapability(capability);
    }
  }

  async applyModeCapabilityOptions() {
    await this.setCapabilityOptions(MODE_CAPABILITY, {
      values: SCENE_MODE_OPTIONS
    });
  }

  async setMiotProperty(property, value) {
    try {
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => { this.error(error); });
        this.createDevice();
        return Promise.reject('Device unreachable, please try again ...');
      }

      const definition = this.deviceProperties.set_properties[property];
      const payload = [{ siid: definition.siid, piid: definition.piid, value }];
      const result = await this.miio.call('set_properties', payload, { retries: 1 });
      this.log(`Yeelight lamp22 set ${property}: ${JSON.stringify(payload)} -> ${JSON.stringify(result)}`);
      const failed = Array.isArray(result) ? result.find((item) => item && item.code !== 0) : null;
      if (failed) {
        throw new Error(`MIOT set_properties failed with code ${failed.code}`);
      }
      return result;
    } catch (error) {
      this.error(`Yeelight lamp22 failed to set ${property} to ${JSON.stringify(value)}`);
      this.error(error);
      return Promise.reject(error);
    }
  }

  async onLightCapabilities(valueObj) {
    if (typeof valueObj.dim !== 'undefined') {
      const brightness = Math.round(this.util.clamp(valueObj.dim * 100, 1, 100));
      await this.setMiotProperty('brightness', brightness);
    }

    if (typeof valueObj.light_temperature !== 'undefined') {
      await this.setMiotProperty('color_temperature', this.toMiotColorTemperature(valueObj.light_temperature));
    }
  }

  toHomeyColorTemperature(value) {
    const normalized = (COLOR_TEMPERATURE_MAX - value) / (COLOR_TEMPERATURE_MAX - COLOR_TEMPERATURE_MIN);
    return this.util.clamp(Number(normalized.toFixed(2)), 0, 1);
  }

  toMiotColorTemperature(value) {
    const colorTemperature = COLOR_TEMPERATURE_MAX - (this.util.clamp(value, 0, 1) * (COLOR_TEMPERATURE_MAX - COLOR_TEMPERATURE_MIN));
    return Math.round(this.util.clamp(colorTemperature, COLOR_TEMPERATURE_MIN, COLOR_TEMPERATURE_MAX));
  }

  normalizePollValue(property) {
    if (!property || property.code !== 0 || property.value === undefined || property.value === null) {
      this.log(`Yeelight lamp22 invalid MIOT property response: ${JSON.stringify(property)}`);
      return undefined;
    }

    return property.value;
  }

  async updateCapabilityValue(capability, value) {
    if (this.hasCapability(capability) && this.getCapabilityValue(capability) !== value) {
      const previousValue = this.getCapabilityValue(capability);
      await this.setCapabilityValue(capability, value);
      if (capability === MODE_CAPABILITY) {
        await this.triggerModeChanged(value, previousValue);
      }
    }
  }

  getModeTitle(value) {
    const option = SCENE_MODE_OPTIONS.find((item) => item.id === String(value));
    return option ? option.title : String(value);
  }

  async triggerModeChanged(value, previousValue) {
    try {
      await this.homey.flow.getDeviceTriggerCard('yeelightLamp22ModeChanged').trigger(
        this,
        {
          mode: this.getModeTitle(value),
          previous_mode: this.getModeTitle(previousValue)
        },
        {
          mode: String(value),
          previous_mode: String(previousValue)
        }
      );
    } catch (error) {
      this.error(error);
    }
  }

  async retrieveDeviceData() {
    try {
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => { this.error(error); });
        this.createDevice();
        return;
      }

      const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      const property = (did) => {
        const found = result.find((obj) => obj.did === did);
        if (!found) {
          this.log(`Yeelight lamp22 missing MIOT property ${did}; received: ${JSON.stringify(result)}`);
        }
        return found;
      };

      const onoff = property('power');
      const brightness = property('brightness');
      const colorTemperature = property('color_temperature');
      const sceneMode = property('scene_mode');

      const powerValue = this.normalizePollValue(onoff);
      const brightnessValue = this.normalizePollValue(brightness);
      const colorTemperatureValue = this.normalizePollValue(colorTemperature);
      const sceneModeValue = this.normalizePollValue(sceneMode);

      if (powerValue !== undefined) await this.updateCapabilityValue('onoff', powerValue);
      if (brightnessValue !== undefined) await this.updateCapabilityValue('dim', this.util.clamp(brightnessValue / 100, 0.01, 1));
      if (colorTemperatureValue !== undefined) await this.updateCapabilityValue('light_temperature', this.toHomeyColorTemperature(colorTemperatureValue));
      if (sceneModeValue !== undefined && SCENE_MODE_VALUES.includes(String(sceneModeValue))) {
        await this.updateCapabilityValue(MODE_CAPABILITY, String(sceneModeValue));
      }

    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((error) => { this.error(error); });
      }

      this.homey.setTimeout(() => { this.createDevice(); }, 60000);

      this.error(error.message);
    }
  }

}

module.exports = XiaomiMonitorLightBarS1Device;
