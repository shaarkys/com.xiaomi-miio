'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/yeelink.light.lamp22 // Xiaomi Monitor Light Bar S1

const COLOR_TEMPERATURE_MIN = 2700;
const COLOR_TEMPERATURE_MAX = 6500;

const mapping = {
  'yeelink.light.lamp22': 'mapping_default',
  'yeelink.light.*': 'mapping_default'
};

const properties = {
  mapping_default: {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 },
      { did: 'brightness', siid: 2, piid: 2 },
      { did: 'color_temperature', siid: 2, piid: 3 }
    ],
    set_properties: {
      power: { siid: 2, piid: 1 },
      brightness: { siid: 2, piid: 2 },
      color_temperature: { siid: 2, piid: 3 }
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

      this.registerCapabilityListener('onoff', (value) => this.setMiotProperty('power', value));

      this.registerMultipleCapabilityListener(
        ['dim', 'light_temperature'],
        this.onLightCapabilities.bind(this),
        500
      );

    } catch (error) {
      this.error(error);
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
      this.log(`Yeelight lamp22 set ${property}: ${JSON.stringify(payload)} -> ${JSON.stringify(result)}`);
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
      await this.setCapabilityValue(capability, value);
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

      const powerValue = this.normalizePollValue(onoff);
      const brightnessValue = this.normalizePollValue(brightness);
      const colorTemperatureValue = this.normalizePollValue(colorTemperature);

      if (powerValue !== undefined) await this.updateCapabilityValue('onoff', powerValue);
      if (brightnessValue !== undefined) await this.updateCapabilityValue('dim', this.util.clamp(brightnessValue / 100, 0.01, 1));
      if (colorTemperatureValue !== undefined) await this.updateCapabilityValue('light_temperature', this.toHomeyColorTemperature(colorTemperatureValue));

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
