'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

const MODEL_MAPPING = {
  'leshow.humidifier.jsq1': 'leshow_jsq1',
  'xiaomi.humidifier.3lite': 'xiaomi_3lite',
};

const FALLBACK_MODEL_KEY = 'leshow_jsq1';

const MODE_LABELS = {
  0: 'Constant Humidity',
  1: 'Sleep',
  2: 'Strong',
};

const WATER_STATE_BY_FAULT = {
  0: 'sufficient',
  5: 'empty',
};

const DEFAULT_WATER_STATE = 'sufficient';

const properties = {
  leshow_jsq1: {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 }, // Switch Status
      { did: 'fault', siid: 2, piid: 2 }, // Device Fault
      { did: 'mode', siid: 2, piid: 3 }, // Mode
      { did: 'target_humidity', siid: 2, piid: 6 }, // Target humidity
      { did: 'relative_humidity', siid: 3, piid: 1 }, // Measured humidity
      { did: 'filter_life_level', siid: 8, piid: 1 }, // Filter life level
      { did: 'screen_brightness', siid: 8, piid: 6 }, // LED / display brightness
    ],
    set_properties: {
      power: { siid: 2, piid: 1 },
      mode: { siid: 2, piid: 3 },
      target_humidity: { siid: 2, piid: 6 },
      screen_brightness: { siid: 8, piid: 6 },
    },
  },
  xiaomi_3lite: {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 }, // Switch Status
      { did: 'fault', siid: 2, piid: 2 }, // Device Fault
      { did: 'mode', siid: 2, piid: 3 }, // Mode
      { did: 'target_humidity', siid: 2, piid: 5 }, // Target humidity
      { did: 'relative_humidity', siid: 3, piid: 1 }, // Measured humidity
      { did: 'filter_life_level', siid: 4, piid: 1 }, // Filter life level
      { did: 'screen_brightness', siid: 6, piid: 2 }, // LED / display brightness
    ],
    set_properties: {
      power: { siid: 2, piid: 1 },
      mode: { siid: 2, piid: 3 },
      target_humidity: { siid: 2, piid: 5 },
      screen_brightness: { siid: 6, piid: 2 },
    },
  },
};

class MiHumidifierLeshowJSQ1Device extends Device {
  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.deviceProperties = this.resolveDeviceProperties();

      this.bootSequence();

      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      if (this.hasCapability('measure_waterlevel')) {
        await this.removeCapability('measure_waterlevel').catch((error) => {
          this.error(`Failed to remove capability measure_waterlevel: ${error.message ?? error}`);
        });
      }

      const optionalCapabilities = ['measure_filter_life', 'humidifier_water_level_state'];
      for (const capability of optionalCapabilities) {
        if (!this.hasCapability(capability)) {
          await this.addCapability(capability).catch((error) => {
            this.error(`Failed to add capability ${capability}: ${error.message ?? error}`);
          });
        }
      }

