'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.humidifier.airmx
// https://home.miot-spec.com/spec/xiaomi.humidifier.600ek

const MODEL_MAPPING = {
  'xiaomi.humidifier.airmx': 'mapping_default',
  'xiaomi.humidifier.600ek': 'mapping_600ek',
  'xiaomi.humidifier.*': 'mapping_default',
};

const properties = {
  mapping_default: {
    get_properties: [
      { did: 'onoff', siid: 2, piid: 1 }, // onoff
      { did: 'error', siid: 2, piid: 2 }, // settings.error
      { did: 'mode', siid: 2, piid: 3 }, // humidifier_xiaomi_mode
      { did: 'target_humidity', siid: 2, piid: 6 }, // target_humidity [40, 50, 60, 70]
      { did: 'water_level', siid: 2, piid: 7 }, // measure_waterlevel
      { did: 'dry', siid: 2, piid: 12 }, // onoff.dry
      { did: 'humidity', siid: 3, piid: 1 }, // measure_humidity
      { did: 'temperature', siid: 3, piid: 2 }, // measure_temperature
      { did: 'child_lock', siid: 11, piid: 1 }, // settings.childLock
      { did: 'buzzer', siid: 14, piid: 1 }, // settings.buzzer
      { did: 'light', siid: 15, piid: 2 }, // settings.led
    ],
    set_properties: {
      onoff: { siid: 2, piid: 1 },
      mode: { siid: 2, piid: 3 },
      target_humidity: { siid: 2, piid: 6 },
      onoff_dry: { siid: 2, piid: 12 },
      child_lock: { siid: 11, piid: 1 },
      buzzer: { siid: 14, piid: 1 },
      light: { siid: 15, piid: 1 },
    },
  },
  mapping_600ek: {
    get_properties: [
      { did: 'onoff', siid: 2, piid: 1 }, // onoff
      { did: 'error', siid: 2, piid: 2 }, // settings.error / low-water state
      { did: 'mode', siid: 2, piid: 3 }, // humidifier_xiaomi_mode
      { did: 'target_humidity', siid: 2, piid: 5 }, // target_humidity [40-70]
      { did: 'humidity', siid: 3, piid: 1 }, // measure_humidity
      { did: 'light', siid: 6, piid: 1 }, // settings.led (screen on)
      { did: 'buzzer', siid: 7, piid: 1 }, // settings.buzzer
      { did: 'child_lock', siid: 8, piid: 1 }, // settings.childLock
    ],
    set_properties: {
      onoff: { siid: 2, piid: 1 },
      mode: { siid: 2, piid: 3 },
      target_humidity: { siid: 2, piid: 5 },
      light: { siid: 6, piid: 1 },
      buzzer: { siid: 7, piid: 1 },
      child_lock: { siid: 8, piid: 1 },
    },
  },
};

const MODE_OPTIONS = {
  default: [
    { id: '0', title: 'Constant Humidity' },
    { id: '1', title: 'Strong' },
    { id: '2', title: 'Sleep' },
    { id: '3', title: 'Air-dry' },
    { id: '4', title: 'Clean' },
    { id: '5', title: 'Descale' },
  ],
  'xiaomi.humidifier.600ek': [
    { id: '0', title: 'Constant Humidity' },
    { id: '1', title: 'Sleep' },
    { id: '2', title: 'Strong' },
  ],
};

const ERROR_CODES = {
  default: {
    0: 'No Error',
    1: 'Pump',
    2: 'Low Water',
    3: 'Pump Low Water',
  },
  'xiaomi.humidifier.600ek': {
    0: 'No Faults',
    1: 'Motor Fault',
    2: 'Pump Fault',
    3: 'Pump Fail',
    4: 'Lack Of Water',
  },
};

class XiaomiHumidifierMIoTDevice extends Device {
  getModel() {
    return this.getStoreValue('model');
  }

  is600ek() {
    return this.getModel() === 'xiaomi.humidifier.600ek';
  }

