'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

const CAPABILITIES = [
  'ricecooker_status',
  'ricecooker_program',
  'ricecooker_start',
  'ricecooker_cancel',
  'ricecooker_auto_keep_warm',
  'measure_temperature',
  'measure_ricecooker_remaining_time',
  'measure_ricecooker_cooking_time',
  'measure_ricecooker_keep_warm_time',
  'alarm_ricecooker_fault'
];

const PROPERTIES = [
  { did: 'status', siid: 2, piid: 1 },
  { did: 'fault', siid: 2, piid: 2 },
  { did: 'auto_keep_warm', siid: 2, piid: 3 },
  { did: 'extended_status', siid: 4, piid: 17 },
  { did: 'menu', siid: 4, piid: 19 },
  { did: 'cooking_time', siid: 4, piid: 20 },
  { did: 'remaining_time', siid: 4, piid: 21 },
  { did: 'scheduled_time', siid: 4, piid: 22 },
  { did: 'keep_warm_time', siid: 4, piid: 23 },
  { did: 'extended_auto_keep_warm', siid: 4, piid: 27 },
  { did: 'extended_fault', siid: 4, piid: 29 },
  { did: 'temperature', siid: 4, piid: 30 }
];

const STATUS_VALUES = {
  1: 'standby',
  2: 'cooking',
  3: 'keep_warm',
  4: 'scheduled',
  6: 'scheduled'
};

const FAULTS = {
  0: 'No fault',
  9: 'Top temperature sensor fault',
  10: 'Bottom temperature sensor fault',
  11: 'Power or wiring fault'
};

class ChunmiRiceCookerDevice extends Device {
  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      await this.ensureCapabilities();
      if (!this.getCapabilityValue('ricecooker_program')) {
        await this.setCapabilityValue('ricecooker_program', this.getStoreValue('selected_program') || '1');
      }

      this.registerCapabilityListener('ricecooker_program', async (value) => {
        const program = this.normalizeProgram(value);
        await this.setStoreValue('selected_program', program);
        await this.setCapabilityValue('ricecooker_program', program);
      });

      this.registerCapabilityListener('ricecooker_start', async () => {
        return this.startCooking(this.getCapabilityValue('ricecooker_program') || '1');
      });

      this.registerCapabilityListener('ricecooker_cancel', async () => {
        return this.cancelCooking();
      });

      this.registerCapabilityListener('ricecooker_auto_keep_warm', async (value) => {
        return this.setAutoKeepWarm(value);
      });

