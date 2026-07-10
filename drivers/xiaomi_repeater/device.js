'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

const MODEL_RD10M = 'xiaomi.repeater.rd10m';

const ALL_CAPABILITIES = [
  'measure_repeater_download_speed',
  'measure_repeater_upload_speed',
  'measure_repeater_connected_devices',
  'measure_repeater_signal_strength',
  'repeater_status',
  'alarm_repeater_fault',
  'repeater_indicator_light',
  'repeater_indicator_brightness',
  'repeater_wifi_roaming'
];

const LEGACY_CAPABILITIES = [
  'measure_repeater_connected_devices',
  'measure_repeater_signal_strength',
  'repeater_wifi_roaming'
];

const RD10M_CAPABILITIES = [
  'measure_repeater_download_speed',
  'measure_repeater_upload_speed',
  'measure_repeater_connected_devices',
  'repeater_status',
  'alarm_repeater_fault',
  'repeater_indicator_light',
  'repeater_indicator_brightness'
];

const RD10M_PROPERTIES = [
  { did: 'download_speed', siid: 2, piid: 1 },
  { did: 'upload_speed', siid: 2, piid: 2 },
  { did: 'connected_devices', siid: 2, piid: 3 },
  { did: 'status', siid: 2, piid: 4 },
  { did: 'fault', siid: 2, piid: 5 },
  { did: 'indicator_light', siid: 3, piid: 1 },
  { did: 'indicator_brightness', siid: 3, piid: 3 }
];

class XiaomiRepeaterDevice extends Device {
  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      await this.ensureModelCapabilities();
      this.registerRepeaterCapabilityListeners();
      await this.bootSequence();
    } catch (error) {
      this.error(error);
      throw error;
    }
  }

  get isRd10m() {
    return this.getStoreValue('model') === MODEL_RD10M;
  }

  async ensureModelCapabilities() {
    const expected = new Set(this.isRd10m ? RD10M_CAPABILITIES : LEGACY_CAPABILITIES);

    for (const capability of ALL_CAPABILITIES) {
      if (expected.has(capability) && !this.hasCapability(capability)) {
        await this.addCapability(capability);
      } else if (!expected.has(capability) && this.hasCapability(capability)) {
        await this.removeCapability(capability);
      }
    }
  }

  registerRepeaterCapabilityListeners() {
    if (this.hasCapability('repeater_indicator_light')) {
      this.registerCapabilityListener('repeater_indicator_light', async (value) => {
        await this.setRd10mProperty(3, 1, Boolean(value));
        await this.setCapabilityValue('repeater_indicator_light', Boolean(value));
      });
    }

    if (this.hasCapability('repeater_indicator_brightness')) {
      this.registerCapabilityListener('repeater_indicator_brightness', async (value) => {
        const brightness = Math.max(1, Math.min(100, Math.round(Number(value))));
        await this.setRd10mProperty(3, 3, brightness);
        await this.setCapabilityValue('repeater_indicator_brightness', brightness);
      });
    }

    if (this.hasCapability('repeater_wifi_roaming')) {
      this.registerCapabilityListener('repeater_wifi_roaming', async (value) => {
        if (!this.miio) throw new Error(this.homey.__('unreachable'));
        await this.miio.call('miIO.switch_wifi_explorer', [{ wifi_explorer: value ? 1 : 0 }], { retries: 1 });
        await this.setCapabilityValue('repeater_wifi_roaming', Boolean(value));
      });
    }
  }

  async setRd10mProperty(siid, piid, value) {
    if (!this.miio) throw new Error(this.homey.__('unreachable'));

    const result = await this.miio.call('set_properties', [{ siid, piid, value }], { retries: 1 });
    const failure = Array.isArray(result)
      ? result.find((item) => item && item.code !== 0)
      : null;
    if (!Array.isArray(result) || failure) {
      const code = failure ? failure.code : 'invalid response';
      throw new Error(`MIoT set_properties failed: ${code}`);
    }
    return result;
  }

  async retrieveDeviceData() {
    try {
      if (!this.miio) {
        await this.setUnavailable(this.homey.__('unreachable'));
        this.createDevice();
        return;
      }

      if (this.isRd10m) {
        await this.retrieveRd10mData();
      } else {
        await this.retrieveLegacyData();
      }

      if (!this.getAvailable()) await this.setAvailable();
    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);
      if (this.getAvailable()) {
        await this.setUnavailable(`${this.homey.__('device.unreachable')}${error.message}`);
      }
      this.recreateTimeout = this.homey.setTimeout(() => this.createDevice(), 60000);
      try {
        this.miio?.destroy();
      } catch (_) {
        // Ignore cleanup errors after a failed poll.
      }
      this.miio = null;
      this.error(error);
    }
  }

  async retrieveRd10mData() {
    const result = await this.miio.call('get_properties', RD10M_PROPERTIES, { retries: 1 });
    if (!Array.isArray(result)) throw new Error('Invalid MIoT get_properties response');

    const values = new Map();
    for (const property of result) {
      if (property && property.code === 0 && property.did) values.set(property.did, property.value);
    }
    if (values.size === 0) throw new Error('The repeater returned no readable MIoT properties');

    await this.updateIfPresent('measure_repeater_download_speed', values, 'download_speed', Number);
    await this.updateIfPresent('measure_repeater_upload_speed', values, 'upload_speed', Number);
    await this.updateIfPresent('measure_repeater_connected_devices', values, 'connected_devices', Number);
    await this.updateIfPresent('alarm_repeater_fault', values, 'fault', (value) => Number(value) !== 0);
    await this.updateIfPresent('repeater_indicator_light', values, 'indicator_light', Boolean);
    await this.updateIfPresent('repeater_indicator_brightness', values, 'indicator_brightness', Number);

    if (values.has('status')) {
      const statuses = { 1: 'idle', 2: 'busy', 3: 'delay' };
      const status = statuses[Number(values.get('status'))] || 'unknown';
      await this.updateCapabilityValue('repeater_status', status);
    }
  }

  async retrieveLegacyData() {
    const stationInfo = await this.miio.call('miIO.get_repeater_sta_info', [], { retries: 1 });
    const stationCount = Number(stationInfo?.sta?.count);
    const connectedDevices = Number.isFinite(stationCount)
      ? stationCount
      : (Array.isArray(stationInfo?.mat) ? stationInfo.mat.length : 0);
    await this.updateCapabilityValue('measure_repeater_connected_devices', connectedDevices);

    try {
      const info = await this.miio.call('miIO.info', [], { retries: 1 });
      const rssi = Number(info?.ap?.rssi ?? info?.accesspoint?.rssi);
      if (Number.isFinite(rssi)) {
        await this.updateCapabilityValue('measure_repeater_signal_strength', rssi);
      }
      const roaming = info?.desc?.wifi_explorer;
      if (roaming !== undefined) {
        await this.updateCapabilityValue('repeater_wifi_roaming', Number(roaming) === 1);
      }
    } catch (error) {
      this.log(`Repeater details are unavailable: ${error.message}`);
    }
  }

  async updateIfPresent(capability, values, property, transform) {
    if (!values.has(property) || !this.hasCapability(capability)) return;
    const value = transform(values.get(property));
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    await this.updateCapabilityValue(capability, value);
  }
}

module.exports = XiaomiRepeaterDevice;