  getModeOptions() {
    return MODE_OPTIONS[this.getModel()] || MODE_OPTIONS.default;
  }

  getModeLabel(mode) {
    const modeValue = String(mode);
    const option = this.getModeOptions().find((entry) => entry.id === modeValue);
    return option ? option.title : modeValue;
  }

  getTargetHumidityOptions() {
    if (this.is600ek()) {
      return { min: 40, max: 70, step: 1 };
    }

    return { min: 40, max: 70, step: 10 };
  }

  getErrorLabel(value) {
    const errorCodes = ERROR_CODES[this.getModel()] || ERROR_CODES.default;
    return errorCodes[Number(value)] || 'Unknown';
  }

  normalizeBooleanValue(value) {
    return value !== 0 && value !== false && value !== '0' && value !== 'false';
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

  async handleSetProperty(propertyKey, value) {
    try {
      const definition = this.deviceProperties?.set_properties?.[propertyKey];
      if (!definition) {
        return Promise.reject(new Error(`Property ${propertyKey} not supported by current model`));
      }

      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
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

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.bootSequence();

      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');
      this.homey.flow.getDeviceTriggerCard('humidifier2Waterlevel');

      this.deviceProperties =
        properties[MODEL_MAPPING[this.getModel()]] !== undefined
          ? properties[MODEL_MAPPING[this.getModel()]]
          : properties[MODEL_MAPPING['xiaomi.humidifier.*']];

      if (this.is600ek()) {
        const unsupportedCapabilities = ['onoff.dry', 'measure_temperature', 'measure_waterlevel'];
        for (const capability of unsupportedCapabilities) {
          if (this.hasCapability(capability)) {
            await this.removeCapability(capability).catch((error) => {
              this.error(`Failed to remove capability ${capability}: ${error.message ?? error}`);
            });
          }
        }

        if (!this.hasCapability('humidifier_water_level_state')) {
          await this.addCapability('humidifier_water_level_state').catch((error) => {
            this.error(`Failed to add capability humidifier_water_level_state: ${error.message ?? error}`);
          });
        }
      }

      await this.setCapabilityOptions('humidifier_xiaomi_mode', {
        values: this.getModeOptions(),
      });
      await this.setCapabilityOptions('target_humidity', this.getTargetHumidityOptions());

      this.registerCapabilityListener('onoff', (value) => this.handleSetProperty('onoff', value));
      this.registerCapabilityListener('humidifier_xiaomi_mode', (value) =>
        this.handleSetProperty('mode', Number(value))
      );
      this.registerCapabilityListener('target_humidity', (value) => {
        const options = this.getTargetHumidityOptions();
        const humidity = this.util.clamp(Number(value), options.min, options.max);
        return this.handleSetProperty('target_humidity', humidity);
      });

      if (this.hasCapability('onoff.dry') && this.deviceProperties?.set_properties?.onoff_dry) {
        this.registerCapabilityListener('onoff.dry', (value) => this.handleSetProperty('onoff_dry', value));
      }
    } catch (error) {
      this.error(error);
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
      this.refreshDevice();
    }

    if (changedKeys.includes('led') && this.deviceProperties?.set_properties?.light && this.miio) {
      await this.handleSetProperty('light', this.normalizeBooleanValue(newSettings.led));
    }

    if (changedKeys.includes('buzzer') && this.deviceProperties?.set_properties?.buzzer && this.miio) {
      await this.handleSetProperty('buzzer', this.normalizeBooleanValue(newSettings.buzzer));
    }

    if (changedKeys.includes('childLock') && this.deviceProperties?.set_properties?.child_lock && this.miio) {
      await this.handleSetProperty('child_lock', this.normalizeBooleanValue(newSettings.childLock));
    }

    return Promise.resolve(true);
  }

  async handleModeEvent(mode) {
    try {
      const modeValue = String(mode);
      if (this.getCapabilityValue('humidifier_xiaomi_mode') !== modeValue) {
        const previousMode = this.getCapabilityValue('humidifier_xiaomi_mode');
        await this.setCapabilityValue('humidifier_xiaomi_mode', modeValue);
        await this.homey.flow
          .getDeviceTriggerCard('triggerModeChanged')
          .trigger(this, {
            new_mode: this.getModeLabel(mode),
            previous_mode:
              previousMode !== undefined && previousMode !== null
                ? this.getModeLabel(previousMode)
                : '',
          })
          .catch((error) => {
            this.error(error);
          });
      }
    } catch (error) {
      this.error(error);
    }
  }

  async retrieveDeviceData() {
    try {
      const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) {
        await this.setAvailable();
      }

      const indexed = this.indexResults(result);

      const onoff = indexed.onoff;
      if (this.hasUsableValue(onoff)) {
        await this.updateCapabilityValue('onoff', !!onoff.value);
      }

      const targetHumidity = indexed.target_humidity;
      if (this.hasUsableValue(targetHumidity) && typeof targetHumidity.value === 'number') {
        await this.updateCapabilityValue('target_humidity', targetHumidity.value);
      }

      const onoffDry = indexed.dry;
      if (this.hasUsableValue(onoffDry) && this.hasCapability('onoff.dry')) {
        await this.updateCapabilityValue('onoff.dry', !!onoffDry.value);
      }

      const measureHumidity = indexed.humidity;
      if (this.hasUsableValue(measureHumidity)) {
        await this.updateCapabilityValue('measure_humidity', measureHumidity.value);
      }

      const measureTemperature = indexed.temperature;
      if (this.hasUsableValue(measureTemperature) && this.hasCapability('measure_temperature')) {
        await this.updateCapabilityValue('measure_temperature', measureTemperature.value);
      }

      const childLock = indexed.child_lock;
      if (this.hasUsableValue(childLock)) {
        await this.updateSettingValue('childLock', this.normalizeBooleanValue(childLock.value));
      }

      const buzzer = indexed.buzzer;
      if (this.hasUsableValue(buzzer)) {
        await this.updateSettingValue('buzzer', this.normalizeBooleanValue(buzzer.value));
      }

      const led = indexed.light;
      if (this.hasUsableValue(led)) {
        await this.updateSettingValue('led', this.normalizeBooleanValue(led.value));
      }

      const errorValue = indexed.error;
      if (this.hasUsableValue(errorValue)) {
        await this.updateSettingValue('error', this.getErrorLabel(errorValue.value));
      }

      const mode = indexed.mode;
      if (this.hasUsableValue(mode) && typeof mode.value === 'number') {
        await this.handleModeEvent(mode.value);
      }

      if (this.is600ek()) {
        if (this.hasUsableValue(errorValue) && this.hasCapability('humidifier_water_level_state')) {
          const waterState = Number(errorValue.value) === 4 ? 'empty' : 'normal';
          await this.updateCapabilityValue('humidifier_water_level_state', waterState);
        }
      } else {
        const measureWaterlevel = indexed.water_level;
        if (this.hasUsableValue(measureWaterlevel)) {
          const waterLevel = measureWaterlevel.value;
          if (this.getCapabilityValue('measure_waterlevel') !== waterLevel) {
            const previousWaterlevel = await this.getCapabilityValue('measure_waterlevel');
            await this.setCapabilityValue('measure_waterlevel', waterLevel);
            await this.homey.flow
              .getDeviceTriggerCard('humidifier2Waterlevel')
              .trigger(this, { waterlevel: waterLevel, previous_waterlevel: previousWaterlevel })
              .catch((error) => {
                this.error(error);
              });
          }
        }
      }
    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((setError) => {
          this.error(setError);
        });
      }

      this.homey.setTimeout(() => {
        this.createDevice();
      }, 60000);

      this.error(error.message);
    }
  }
}

module.exports = XiaomiHumidifierMIoTDevice;
