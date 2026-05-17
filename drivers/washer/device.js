'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

const mapping = {
  'mibx5.washer.f05gl': 'properties_default',
  'mibx5.washer.*': 'properties_default',
};

const properties = {
  properties_default: {
    get_properties: [
      { did: 'power', siid: 2, piid: 1 },
      { did: 'status', siid: 2, piid: 2 },
      { did: 'mode', siid: 2, piid: 3 },
      { did: 'fault', siid: 2, piid: 4 },
      { did: 'target_temperature', siid: 2, piid: 5 },
      { did: 'spin_speed', siid: 2, piid: 7 },
      { did: 'door_state', siid: 2, piid: 9 },
      { did: 'left_time', siid: 2, piid: 10 },
      { did: 'run_status', siid: 2, piid: 11 },
    ],
  },
};

// Hier is jouw lijstje gecombineerd met de nieuwe structuur van shaarkys
const washerCapabilities = [
  'onoff',
  'xiaomi_washer_start',
  'xiaomi_washer_pause',
  'xiaomi_washer_stop',
  'measure_washer_left_time', // Jouw measure_ prefix update
  'measure_temperature',      // Jouw toevoeging
  'xiaomi_washer_mode',
  'xiaomi_washer_spin_speed',
];

const washerActions = {
  start: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
  pause: { siid: 2, aiid: 3, did: 'call-2-3', in: [] },
  stop: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
};

class WasherMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      // Checkt dynamisch de capabilities op basis van de lijst bovenaan
      await this.ensureWasherCapabilities();

      // Jouw opruimfunctie voor de overbodige energiemeters
      if (this.hasCapability('meter_water')) {
        await this.removeCapability('meter_water').catch(error => this.error(error));
      }
      if (this.hasCapability('meter_power')) {
        await this.removeCapability('meter_power').catch(error => this.error(error));
      }

      this.bootSequence();

      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] || properties[mapping['mibx5.washer.*']];

      this.errorCodes = {
        0: 'No Faults',
        1: 'Door Lock Malfunction',
        2: 'Water Intake Malfunction',
        3: 'Water Draining Malfunction',
        4: 'Water Level Sensor Malfunction',
        5: 'Overflow',
        6: 'Motor Driver Communication Malfunction',
        7: 'Motor Fault C2',
        16: 'Dehydration Fault (Unbalanced)',
        17: 'Drying Heating Tube Malfunction',
        18: 'Drying Fan Malfunction',
      };

      this.registerCapabilityListener('onoff', async (value) => {
        return this.setMiotProperty(2, 1, value);
      });

      this.registerCapabilityListener('xiaomi_washer_mode', async (value) => {
        return this.setMiotProperty(2, 3, parseInt(value, 10));
      });

      this.registerCapabilityListener('xiaomi_washer_spin_speed', async (value) => {
        return this.setMiotProperty(2, 7, parseInt(value, 10));
      });

      this.registerCapabilityListener('xiaomi_washer_start', async () => {
        return this.runWasherAction('start');
      });

      this.registerCapabilityListener('xiaomi_washer_pause', async () => {
        return this.runWasherAction('pause');
      });

      this.registerCapabilityListener('xiaomi_washer_stop', async () => {
        return this.runWasherAction('stop');
      });

      // Jouw Flow Acties, herschreven zodat ze gebruik maken van shaarkys nieuwe helpers
      this.homey.flow.getActionCard('WasherStart').registerRunListener(async (args, state) => {
        try {
          return await this.runWasherAction('start');
        } catch (error) {
          this.error(error);
          return false;
        }
      });

      this.homey.flow.getActionCard('WasherPause').registerRunListener(async (args, state) => {
        try {
          return await this.runWasherAction('pause');
        } catch (error) {
          this.error(error);
          return false;
        }
      });

      this.homey.flow.getActionCard('WasherStop').registerRunListener(async (args, state) => {
        try {
          return await this.runWasherAction('stop');
        } catch (error) {
          this.error(error);
          return false;
        }
      });

    } catch (error) {
      this.error(error);
    }
  }

  // De nieuwe helper functies van shaarkys
  async ensureWasherCapabilities() {
    for (const capability of washerCapabilities) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability).catch(error => this.error(error));
      }
    }
  }

  async setMiotProperty(siid, piid, value) {
    try {
      if (!this.miio) {
        throw new Error('Device unreachable');
      }
      return await this.miio.call('set_properties', [{ siid, piid, value }], { retries: 1 });
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

  async runWasherAction(action) {
    try {
      if (!this.miio) {
        throw new Error('Device unreachable');
      }
      return await this.miio.call('action', washerActions[action], { retries: 1 });
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    }
  }

  async retrieveDeviceData() {
    try {
      const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) await this.setAvailable();

      const power = result.find(obj => obj.did === 'power');
      const status = result.find(obj => obj.did === 'status');
      const fault = result.find(obj => obj.did === 'fault');
      const mode = result.find(obj => obj.did === 'mode');
      const spinSpeed = result.find(obj => obj.did === 'spin_speed');
      const targetTemperature = result.find(obj => obj.did === 'target_temperature');
      const leftTime = result.find(obj => obj.did === 'left_time');

      if (power !== undefined) {
        await this.updateCapabilityValue('onoff', power.value === true || power.value === 1);
      }

      if (leftTime !== undefined) {
        await this.updateCapabilityValue('measure_washer_left_time', leftTime.value); // Jouw update
      }

      if (targetTemperature !== undefined) {
        await this.updateCapabilityValue('measure_temperature', targetTemperature.value);
      }

      if (mode !== undefined) {
        await this.updateCapabilityValue('xiaomi_washer_mode', mode.value.toString());
      }

      if (spinSpeed !== undefined) {
        await this.updateCapabilityValue('xiaomi_washer_spin_speed', spinSpeed.value.toString());
      }

      if (fault !== undefined) {
        const errorStr = this.errorCodes[fault.value] || `Unknown error: ${fault.value}`;
        await this.updateSettingValue('error', errorStr);
      }

      if (status !== undefined) {
        await this.handleStatusChange(status.value);
      }
    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);
      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch(err => this.error(err));
      }
      this.homey.setTimeout(() => {
        this.createDevice();
      }, 60000);
      this.error(error.message);
    }
  }

  async handleStatusChange(currentStatus) {
    const previousStatus = this.getStoreValue('previous_status');
    if (currentStatus === previousStatus) {
      return;
    }

    await this.setStoreValue('previous_status', currentStatus);

    if (previousStatus === null || previousStatus === undefined) {
      return;
    }

    // Jouw Flow Triggers
    if (currentStatus === 3 && previousStatus !== 3) {
      this.homey.flow.getDeviceTriggerCard('WasherStarted').trigger(this, {}, {}).catch(error => this.error(error));
    }

    if (currentStatus === 5 && previousStatus !== 5) {
      this.homey.flow.getDeviceTriggerCard('WasherFinished').trigger(this, {}, {}).catch(error => this.error(error));
    }
  }
}

module.exports = WasherMiotDevice;