'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const tinycolor = require('tinycolor2');

/* supported devices */
// https://home.miot-spec.com/spec/yeelink.light.color1 // Yeelight Color Bulb

const COLOR_TEMPERATURE_MIN = 1700;
const COLOR_TEMPERATURE_MAX = 6500;
const LEGACY_MODE_COLOR = 1;
const LEGACY_MODE_HSV = 3;
const DEFAULT_EFFECT = 'smooth';
const DEFAULT_DURATION = 500;
const PRIMARY_POLL_PROPERTIES = ['power', 'bright', 'rgb', 'ct', 'color_mode'];
const POLL_ECHO_TOLERANCE = 0.0001;
const POLL_ECHO_EXPIRATION_MS = 5000;
const POLL_ECHO_CAPABILITIES = ['dim', 'light_mode', 'light_temperature', 'light_hue', 'light_saturation'];

class YeelightColorBulbDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.bootSequence();

      await this.ensureCapability('light_mode');

      this.registerCapabilityListener('onoff', async (value) => {
        await this.callYeelight('set_power', [value ? 'on' : 'off']);
      });

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

  async callYeelight(method, args = []) {
    try {
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => { this.error(error); });
        this.createDevice();
        return Promise.reject('Device unreachable, please try again ...');
      }

      const payload = args.concat([DEFAULT_EFFECT, DEFAULT_DURATION]);
      const result = await this.miio.call(method, payload, { retries: 1 });
      this.log(`Yeelight color1 ${method}: ${JSON.stringify(payload)} -> ${JSON.stringify(result)}`);
      if (Array.isArray(result) && result[0] !== 'ok') {
        throw new Error(`${method} failed with response ${JSON.stringify(result)}`);
      }
      return result;
    } catch (error) {
      this.error(`Yeelight color1 failed to call ${method} with ${JSON.stringify(args)}`);
      this.error(error);
      return Promise.reject(error);
    }
  }

  async onLightCapabilities(valueObj) {
    valueObj = this.consumePollEchoes(valueObj);
    if (!valueObj) {
      return;
    }

    if (valueObj.light_mode === 'color' || typeof valueObj.light_hue !== 'undefined' || typeof valueObj.light_saturation !== 'undefined') {
      await this.updateCapabilityValue('light_mode', 'color');
      await this.callYeelight('set_rgb', [this.getRgbIntFromCapabilities(valueObj)]);
    } else if (valueObj.light_mode === 'temperature' || typeof valueObj.light_temperature !== 'undefined') {
      await this.updateCapabilityValue('light_mode', 'temperature');
    }

    if (typeof valueObj.light_temperature !== 'undefined') {
      await this.callYeelight('set_ct_abx', [this.toMiotColorTemperature(valueObj.light_temperature)]);
    }

    if (typeof valueObj.dim !== 'undefined') {
      const brightness = Math.round(this.util.clamp(valueObj.dim * 100, 1, 100));
      await this.callYeelight('set_bright', [brightness]);
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
    const modeValue = Number(mode);
    return modeValue === LEGACY_MODE_COLOR || modeValue === LEGACY_MODE_HSV ? 'color' : 'temperature';
  }

  toHomeyColorTemperature(value) {
    const normalized = (COLOR_TEMPERATURE_MAX - value) / (COLOR_TEMPERATURE_MAX - COLOR_TEMPERATURE_MIN);
    return this.util.clamp(Number(normalized.toFixed(2)), 0, 1);
  }

  toMiotColorTemperature(value) {
    const colorTemperature = COLOR_TEMPERATURE_MAX - (this.util.clamp(value, 0, 1) * (COLOR_TEMPERATURE_MAX - COLOR_TEMPERATURE_MIN));
    return Math.round(this.util.clamp(colorTemperature, COLOR_TEMPERATURE_MIN, COLOR_TEMPERATURE_MAX));
  }

  async updateCapabilityValue(capability, value) {
    // The inherited generic miio colorChanged handler can emit invalid temperature values for this legacy bulb.
    // Use the legacy ct property from polling as the authoritative source instead.
    if (capability === 'light_temperature' && (typeof value !== 'number' || value < 0 || value > 1)) {
      return;
    }

    if (this.hasCapability(capability) && this.getCapabilityValue(capability) !== value) {
      await this.setCapabilityValue(capability, value);
    }
  }

  queuePollEchoes(nextState) {
    this.pendingPollEchoes = {};
    this.pendingPollEchoesUntil = Date.now() + POLL_ECHO_EXPIRATION_MS;

    POLL_ECHO_CAPABILITIES.forEach((capability) => {
      if ((capability !== 'light_temperature' || nextState.light_mode === 'temperature')
        && nextState[capability] !== null
        && this.hasCapability(capability)
        && !this.capabilityValueEquals(this.getCapabilityValue(capability), nextState[capability])) {
        this.pendingPollEchoes[capability] = nextState[capability];
      }
    });
  }

  consumePollEchoes(valueObj) {
    if (!this.pendingPollEchoes || !valueObj || Object.keys(valueObj).length === 0) return valueObj;
    if (Date.now() > this.pendingPollEchoesUntil) {
      this.pendingPollEchoes = {};
      return valueObj;
    }

    const remaining = {};

    Object.entries(valueObj).forEach(([capability, value]) => {
      const pendingValue = this.pendingPollEchoes[capability];
      if (pendingValue !== undefined && this.capabilityValueEquals(value, pendingValue)) {
        delete this.pendingPollEchoes[capability];
      } else {
        remaining[capability] = value;
      }
    });

    if (Object.keys(this.pendingPollEchoes).length === 0) {
      this.pendingPollEchoesUntil = 0;
    }

    return Object.keys(remaining).length === 0 ? null : remaining;
  }

  async updateColorCapabilities(colorValue) {
    if (colorValue === undefined || colorValue === null) return;

    const { lightHue, lightSaturation } = this.getHomeyColorCapabilities(colorValue);

    await this.updateCapabilityValue('light_hue', lightHue);
    await this.updateCapabilityValue('light_saturation', lightSaturation);
  }

  getHomeyColorCapabilities(colorValue) {
    const hexValue = Number(colorValue).toString(16).padStart(6, '0');
    const color = tinycolor(`#${hexValue}`);
    const hsv = color.toHsv();

    return {
      lightHue: this.util.clamp(Number((hsv.h / 360).toFixed(4)), 0, 1),
      lightSaturation: this.util.clamp(Number(hsv.s.toFixed(4)), 0, 1)
    };
  }

  async pollLegacyProperties() {
    return this.miio.call('get_prop', PRIMARY_POLL_PROPERTIES, { retries: 1 });
  }

  getStateFromPollResult(result) {
    const powerValue = result[0];
    const brightnessValue = Number(result[1]);
    const colorValue = Number(result[2]);
    const colorTemperatureValue = Number(result[3]);
    const modeValue = Number(result[4]);
    const colorCapabilities = Number.isNaN(colorValue) ? null : this.getHomeyColorCapabilities(colorValue);

    return {
      raw: result,
      onoff: powerValue === 'on',
      dim: Number.isNaN(brightnessValue) ? null : this.util.clamp(brightnessValue / 100, 0.01, 1),
      light_mode: Number.isNaN(modeValue) ? null : this.toHomeyLightMode(modeValue),
      light_temperature: Number.isNaN(colorTemperatureValue) ? null : this.toHomeyColorTemperature(colorTemperatureValue),
      light_hue: colorCapabilities ? colorCapabilities.lightHue : null,
      light_saturation: colorCapabilities ? colorCapabilities.lightSaturation : null,
      color: Number.isNaN(colorValue) ? null : colorValue
    };
  }

  capabilityValueEquals(value, pollValue) {
    if (typeof value === 'number' && typeof pollValue === 'number') {
      return Math.abs(value - pollValue) <= POLL_ECHO_TOLERANCE;
    }

    return value === pollValue;
  }

  async retrieveDeviceData() {
    if (this.isRetrievingDeviceData) {
      // Polling can be very short during testing; avoid overlapping reads and interleaved state writes.
      return;
    }

    this.isRetrievingDeviceData = true;

    try {
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => { this.error(error); });
        this.createDevice();
        return;
      }

      const result = await this.pollLegacyProperties();
      if (!this.getAvailable()) { await this.setAvailable(); }

      const nextState = this.getStateFromPollResult(result);
      // Homey can echo setCapabilityValue updates through the listener; consume those one-shot echoes.
      this.queuePollEchoes(nextState);

      if (result[0] !== undefined) await this.updateCapabilityValue('onoff', nextState.onoff);
      if (nextState.dim !== null) await this.updateCapabilityValue('dim', nextState.dim);
      if (nextState.light_mode !== null) await this.updateCapabilityValue('light_mode', nextState.light_mode);
      if (nextState.light_temperature !== null && nextState.light_mode === 'temperature') await this.updateCapabilityValue('light_temperature', nextState.light_temperature);
      if (nextState.color !== null) await this.updateColorCapabilities(nextState.color);

    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((error) => { this.error(error); });
      }

      this.homey.setTimeout(() => { this.createDevice(); }, 60000);

      this.error(error.message);
    } finally {
      this.isRetrievingDeviceData = false;
    }
  }

}

module.exports = YeelightColorBulbDevice;
