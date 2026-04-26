'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const tinycolor = require('tinycolor2');

/* supported devices */
// https://home.miot-spec.com/spec/yeelink.light.ceil43 // Yeelight Arwen Ceiling Light D

const COLOR_TEMPERATURE_MIN = 2700;
const COLOR_TEMPERATURE_MAX = 6500;
const MIOT_MODE_DAY = 0;
const MIOT_MODE_NIGHT = 1;
const MIOT_MODE_COLOR = 2;
const MIOT_MODE_FLOW = 3;

const mapping = {
  'yeelink.light.ceil43': 'mapping_default',
  'yeelink.light.*': 'mapping_default'
};

const properties = {
  mapping_default: {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 },
      { did: 'mode', siid: 2, piid: 2 },
      { did: 'brightness', siid: 2, piid: 3 },
      { did: 'color', siid: 2, piid: 4 },
      { did: 'color_temperature', siid: 2, piid: 5 },
      { did: 'ambient_power', siid: 3, piid: 1 },
      { did: 'ambient_brightness', siid: 3, piid: 3 },
      { did: 'ambient_color_temperature', siid: 3, piid: 4 },
      { did: 'ambient_color', siid: 3, piid: 5 }
    ],
    set_properties: {
      power: { siid: 2, piid: 1 },
      mode: { siid: 2, piid: 2 },
      brightness: { siid: 2, piid: 3 },
      color: { siid: 2, piid: 4 },
      color_temperature: { siid: 2, piid: 5 },
      ambient_power: { siid: 3, piid: 1 },
      ambient_brightness: { siid: 3, piid: 3 },
      ambient_color_temperature: { siid: 3, piid: 4 },
      ambient_color: { siid: 3, piid: 5 }
    }
  }
};

class YeelightArwenCeilingLightDDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.bootSequence();

      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined
        ? properties[mapping[this.getStoreValue('model')]]
        : properties[mapping['yeelink.light.*']];

      await this.ensureCapability('light_mode');
      await this.ensureCapability('light_mode.ambient');
      await this.ensureCapability('yeelight_ceil43_mode');

      this.registerCapabilityListener('onoff', (value) => this.setMiotProperty('power', value));

      this.registerCapabilityListener('onoff.ambient', (value) => this.setMiotProperty('ambient_power', value));

      this.registerMultipleCapabilityListener(
        ['dim', 'light_temperature', 'light_hue', 'light_saturation', 'light_mode', 'yeelight_ceil43_mode'],
        this.onMainLightCapabilities.bind(this),
        500
      );

      this.registerMultipleCapabilityListener(
        ['dim.ambient', 'light_temperature.ambient', 'light_hue.ambient', 'light_saturation.ambient', 'light_mode.ambient'],
        this.onAmbientLightCapabilities.bind(this),
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
      this.log(`Yeelight ceil43 set ${property}: ${JSON.stringify(payload)} -> ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.error(`Yeelight ceil43 failed to set ${property} to ${JSON.stringify(value)}`);
      this.error(error);
      return Promise.reject(error);
    }
  }

  async onMainLightCapabilities(valueObj) {
    if (typeof valueObj.dim !== 'undefined') {
      const brightness = Math.round(this.util.clamp(valueObj.dim * 100, 1, 100));
      await this.setMiotProperty('brightness', brightness);
    }

    if (typeof valueObj.yeelight_ceil43_mode !== 'undefined') {
      await this.setMiotProperty('mode', Number(valueObj.yeelight_ceil43_mode));
      await this.updateCapabilityValue('light_mode', this.toHomeyLightMode(valueObj.yeelight_ceil43_mode));
    } else if (valueObj.light_mode === 'color' || typeof valueObj.light_hue !== 'undefined' || typeof valueObj.light_saturation !== 'undefined') {
      await this.setMiotProperty('mode', MIOT_MODE_COLOR);
      await this.updateCapabilityValue('light_mode', 'color');
      await this.updateCapabilityValue('yeelight_ceil43_mode', String(MIOT_MODE_COLOR));
    } else if (valueObj.light_mode === 'temperature' || typeof valueObj.light_temperature !== 'undefined') {
      await this.setMiotProperty('mode', MIOT_MODE_DAY);
      await this.updateCapabilityValue('light_mode', 'temperature');
      await this.updateCapabilityValue('yeelight_ceil43_mode', String(MIOT_MODE_DAY));
    }

    if (typeof valueObj.light_temperature !== 'undefined') {
      await this.setMiotProperty('color_temperature', this.toMiotColorTemperature(valueObj.light_temperature));
    }

    if (typeof valueObj.light_hue !== 'undefined' || typeof valueObj.light_saturation !== 'undefined') {
      const color = this.getRgbIntFromCapabilities(valueObj, 'light_hue', 'light_saturation');
      await this.setMiotProperty('color', color);
    }
  }

  async onAmbientLightCapabilities(valueObj) {
    if (typeof valueObj['dim.ambient'] !== 'undefined') {
      const brightness = Math.round(this.util.clamp(valueObj['dim.ambient'] * 100, 1, 100));
      await this.setMiotProperty('ambient_brightness', brightness);
    }

    if (valueObj['light_mode.ambient'] === 'color' || typeof valueObj['light_hue.ambient'] !== 'undefined' || typeof valueObj['light_saturation.ambient'] !== 'undefined') {
      await this.updateCapabilityValue('light_mode.ambient', 'color');
    } else if (valueObj['light_mode.ambient'] === 'temperature' || typeof valueObj['light_temperature.ambient'] !== 'undefined') {
      await this.updateCapabilityValue('light_mode.ambient', 'temperature');
    }

    if (typeof valueObj['light_temperature.ambient'] !== 'undefined') {
      await this.setMiotProperty('ambient_color_temperature', this.toMiotColorTemperature(valueObj['light_temperature.ambient']));
    }

    if (typeof valueObj['light_hue.ambient'] !== 'undefined' || typeof valueObj['light_saturation.ambient'] !== 'undefined') {
      const color = this.getRgbIntFromCapabilities(valueObj, 'light_hue.ambient', 'light_saturation.ambient');
      await this.setMiotProperty('ambient_color', color);
    }
  }

  getRgbIntFromCapabilities(valueObj, hueCapability, saturationCapability) {
    const hue = typeof valueObj[hueCapability] !== 'undefined'
      ? valueObj[hueCapability]
      : this.getCapabilityValue(hueCapability);
    const saturation = typeof valueObj[saturationCapability] !== 'undefined'
      ? valueObj[saturationCapability]
      : this.getCapabilityValue(saturationCapability);
    const color = tinycolor({ h: this.toCapabilityValue(hue, 0) * 360, s: this.toCapabilityValue(saturation, 1), v: 1 });

    return parseInt(color.toHex(), 16);
  }

  toCapabilityValue(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }

  toHomeyLightMode(mode) {
    return Number(mode) === MIOT_MODE_COLOR || Number(mode) === MIOT_MODE_FLOW ? 'color' : 'temperature';
  }

  toHomeyColorTemperature(value) {
    const normalized = (COLOR_TEMPERATURE_MAX - value) / (COLOR_TEMPERATURE_MAX - COLOR_TEMPERATURE_MIN);
    return this.util.clamp(Number(normalized.toFixed(2)), 0, 1);
  }

  toMiotColorTemperature(value) {
    const colorTemperature = COLOR_TEMPERATURE_MAX - (this.util.clamp(value, 0, 1) * (COLOR_TEMPERATURE_MAX - COLOR_TEMPERATURE_MIN));
    return Math.round(this.util.clamp(colorTemperature, COLOR_TEMPERATURE_MIN, COLOR_TEMPERATURE_MAX));
  }

  async updateColorCapabilities(colorValue, hueCapability, saturationCapability) {
    if (colorValue === undefined || colorValue === null) return;

    const hexValue = Number(colorValue).toString(16).padStart(6, '0');
    const color = tinycolor(`#${hexValue}`);
    const hsv = color.toHsv();

    await this.updateCapabilityValue(hueCapability, this.util.clamp(Number((hsv.h / 360).toFixed(4)), 0, 1));
    await this.updateCapabilityValue(saturationCapability, this.util.clamp(Number(hsv.s.toFixed(4)), 0, 1));
  }

  async retrieveDeviceData() {
    try {
      const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      const property = (did) => {
        const found = result.find((obj) => obj.did === did);
        if (!found) {
          this.log(`Yeelight ceil43 missing MIOT property ${did}; received: ${JSON.stringify(result)}`);
        }
        return found;
      };

      const onoff = property('power');
      const brightness = property('brightness');
      const mode = property('mode');
      const color = property('color');
      const colorTemperature = property('color_temperature');
      const ambientOnoff = property('ambient_power');
      const ambientBrightness = property('ambient_brightness');
      const ambientColorTemperature = property('ambient_color_temperature');
      const ambientColor = property('ambient_color');

      await this.updateCapabilityValue('onoff', onoff.value);
      await this.updateCapabilityValue('dim', brightness.value / 100);
      await this.updateCapabilityValue('light_mode', this.toHomeyLightMode(mode.value));
      await this.updateCapabilityValue('yeelight_ceil43_mode', String(mode.value));
      await this.updateCapabilityValue('light_temperature', this.toHomeyColorTemperature(colorTemperature.value));
      await this.updateColorCapabilities(color.value, 'light_hue', 'light_saturation');

      await this.updateCapabilityValue('onoff.ambient', ambientOnoff.value);
      await this.updateCapabilityValue('dim.ambient', ambientBrightness.value / 100);
      if (this.getCapabilityValue('light_mode.ambient') === null) {
        await this.updateCapabilityValue('light_mode.ambient', 'temperature');
      }
      await this.updateCapabilityValue('light_temperature.ambient', this.toHomeyColorTemperature(ambientColorTemperature.value));
      await this.updateColorCapabilities(ambientColor.value, 'light_hue.ambient', 'light_saturation.ambient');

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

module.exports = YeelightArwenCeilingLightDDevice;
