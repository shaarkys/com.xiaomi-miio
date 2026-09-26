'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// yeelink.light.ceiling5 // Yeelight Ceiling Light (legacy miIO, no MIoT get_properties support)

const COLOR_TEMPERATURE_MIN = 2700;
const COLOR_TEMPERATURE_MAX = 6500;
const TRANSITION_MS = 500;
const POWER_MODE_NORMAL = 1;
const POWER_MODE_NIGHTLIGHT = 5;
const ACTIVE_MODE_NIGHTLIGHT = 1;

class YeelightCeilingLight5Device extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      this.bootSequence();

      if (!this.hasCapability('onoff.nightlight')) {
        await this.addCapability('onoff.nightlight');
      }

      this.registerCapabilityListener('onoff', (value) => {
        return this.sendCommand('set_power', value ? ['on', 'smooth', TRANSITION_MS] : ['off', 'smooth', TRANSITION_MS]);
      });

      this.registerCapabilityListener('onoff.nightlight', async (value) => {
        const result = await this.sendCommand('set_power', ['on', 'smooth', TRANSITION_MS, value ? POWER_MODE_NIGHTLIGHT : POWER_MODE_NORMAL]);
        await this.updateCapabilityValue('onoff', true);
        return result;
      });

      this.registerCapabilityListener('dim', (value) => {
        const brightness = Math.round(this.util.clamp(value * 100, 1, 100));
        return this.sendCommand('set_bright', [brightness, 'smooth', TRANSITION_MS]);
      });

      this.registerCapabilityListener('light_temperature', (value) => {
        const colorTemperature = this.util.clamp(this.util.denormalize(value, COLOR_TEMPERATURE_MIN, COLOR_TEMPERATURE_MAX), COLOR_TEMPERATURE_MIN, COLOR_TEMPERATURE_MAX);
        return this.sendCommand('set_ct_abx', [colorTemperature, 'smooth', TRANSITION_MS]);
      });

    } catch (error) {
      this.error(error);
    }
  }

  async sendCommand(method, params) {
    try {
      if (!this.miio) {
        this.setUnavailable(this.homey.__('unreachable')).catch((error) => { this.error(error); });
        this.createDevice();
        return Promise.reject('Device unreachable, please try again ...');
      }

      return await this.miio.call(method, params, { retries: 1 });
    } catch (error) {
      this.error(`Yeelight ceiling5 ${method} ${JSON.stringify(params)} failed`);
      this.error(error);
      return Promise.reject(error);
    }
  }

  async retrieveDeviceData() {
    try {
      const result = await this.miio.call('get_prop', ['power', 'bright', 'ct', 'nl_br', 'active_mode'], { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      const [power, bright, ct, nightlightBright, activeMode] = result;
      const nightlight = Number(activeMode) === ACTIVE_MODE_NIGHTLIGHT;
      const brightness = nightlight ? Number(nightlightBright) : Number(bright);

      await this.updateCapabilityValue('onoff', power === 'on');
      await this.updateCapabilityValue('onoff.nightlight', nightlight);
      if (brightness > 0) {
        await this.updateCapabilityValue('dim', this.util.clamp(brightness / 100, 0.01, 1));
      }
      if (Number(ct) > 0) {
        const temperature = 1 - this.util.normalize(Number(ct), COLOR_TEMPERATURE_MIN, COLOR_TEMPERATURE_MAX);
        await this.updateCapabilityValue('light_temperature', this.util.clamp(Number(temperature.toFixed(2)), 0, 1));
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

module.exports = YeelightCeilingLight5Device;