      this.registerCapabilityListener('onoff', (value) => this.handleSetProperty('power', value));
      this.registerCapabilityListener('target_humidity', (value) => this.handleTargetHumidity(value));
      this.registerCapabilityListener('humidifier_leshow_jsq1_mode', (value) =>
        this.handleSetProperty('mode', Number(value))
      );
    } catch (error) {
      this.error(error);
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
    const definition = properties[modelKey] || properties[FALLBACK_MODEL_KEY];
    if (!definition) {
      throw new Error(`No property definition found for model key ${modelKey}`);
    }
    return definition;
  }

  async handleSetProperty(propertyKey, value) {
    try {
      const definition = this.deviceProperties?.set_properties?.[propertyKey];
      if (!definition) {
        return Promise.reject(new Error(`Property ${propertyKey} not supported by current model`));
      }
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((err) => this.error(err));
        this.createDevice();
        return Promise.reject('Device unreachable, please try again ...');
      }
      return await this.miio.call(
        'set_properties',
        [{ siid: definition.siid, piid: definition.piid, value }],
        { retries: 1 }
      );
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

  async handleTargetHumidity(value) {
    try {
      const definition = this.deviceProperties?.set_properties?.target_humidity;
      if (!definition) {
        return Promise.reject(new Error('Target humidity not supported by current model'));
      }
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((err) => this.error(err));
        this.createDevice();
        return Promise.reject('Device unreachable, please try again ...');
      }
      const humidity = Math.round(Number(value) * 100);
      return await this.miio.call(
        'set_properties',
        [{ siid: definition.siid, piid: definition.piid, value: humidity }],
        { retries: 1 }
      );
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
      this.refreshDevice();
    }

    if (changedKeys.includes('led')) {
      const definition = this.deviceProperties?.set_properties?.screen_brightness;
      if (definition && this.miio) {
        await this.miio.call(
          'set_properties',
          [{ siid: definition.siid, piid: definition.piid, value: newSettings.led ? 1 : 0 }],
          { retries: 1 }
        );
      }
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

      const powerEntry = indexed.power;
      if (this.hasUsableValue(powerEntry)) {
        await this.updateCapabilityValue('onoff', !!powerEntry.value);
      }

      const targetEntry = indexed.target_humidity;
      if (this.hasUsableValue(targetEntry) && typeof targetEntry.value === 'number') {
        await this.updateCapabilityValue('target_humidity', targetEntry.value / 100);
      }

      const humidityEntry = indexed.relative_humidity;
      if (this.hasUsableValue(humidityEntry) && typeof humidityEntry.value === 'number') {
        await this.updateCapabilityValue('measure_humidity', humidityEntry.value);
      }

      const filterEntry = indexed.filter_life_level;
      if (this.hasUsableValue(filterEntry) && typeof filterEntry.value === 'number' && this.hasCapability('measure_filter_life')) {
        const clamped = Math.max(0, Math.min(100, Number(filterEntry.value)));
        await this.updateCapabilityValue('measure_filter_life', clamped);
      }

      const faultEntry = indexed.fault;
      if (
        this.hasUsableValue(faultEntry) &&
        typeof faultEntry.value === 'number' &&
        this.hasCapability('humidifier_water_level_state')
      ) {
        const faultCode = Number(faultEntry.value);
        const waterState = Object.prototype.hasOwnProperty.call(WATER_STATE_BY_FAULT, faultCode)
          ? WATER_STATE_BY_FAULT[faultCode]
          : DEFAULT_WATER_STATE;
        await this.updateCapabilityValue('humidifier_water_level_state', waterState);
      }

      const ledEntry = indexed.screen_brightness;
      if (this.hasUsableValue(ledEntry)) {
        await this.updateSettingValue('led', Boolean(ledEntry.value));
      }

      const modeEntry = indexed.mode;
      if (this.hasUsableValue(modeEntry) && typeof modeEntry.value === 'number') {
        await this.handleModeEvent(modeEntry.value);
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

  indexResults(result) {
    const map = {};
    if (!Array.isArray(result)) return map;
    for (const entry of result) {
      if (!entry) continue;
      const key = entry.did || `${entry.siid}/${entry.piid}`;
      map[key] = entry;
    }
    return map;
  }

  hasUsableValue(entry) {
    if (!entry) return false;
    if (typeof entry.code === 'number' && entry.code !== 0) return false;
    return entry.value !== undefined && entry.value !== null && entry.value !== 'undefined' && entry.value !== 'null';
  }

  async handleModeEvent(mode) {
    try {
      const modeValue = mode.toString();
      if (this.getCapabilityValue('humidifier_leshow_jsq1_mode') !== modeValue) {
        const previous = this.getCapabilityValue('humidifier_leshow_jsq1_mode');
        await this.setCapabilityValue('humidifier_leshow_jsq1_mode', modeValue);
        const newLabel = MODE_LABELS[mode] || modeValue;
        const previousLabel =
          previous !== undefined && previous !== null ? MODE_LABELS[Number(previous)] || previous : undefined;
        await this.homey.flow
          .getDeviceTriggerCard('triggerModeChanged')
          .trigger(this, { new_mode: newLabel, previous_mode: previousLabel })
          .catch((error) => {
            this.error(error);
          });
      }
    } catch (error) {
      this.error(error);
    }
  }

}

module.exports = MiHumidifierLeshowJSQ1Device;
