'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const tinycolor = require('tinycolor2');

/* supported devices */
// https://home.miot-spec.com/spec/yeelink.light.bslamp2 // Xiaomi Mi Bedside Lamp 2 (MJCTD02YL)

const COLOR_TEMPERATURE_MIN = 1700;
const COLOR_TEMPERATURE_MAX = 6500;
const MIOT_MODE_COLOR = 1;
const MIOT_MODE_DAY = 2;

const mapping = {
  'yeelink.light.bslamp2': 'mapping_default',
  'yeelink.light.*': 'mapping_default'
};

const properties = {
  mapping_default: {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 },
      { did: 'brightness', siid: 2, piid: 2 },
      { did: 'color_temperature', siid: 2, piid: 3 },
      { did: 'color', siid: 2, piid: 4 },
      { did: 'mode', siid: 2, piid: 5 }
    ],
    set_properties: {
      power: { siid: 2, piid: 1 },
      brightness: { siid: 2, piid: 2 },
      color_temperature: { siid: 2, piid: 3 },
      color: { siid: 2, piid: 4 },
      mode: { siid: 2, piid: 5 }
    }
  }
};

class XiaomiMiBedsideLamp2Device extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.bootSequence();

      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined
        ? properties[mapping[this.getStoreValue('model')]]
        : properties[mapping['yeelink.light.*']];

      await this.ensureCapability('light_mode');

      this.registerCapabilityListener('onoff', (value) => this.setMiotProperty('power', value));

      this.registerMultipleCapabilityListener(
        ['dim', 'light_temperature', 'light_hue', 'light_saturation', 'light_mode'],
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
      this.log(`Yeelight bslamp2 set ${property}: ${JSON.stringify(payload)} -> ${JSON.stringify(result)}`);

      const failed = Array.isArray(result) ? result.find((item) => item && item.code !== 0) : null;
      if (failed) {
        throw new Error(`MIOT set_properties failed with code ${failed.code}`);
      }

      return result;
    } catch (error) {
      this.error(`Yeelight bslamp2 failed to set ${property} to ${JSON.stringify(value)}`);
      this.error(error);
      return Promise.reject(error);
    }
  }

  async onLightCapabilities(valueObj) {
    if (typeof valueObj.dim !== 'undefined') {
      const brightness = Math.round(this.util.clamp(valueObj.dim * 100, 1, 100));
      await this.setMiotProperty('brightness', brightness);
    }

    if (valueObj.light_mode === 'color' || typeof valueObj.light_hue !== 'undefined' || typeof valueObj.light_saturation !== 'undefined') {
      await this.setMiotProperty('mode', MIOT_MODE_COLOR);
      await this.updateCapabilityValue('light_mode', 'color');
    } else if (valueObj.light_mode === 'temperature' || typeof valueObj.light_temperature !== 'undefined') {
      await this.setMiotProperty('mode', MIOT_MODE_DAY);
      await this.updateCapabilityValue('light_mode', 'temperature');
    }

    if (typeof valueObj.light_temperature !== 'undefined') {
      await this.setMiotProperty('color_temperature', this.toMiotColorTemperature(valueObj.light_temperature));
    }

    if (typeof valueObj.light_hue !== 'undefined' || typeof valueObj.light_saturation !== 'undefined') {
      await this.setMiotProperty('color', this.getRgbIntFromCapabilities(valueObj));
    }
  }

  getRgbIntFromCapabilities(valueObj) {
    const hue = typeof valueObj.light_hue !== 'undefined'
      ? valueObj.light_hue
      : this.getCapabilityValue('light_hue');
    const saturation = typeof valueObj.light_saturation !== 'undefined'
      ? valueObj.light_saturation
      : this.getCapabilityValue('light_saturation');
    const color = tinycolor({
      h: this.toCapabilityValue(hue, 0) * 360,
      s: this.toCapabilityValue(saturation, 1),
      v: 1
    });

    return parseInt(color.toHex(), 16);
  }

  toCapabilityValue(value, fallback) {
    return value === undefined || value === null ? fallback : value;
  }

  toHomeyLightMode(mode) {
    return Number(mode) === MIOT_MODE_COLOR ? 'color' : 'temperature';
  }

  toHomeyColorTemperature(value) {
    const normalized = (COLOR_TEMPERATURE_MAX - value) / (COLOR_TEMPERATURE_MAX - COLOR_TEMPERATURE_MIN);
    return this.util.clamp(Number(normalized.toFixed(4)), 0, 1);
  }

  toMiotColorTemperature(value) {
    const colorTemperature = COLOR_TEMPERATURE_MAX - (this.util.clamp(value, 0, 1) * (COLOR_TEMPERATURE_MAX - COLOR_TEMPERATURE_MIN));
    return Math.round(this.util.clamp(colorTemperature, COLOR_TEMPERATURE_MIN, COLOR_TEMPERATURE_MAX));
  }

  normalizePollValue(property) {
    if (!property || property.code !== 0 || property.value === undefined || property.value === null) {
      this.log(`Yeelight bslamp2 invalid MIOT property response: ${JSON.stringify(property)}`);
      return undefined;
    }

    return property.value;
  }

  async updateColorCapabilities(colorValue) {
    const hexValue = Number(colorValue).toString(16).padStart(6, '0');
    const color = tinycolor(`#${hexValue}`);
    const hsv = color.toHsv();

    await this.updateCapabilityValue('light_hue', this.util.clamp(Number((hsv.h / 360).toFixed(4)), 0, 1));
    await this.updateCapabilityValue('light_saturation', this.util.clamp(Number(hsv.s.toFixed(4)), 0, 1));
  }

  async retrieveDeviceData() {
    if (this.isRetrievingDeviceData) return;
    this.isRetrievingDeviceData = true;

    try {
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => { this.error(error); });
        this.createDevice();
        return;
      }

      const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) await this.setAvailable();

      const property = (did) => result.find((item) => item.did === did);
      const power = this.normalizePollValue(property('power'));
      const brightness = this.normalizePollValue(property('brightness'));
      const colorTemperature = this.normalizePollValue(property('color_temperature'));
      const color = this.normalizePollValue(property('color'));
      const mode = this.normalizePollValue(property('mode'));

      if (power !== undefined) await this.updateCapabilityValue('onoff', power);
      if (brightness !== undefined) await this.updateCapabilityValue('dim', this.util.clamp(brightness / 100, 0.01, 1));
      if (mode !== undefined) await this.updateCapabilityValue('light_mode', this.toHomeyLightMode(mode));
      if (colorTemperature !== undefined) await this.updateCapabilityValue('light_temperature', this.toHomeyColorTemperature(colorTemperature));
      if (color !== undefined) await this.updateColorCapabilities(color);
    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((setUnavailableError) => { this.error(setUnavailableError); });
      }

      this.homey.setTimeout(() => { this.createDevice(); }, 60000);
      this.error(error.message);
    } finally {
      this.isRetrievingDeviceData = false;
    }
  }

}

module.exports = XiaomiMiBedsideLamp2Device;
