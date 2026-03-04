'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const tinycolor = require('tinycolor2');

const MODEL_MAPPING = {
  'xwhzp.diffuser.xwxfj': 'xwxfj'
};

const FALLBACK_MODEL_KEY = 'xwxfj';
const EMPTY_LEVEL_THRESHOLD = 10;

const MODE_LABELS = {
  0: 'Sleep',
  1: 'Reading',
  2: 'Exercise',
  3: 'Wakeup',
  4: 'Custom Mode 1',
  5: 'Custom Mode 2',
  6: 'Custom Mode 3',
  7: 'Custom Mode 4',
  8: 'Try It',
  9: 'Idle Mode'
};

const PROPERTIES = {
  xwxfj: {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 },
      { did: 'fault', siid: 2, piid: 2 },
      { did: 'mode', siid: 2, piid: 3 },
      { did: 'fragrance_out_time', siid: 2, piid: 7 },
      { did: 'lid_status', siid: 2, piid: 8 },
      { did: 'wifi_status', siid: 2, piid: 9 },
      { did: 'light_power', siid: 3, piid: 1 },
      { did: 'light_brightness', siid: 3, piid: 2 },
      { did: 'light_color', siid: 3, piid: 3 },
      { did: 'workstate', siid: 4, piid: 2 },
      { did: 'battery_level', siid: 5, piid: 1 },
      { did: 'charging_state', siid: 5, piid: 2 },
      { did: 'liquid_level_1', siid: 12, piid: 1 },
      { did: 'liquid_name_1', siid: 12, piid: 2 },
      { did: 'liquid_level_2', siid: 13, piid: 1 },
      { did: 'liquid_name_2', siid: 13, piid: 2 },
      { did: 'liquid_level_3', siid: 14, piid: 1 },
      { did: 'liquid_name_3', siid: 14, piid: 2 }
    ],
    set_properties: {
      power: { siid: 2, piid: 1 },
      mode: { siid: 2, piid: 3 },
      fragrance_out_time: { siid: 2, piid: 7 },
      light_power: { siid: 3, piid: 1 },
      light_brightness: { siid: 3, piid: 2 },
      light_color: { siid: 3, piid: 3 }
    }
  }
};

class MijiaSmartScentDiffuserDevice extends Device {
  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.deviceProperties = this.resolveDeviceProperties();

      this.bootSequence();

      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      await this.ensureCapabilities([
        'onoff',
        'diffuser_xwhzp_mode',
        'diffuser_xwhzp_fragrance_out_time',
        'dim',
        'light_hue',
        'light_saturation',
        'measure_waterlevel',
        'alarm_tank_empty',
        'measure_battery',
        'alarm_battery'
      ]);

      this.registerCapabilityListener('onoff', (value) => this.setPropertyValue('power', this.toBoolean(value)));

      this.registerCapabilityListener('diffuser_xwhzp_mode', (value) =>
        this.setPropertyValue('mode', Number(value))
      );

      this.registerCapabilityListener('diffuser_xwhzp_fragrance_out_time', (value) => {
        const fragranceOutTime = Math.max(30, Math.min(120, Math.round(Number(value) || 30)));
        return this.setPropertyValue('fragrance_out_time', fragranceOutTime);
      });

      this.registerCapabilityListener('dim', (value) => this.setAmbientLightBrightness(value));