      await this.bootSequence();
    } catch (error) {
      this.error(error);
      throw error;
    }
  }

  async ensureCapabilities() {
    for (const capability of CAPABILITIES) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
  }

  normalizeProgram(value) {
    const program = String(value);
    if (!['1', '2', '3', '4'].includes(program)) throw new Error(`Unsupported cooking program ${program}`);
    return program;
  }

  async startCooking(value) {
    const program = this.normalizeProgram(value);
    await this.setStoreValue('selected_program', program);
    await this.setCapabilityValue('ricecooker_program', program);
    return this.runAction({ siid: 2, aiid: 1, did: 'call-2-1', in: [Number(program)] });
  }

  async cancelCooking() {
    return this.runAction({ siid: 2, aiid: 2, did: 'call-2-2', in: [] });
  }

  async setAutoKeepWarm(enabled) {
    const value = enabled ? 1 : 2;
    const result = await this.setMiotProperty(2, 3, value);
    await this.setCapabilityValue('ricecooker_auto_keep_warm', Boolean(enabled));
    return result;
  }

  async setMiotProperty(siid, piid, value) {
    if (!this.miio) throw new Error(this.homey.__('unreachable'));
    const result = await this.miio.call('set_properties', [{ siid, piid, value }], { retries: 1 });
    const failed = Array.isArray(result) ? result.find(item => item && item.code !== 0) : null;
    if (!Array.isArray(result) || failed) {
      throw new Error(`MIoT set_properties failed: ${failed ? failed.code : 'invalid response'}`);
    }
    return result;
  }

  async runAction(payload) {
    if (!this.miio) throw new Error(this.homey.__('unreachable'));
    const result = await this.miio.call('action', payload, { retries: 1 });
    if (result && typeof result.code === 'number' && result.code !== 0) {
      throw new Error(`MIoT action failed: ${result.code}`);
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

      const result = await this.miio.call('get_properties', PROPERTIES, { retries: 1 });
      if (!Array.isArray(result)) throw new Error('Invalid MIoT get_properties response');

      const values = new Map();
      for (const property of result) {
        if (property && property.code === 0 && property.did) values.set(property.did, property.value);
      }
      if (!values.has('status') && !values.has('extended_status')) {
        throw new Error('The rice cooker returned no readable status');
      }

      const rawStatus = Number(values.get('extended_status') ?? values.get('status'));
      const status = STATUS_VALUES[rawStatus] || 'unknown';
      await this.updateCapabilityValue('ricecooker_status', status);

      if (values.has('auto_keep_warm') || values.has('extended_auto_keep_warm')) {
        const rawKeepWarm = Number(values.get('auto_keep_warm') ?? values.get('extended_auto_keep_warm'));
        await this.updateCapabilityValue('ricecooker_auto_keep_warm', rawKeepWarm === 1);
      }

      await this.updateNumber('measure_temperature', values.get('temperature'));
      await this.updateNumber('measure_ricecooker_cooking_time', values.get('cooking_time'));
      await this.updateNumber('measure_ricecooker_keep_warm_time', values.get('keep_warm_time'));

      if (status === 'standby' || status === 'keep_warm') {
        await this.updateNumber('measure_ricecooker_remaining_time', 0);
      } else if (status === 'scheduled' && values.has('scheduled_time')) {
        await this.updateNumber('measure_ricecooker_remaining_time', values.get('scheduled_time'));
      } else if (values.has('remaining_time')) {
        const remainingMinutes = Math.ceil(Number(values.get('remaining_time')) / 60);
        await this.updateNumber('measure_ricecooker_remaining_time', remainingMinutes);
      }

      const rawFault = Number(values.get('extended_fault') ?? values.get('fault') ?? 0);
      const fault = Number.isFinite(rawFault) ? rawFault : 0;
      await this.updateCapabilityValue('alarm_ricecooker_fault', fault !== 0);
      await this.updateSettingValue('error', FAULTS[fault] || `Unknown fault: ${fault}`);

      await this.handleStateTransitions(rawStatus, status, fault);
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

  async updateNumber(capability, value) {
    if (value === undefined || !this.hasCapability(capability)) return;
    const number = Number(value);
    if (Number.isFinite(number)) await this.updateCapabilityValue(capability, number);
  }

  async handleStateTransitions(rawStatus, status, fault) {
    const previousStatus = this.getStoreValue('previous_status');
    const previousFault = Number(this.getStoreValue('previous_fault') || 0);
    await this.setStoreValue('previous_status', rawStatus);
    await this.setStoreValue('previous_fault', fault);

    if (previousStatus !== null && previousStatus !== undefined) {
      if (status === 'cooking' && Number(previousStatus) !== 2) {
        await this.homey.flow.getDeviceTriggerCard('ricecookerStarted').trigger(this, {}, {}).catch(error => this.error(error));
      }
      if ((status === 'standby' || status === 'keep_warm') && Number(previousStatus) === 2) {
        await this.homey.flow.getDeviceTriggerCard('ricecookerFinished').trigger(this, {}, {}).catch(error => this.error(error));
      }
    }

    if (fault !== 0 && fault !== previousFault) {
      const faultText = FAULTS[fault] || `Unknown fault: ${fault}`;
      await this.homey.flow.getDeviceTriggerCard('ricecookerFault').trigger(this, { fault: faultText }, {}).catch(error => this.error(error));
    }
  }
}

module.exports = ChunmiRiceCookerDevice;
