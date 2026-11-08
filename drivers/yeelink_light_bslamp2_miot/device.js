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
const NIGHTLIGHT_CAPABILITY = 'yeelight_bslamp2_nightlight';
const SCENE_CAPABILITIES = [NIGHTLIGHT_CAPABILITY, 'yeelight_bslamp2_sunrise', 'yeelight_bslamp2_sunset', 'yeelight_bslamp2_stop'];
const LEGACY_POLL_PROPERTIES = ['power', 'bright', 'ct', 'rgb', 'color_mode', 'active_mode'];
// Standard python-yeelight sunrise/sunset transitions; count is the number of steps, not repeats.
// https://yeelight.readthedocs.io/en/latest/_modules/yeelight/flows.html
const SCENES = {
  sunrise: [3, 1, '50,1,16731392,1,360000,2,1700,10,540000,2,2700,100'],
  sunset: [3, 2, '50,2,2700,10,180000,2,1700,5,420000,1,16731136,1']
};

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
      await this.initializeSceneCapabilities();

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

  async initializeSceneCapabilities() {
    const listeners = {
      [NIGHTLIGHT_CAPABILITY]: (value) => this.setNightLight(value),
      yeelight_bslamp2_sunrise: () => this.startScene('sunrise'),
      yeelight_bslamp2_sunset: () => this.startScene('sunset'),
      yeelight_bslamp2_stop: () => this.stopScene()
    };
    for (const capability of SCENE_CAPABILITIES) {
      try {
        if (!this.hasCapability(capability)) {
          this.log(`Adding lamp capability ${capability}`);
          await this.addCapability(capability);
          this.log(`Added lamp capability ${capability}`);
        }
        this.registerCapabilityListener(capability, listeners[capability]);
      } catch (error) {
        this.error(`Failed to initialize lamp capability ${capability}`, error);
      }
    }
  }

  async callSceneCommand(method, params) {
    const connection = this.miio;
    if (!connection || this._wifiStopped) throw new Error('Lamp is not connected; please try again.');
    try {
      const result = await connection.call(method, params, { retries: 1 });
      if (this._wifiStopped || this.miio !== connection) throw new Error('Lamp connection changed during scene command');
      if (!Array.isArray(result) || result.length !== 1 || result[0] !== 'ok') {
        throw new Error(`Yeelight ${method} did not return ok`);
      }
      return result;
    } catch (error) {
      this.error(`Lamp scene command ${method} failed`, error);
      throw error;
    }
  }

  async setNightLight(enabled) {
    return this.queueLampCommand(() => this._setNightLight(enabled));
  }

  async _setNightLight(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Night Light must be on or off');
    if (this._sceneActive) await this._stopScene();
    await this.callSceneCommand('set_power', ['on', 'smooth', 500, enabled ? 5 : 1]);
    await this.updateCapabilityValue('onoff', true);
    if (this.hasCapability(NIGHTLIGHT_CAPABILITY)) await this.updateCapabilityValue(NIGHTLIGHT_CAPABILITY, enabled);
    this.log(`Night Light ${enabled ? 'started' : 'disabled; normal light restored'}`);
    return true;
  }

  async startScene(scene) {
    return this.queueLampCommand(() => this._startScene(scene));
  }

  async _startScene(scene) {
    if (!Object.prototype.hasOwnProperty.call(SCENES, scene)) throw new Error('Unsupported lamp scene');
    const replacing = this._sceneActive;
    // set_scene also starts an off lamp, avoiding a flash at its previous brightness.
    await this.callSceneCommand('set_scene', ['cf', ...SCENES[scene]]);
    this._sceneActive = scene;
    await this.updateCapabilityValue('onoff', true);
    if (this.hasCapability(NIGHTLIGHT_CAPABILITY)) await this.updateCapabilityValue(NIGHTLIGHT_CAPABILITY, false);
    this.log(`Lamp ${scene} ${replacing ? 'replaced previous effect' : 'started'}`);
    return true;
  }

  async stopScene() {
    return this.queueLampCommand(() => this._stopScene());
  }

  async _stopScene() {
    await this.callSceneCommand('stop_cf', []);
    this._sceneActive = false;
    this.log('Lamp effect stopped');
    return true;
  }

  async setScene(scene) {
    if (scene === 'night_light') return this.setNightLight(true);
    if (scene === 'normal') return this.setNightLight(false);
    if (scene === 'stop') return this.stopScene();
    return this.startScene(scene);
  }

  queueLampCommand(command) {
    // A manual change must not overtake an in-flight scene start or its stop command.
    const pending = (this._lampCommandQueue || Promise.resolve()).then(() => {
      if (this._wifiStopped) throw new Error('Lamp is no longer active');
      return command();
    });
    this._lampCommandQueue = pending.catch(() => {});
    return pending;
  }

  async ensureCapability(capability) {
    if (!this.hasCapability(capability)) {
      await this.addCapability(capability);
    }
  }

  async setMiotProperty(property, value) {
    return this.queueLampCommand(() => this._setMiotProperty(property, value));
  }

  async _setMiotProperty(property, value) {
    try {
      if (this._sceneActive) {
        const restorePower = this._sceneActive === 'sunset' && property !== 'power' && this.getCapabilityValue('onoff') === true;
        await this._stopScene();
        if (restorePower) await this.callSceneCommand('set_power', ['on', 'smooth', 500, 1]);
      }
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => { this.error(error); });
        this.createDevice();
        return Promise.reject('Device unreachable, please try again ...');
      }

      const definition = this.deviceProperties.set_properties[property];
      const payload = [{ siid: definition.siid, piid: definition.piid, value }];
      const connection = this.miio;
      let result;
      if (this._useLegacyProtocol) {
        return await this.setLegacyProperty(connection, property, value);
      }
      try {
        result = await connection.call('set_properties', payload, { retries: 1 });
      } catch (error) {
        await this.tryLegacyProtocol(connection, error);
        return await this.setLegacyProperty(connection, property, value);
      }
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

  async readLegacyProperties(connection) {
    const values = await connection.call('get_prop', LEGACY_POLL_PROPERTIES, { retries: 1 });
    const numeric = (value, min, max) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
      && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
    if (!Array.isArray(values) || values.length !== LEGACY_POLL_PROPERTIES.length
      || !['on', 'off'].includes(values[0])
      || !numeric(values[1], 1, 100)) {
      throw new Error('Invalid Yeelight bslamp2 legacy status response');
    }
    const parsed = [values[0] === 'on', Number(values[1]),
      numeric(values[2], 1700, 6500) ? Number(values[2]) : undefined,
      numeric(values[3], 0, 0xffffff) ? Number(values[3]) : undefined,
      numeric(values[4], 1, 3) ? Number(values[4]) : undefined,
      numeric(values[5], 0, 1) ? Number(values[5]) === 1 : undefined];
    return parsed.map((value, index) => ({
      did: ['power', 'brightness', 'color_temperature', 'color', 'mode', 'nightlight'][index], code: 0, value
    }));
  }

  async tryLegacyProtocol(connection, miotError) {
    // Some bslamp2 firmware exposes MIoT via MiCloud but still accepts local legacy miIO.
    // Confirm a read before switching commands; a timeout alone does not identify the protocol.
    if (this._wifiStopped || this.miio !== connection
      || !['timeout', -32601].includes(miotError.code)) throw miotError;
    let result;
    try {
      result = await this.readLegacyProperties(connection);
    } catch (legacyError) {
      throw new Error(`MIoT failed: ${miotError.message}; legacy Yeelight probe failed: ${legacyError.message}`);
    }
    if (this._wifiStopped || this.miio !== connection) throw miotError;
    if (!this._useLegacyProtocol) {
      this.log(`Yeelight bslamp2 switching to legacy commands after MIoT failure: ${miotError.message}`);
      this._useLegacyProtocol = true;
    }
    return result;
  }

  async setLegacyProperty(connection, property, value) {
    if (this._wifiStopped || this.miio !== connection) throw new Error('Lamp connection changed before command');
    const commands = {
      power: ['set_power', value ? 'on' : 'off'],
      brightness: ['set_bright', value],
      color_temperature: ['set_ct_abx', value],
      color: ['set_rgb', value]
    };
    let command = commands[property];
    if (property === 'mode') {
      command = Number(value) === MIOT_MODE_COLOR
        ? ['set_rgb', this.getRgbIntFromCapabilities({})]
        : ['set_ct_abx', this.toMiotColorTemperature(this.toCapabilityValue(this.getCapabilityValue('light_temperature'), 0))];
    }
    const [method, parameter] = command;
    const result = await connection.call(method, [parameter, 'smooth', 500], { retries: 1 });
    if (!Array.isArray(result) || result.length !== 1 || result[0] !== 'ok') {
      throw new Error(`Yeelight bslamp2 ${method} did not return ok`);
    }
    return result;
  }

  async readProperties() {
    const connection = this.miio;
    if (this._useLegacyProtocol) return this.readLegacyProperties(connection);
    try {
      const result = await connection.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (this.hasCapability(NIGHTLIGHT_CAPABILITY) && !this._wifiStopped && this.miio === connection) {
        try {
          const night = await connection.call('get_prop', ['active_mode'], { retries: 1 });
          if (Array.isArray(night) && night.length === 1 && [0, 1, '0', '1'].includes(night[0])) {
            result.push({ did: 'nightlight', code: 0, value: Number(night[0]) === 1 });
          }
        } catch (error) {
          if (!this._wifiStopped && !this._nightlightPollWarning) {
            this.log(`Night Light status read failed; retaining basic lamp controls: ${error.message}`);
            this._nightlightPollWarning = true;
          }
        }
      }
      return result;
    } catch (error) {
      return this.tryLegacyProtocol(connection, error);
    }
  }

  async onLightCapabilities(valueObj) {
    if (typeof valueObj.dim !== 'undefined') {
      const brightness = Math.round(this.util.clamp(valueObj.dim * 100, 1, 100));
      await this.setMiotProperty('brightness', brightness);
    }

    if (valueObj.light_mode === 'color' || typeof valueObj.light_hue !== 'undefined' || typeof valueObj.light_saturation !== 'undefined') {
      if (!this._useLegacyProtocol || (valueObj.light_hue === undefined && valueObj.light_saturation === undefined)) {
        await this.setMiotProperty('mode', MIOT_MODE_COLOR);
      }
      await this.updateCapabilityValue('light_mode', 'color');
    } else if (valueObj.light_mode === 'temperature' || typeof valueObj.light_temperature !== 'undefined') {
      if (!this._useLegacyProtocol || valueObj.light_temperature === undefined) {
        await this.setMiotProperty('mode', MIOT_MODE_DAY);
      }
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
    return Number(mode) === MIOT_MODE_COLOR || (this._useLegacyProtocol && Number(mode) === 3) ? 'color' : 'temperature';
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
    if (this._wifiStopped || this.isRetrievingDeviceData) return;
    this.isRetrievingDeviceData = true;

    try {
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => { this.error(error); });
        this.createDevice();
        return;
      }

      const result = await this.readProperties();
      if (this._wifiStopped) return;
      if (!this.getAvailable()) await this.setAvailable();

      const property = (did) => result.find((item) => item.did === did);
      const power = this.normalizePollValue(property('power'));
      const brightness = this.normalizePollValue(property('brightness'));
      const colorTemperature = this.normalizePollValue(property('color_temperature'));
      const color = this.normalizePollValue(property('color'));
      const mode = this.normalizePollValue(property('mode'));
      const nightlight = property('nightlight');

      if (power !== undefined) await this.updateCapabilityValue('onoff', power);
      if (brightness !== undefined) await this.updateCapabilityValue('dim', this.util.clamp(brightness / 100, 0.01, 1));
      if (mode !== undefined) await this.updateCapabilityValue('light_mode', this.toHomeyLightMode(mode));
      if (colorTemperature !== undefined) await this.updateCapabilityValue('light_temperature', this.toHomeyColorTemperature(colorTemperature));
      if (color !== undefined) await this.updateColorCapabilities(color);
      if (this.hasCapability(NIGHTLIGHT_CAPABILITY) && (power === false || typeof nightlight?.value === 'boolean')) {
        await this.updateCapabilityValue(NIGHTLIGHT_CAPABILITY, power === false ? false : nightlight.value);
      }
    } catch (error) {
      if (this._wifiStopped) return;
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