      this.registerMultipleCapabilityListener(
        ['light_hue', 'light_saturation'],
        (valueObj) => this.setAmbientLightColor(valueObj),
        500
      );
    } catch (error) {
      this.error(error);
    }
  }

  async ensureCapabilities(capabilities) {
    for (const capability of capabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability).catch((error) => {
          this.error('Failed to add capability', capability, error);
        });
      }
    }
  }

  getModelIdentifier() {
    if (typeof this.getStoreValue === 'function') {
      const storedModel = this.getStoreValue('model');
      if (storedModel) return storedModel;
    }

    if (typeof this.getData === 'function') {
      const data = this.getData();
      if (data && data.model) return data.model;
    }

    return 'unknown';
  }

  resolveDeviceProperties() {
    const modelKey = MODEL_MAPPING[this.getModelIdentifier()] || FALLBACK_MODEL_KEY;
    const definition = PROPERTIES[modelKey] || PROPERTIES[FALLBACK_MODEL_KEY];
    if (!definition) {
      throw new Error('No property definition found for current diffuser model');
    }
    return definition;
  }

  toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'on';
    }
    return false;
  }

  clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  clamp100(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  hasUsableValue(entry) {
    if (!entry) return false;
    if (typeof entry.code === 'number' && entry.code !== 0) return false;
    return entry.value !== undefined && entry.value !== null && entry.value !== 'undefined' && entry.value !== 'null';
  }

  indexResults(result) {
    const map = {};
    if (!Array.isArray(result)) return map;

    for (const entry of result) {
      if (!entry) continue;
      const key = entry.did || entry.did === '' ? entry.did : `${entry.siid}/${entry.piid}`;
      map[key] = entry;
    }

    return map;
  }

  async setPropertyValue(propertyKey, value) {
    const definition = this.deviceProperties && this.deviceProperties.set_properties
      ? this.deviceProperties.set_properties[propertyKey]
      : null;

    if (!definition) {
      return Promise.reject(new Error(`Property ${propertyKey} is not supported by current model`));
    }

    if (!this.miio) {
      this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
      this.createDevice();
      return Promise.reject('Device unreachable, please try again ...');
    }

    return this.miio.call(
      'set_properties',
      [{ siid: definition.siid, piid: definition.piid, value }],
      { retries: 1 }
    );
  }

  async setMultipleProperties(entries) {
    if (!this.miio) {
      this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
      this.createDevice();
      return Promise.reject('Device unreachable, please try again ...');
    }

    const payload = [];
    for (const entry of entries) {
      const definition = this.deviceProperties && this.deviceProperties.set_properties
        ? this.deviceProperties.set_properties[entry.key]
        : null;
      if (!definition) continue;
      payload.push({ siid: definition.siid, piid: definition.piid, value: entry.value });
    }

    if (payload.length === 0) {
      return Promise.reject(new Error('No valid properties provided for update'));
    }

    return this.miio.call('set_properties', payload, { retries: 1 });
  }

  async setAmbientLightBrightness(value) {
    try {
      const brightness = Math.round(this.clamp01(value) * 100);
      const payload = brightness > 0
        ? [
            { key: 'light_power', value: true },
            { key: 'light_brightness', value: brightness }
          ]
        : [
            { key: 'light_brightness', value: 0 },
            { key: 'light_power', value: false }
          ];

      return await this.setMultipleProperties(payload);
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

  async setAmbientLightColor(valueObj) {
    try {
      const hueValue = typeof valueObj.light_hue !== 'undefined'
        ? valueObj.light_hue
        : this.getCapabilityValue('light_hue');
      const saturationValue = typeof valueObj.light_saturation !== 'undefined'
        ? valueObj.light_saturation
        : this.getCapabilityValue('light_saturation');

      const hue = this.clamp01(hueValue) * 360;
      const saturation = this.clamp01(saturationValue) * 100;
      const dimValue = this.getCapabilityValue('dim');
      const brightness = typeof dimValue === 'number' && dimValue > 0
        ? this.clamp01(dimValue) * 100
        : 100;

      const color = tinycolor({ h: hue, s: saturation, v: brightness });
      const rgbAsInt = parseInt(color.toHex(), 16);

      return await this.setMultipleProperties([
        { key: 'light_power', value: true },
        { key: 'light_color', value: rgbAsInt }
      ]);
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
      this.refreshDevice();
    }

    return true;
  }

  async retrieveDeviceData() {
    try {
      const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) {
        await this.setAvailable();
      }

      const indexed = this.indexResults(result);

      const power = indexed.power;
      if (this.hasUsableValue(power)) {
        await this.updateCapabilityValue('onoff', this.toBoolean(power.value));
      }

      const mode = indexed.mode;
      if (this.hasUsableValue(mode) && typeof mode.value === 'number') {
        await this.handleModeEvent(mode.value);
      }

      const fragranceOutTime = indexed.fragrance_out_time;
      if (this.hasUsableValue(fragranceOutTime) && typeof fragranceOutTime.value === 'number') {
        await this.updateCapabilityValue('diffuser_xwhzp_fragrance_out_time', fragranceOutTime.value);
      }

      const lightPower = indexed.light_power;
      const lightBrightness = indexed.light_brightness;
      if (this.hasUsableValue(lightBrightness) && typeof lightBrightness.value === 'number') {
        const dim = this.toBoolean(lightPower && lightPower.value)
          ? this.clamp01(lightBrightness.value / 100)
          : 0;
        await this.updateCapabilityValue('dim', dim);
      }

      const lightColor = indexed.light_color;
      if (this.hasUsableValue(lightColor) && typeof lightColor.value === 'number') {
        const hexValue = lightColor.value.toString(16).padStart(6, '0');
        const hsv = tinycolor(`#${hexValue}`).toHsv();
        const hueNormalized = Number.isFinite(hsv.h) ? this.clamp01(hsv.h / 360) : 0;
        const saturationNormalized = Number.isFinite(hsv.s) ? this.clamp01(hsv.s) : 0;

        await this.updateCapabilityValue('light_hue', hueNormalized);
        await this.updateCapabilityValue('light_saturation', saturationNormalized);
      }

      const battery = indexed.battery_level;
      if (this.hasUsableValue(battery) && typeof battery.value === 'number') {
        const batteryLevel = this.clamp100(battery.value);
        await this.updateCapabilityValue('measure_battery', batteryLevel);
        await this.updateCapabilityValue('alarm_battery', batteryLevel <= 20);
      }

      const levelEntries = [indexed.liquid_level_1, indexed.liquid_level_2, indexed.liquid_level_3];
      const validLevels = levelEntries
        .filter((entry) => this.hasUsableValue(entry) && typeof entry.value === 'number')
        .map((entry) => this.clamp100(entry.value));

      if (validLevels.length > 0) {
        const lowestLevel = Math.min(...validLevels);
        await this.updateCapabilityValue('measure_waterlevel', lowestLevel);
        await this.updateCapabilityValue('alarm_tank_empty', lowestLevel <= EMPTY_LEVEL_THRESHOLD);
      }
    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((err) => {
          this.error(err);
        });
      }

      this.homey.setTimeout(() => {
        this.createDevice();
      }, 60000);

      this.error(error.message);
    }
  }

  async handleModeEvent(mode) {
    try {
      const modeValue = mode.toString();
      if (this.getCapabilityValue('diffuser_xwhzp_mode') !== modeValue) {
        const previousMode = this.getCapabilityValue('diffuser_xwhzp_mode');
        await this.setCapabilityValue('diffuser_xwhzp_mode', modeValue);

        const newModeLabel = MODE_LABELS[mode] || modeValue;
        const previousModeLabel = previousMode !== undefined && previousMode !== null
          ? MODE_LABELS[Number(previousMode)] || previousMode
          : undefined;

        await this.homey.flow
          .getDeviceTriggerCard('triggerModeChanged')
          .trigger(this, { new_mode: newModeLabel, previous_mode: previousModeLabel })
          .catch((error) => {
            this.error(error);
          });
      }
    } catch (error) {
      this.error(error);
    }
  }
}

module.exports = MijiaSmartScentDiffuserDevice;
