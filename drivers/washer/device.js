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
      { did: 'has_washed_times', siid: 2, piid: 13 },
      { did: 'detergent_left_level', siid: 8, piid: 1 },
      { did: 'softener_left_level', siid: 9, piid: 1 },
    ],
  },
};

const washerCapabilities = [
  'xiaomi_washer_start',
  'xiaomi_washer_pause',
  'xiaomi_washer_stop',
  'measure_washer_left_time',
  'xiaomi_washer_mode',
  'xiaomi_washer_spin_speed',
  'xiaomi_washer_washed_times',
  'xiaomi_washer_door_state',
  'alarm_washer_door_locked',
  'xiaomi_washer_detergent_level',
  'xiaomi_washer_softener_level',
  'alarm_washer_detergent_low',
  'alarm_washer_softener_low',
];

const washerActions = {
  start: { siid: 2, aiid: 2, did: 'call-2-2', in: [] },
  pause: { siid: 2, aiid: 3, did: 'call-2-3', in: [] },
  stop: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
};

const doorStateIds = new Set(['0', '2', '3', '4', '5', '6', '7']);
const doorLockedStates = new Set([3, 4, 5, 6, 7]);

const levelEnum = {
  1: 'low',
  2: 'normal',
};

class WasherMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({ homey: this.homey });

      await this.ensureWasherCapabilities();
      await this.cleanupWasherCapabilities();

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
    } catch (error) {
      this.error(error);
    }
  }

  async ensureWasherCapabilities() {
    for (const capability of washerCapabilities) {
      if (!this.hasCapability(capability)) {
        this.log(`Adding washer capability ${capability}`);
        try {
          await this.addCapability(capability);
          this.log(`Added washer capability ${capability}`);
        } catch (error) {
          this.error(`Failed to add washer capability ${capability}`, error);
        }
      }
    }
  }

  async cleanupWasherCapabilities() {
    // meter_power / meter_water stay removed: those local MIoT values read as 0.
    for (const capability of ['xiaomi_washer_left_time', 'meter_water', 'meter_power']) {
      if (this.hasCapability(capability)) {
        await this.removeCapability(capability).catch(error => this.error(error));
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

  async updateConsumableLevel(raw, enumCapability, alarmCapability, triggerId) {
    // Unknown readings must not clear an alarm or create a later false transition.
    if (this._wifiStopped || (raw !== 1 && raw !== 2)) return;
    const enumValue = levelEnum[raw];
    await this.updateCapabilityValue(enumCapability, enumValue);

    if (this._wifiStopped || !this.hasCapability(alarmCapability)) return;
    const isLow = raw === 1;
    const previousLow = this.getCapabilityValue(alarmCapability);
    if (previousLow === isLow) return;
    try {
      await this.setCapabilityValue(alarmCapability, isLow);
    } catch (error) {
      this.error(`Failed to update washer capability ${alarmCapability}`, error);
      return;
    }

    // Only fire when the level actually drops to low after we have seen it normal.
    if (!this._wifiStopped && isLow && previousLow === false) {
      await this.homey.flow.getDeviceTriggerCard(triggerId).trigger(this, {}, {}).catch(error => this.error(error));
    }
  }

  async retrieveDeviceData() {
    if (this._wifiStopped || this.isRetrievingDeviceData) return;
    this.isRetrievingDeviceData = true;
    const connection = this.miio;
    try {
      const result = await connection.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (this._wifiStopped || this.miio !== connection) return;
      if (!Array.isArray(result)) throw new Error('Invalid washer get_properties response');
      if (!this.getAvailable()) await this.setAvailable();

      // Match MIoT addresses: devices may echo a physical DID instead of our label.
      const property = (did) => {
        const definition = this.deviceProperties.get_properties.find(entry => entry.did === did);
        return result.find(obj => obj && obj.siid === definition.siid && obj.piid === definition.piid
          && obj.code === 0 && obj.value !== undefined && obj.value !== null);
      };
      const power = property('power');
      const status = property('status');
      const fault = property('fault');
      const mode = property('mode');
      const spinSpeed = property('spin_speed');
      const targetTemperature = property('target_temperature');
      const leftTime = property('left_time');
      const washedTimes = property('has_washed_times');
      const doorState = property('door_state');
      const detergentLevel = property('detergent_left_level');
      const softenerLevel = property('softener_left_level');

      if (power !== undefined) {
        await this.updateCapabilityValue('onoff', power.value === true || power.value === 1);
      }

      if (leftTime !== undefined) {
        await this.updateCapabilityValue('measure_washer_left_time', leftTime.value);
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

      if (washedTimes && Number.isInteger(washedTimes.value) && washedTimes.value >= 0 && washedTimes.value <= 65535) {
        await this.updateCapabilityValue('xiaomi_washer_washed_times', washedTimes.value);
      }

      if (doorState && Number.isInteger(doorState.value)) {
        const doorId = doorState.value.toString();
        await this.updateCapabilityValue('xiaomi_washer_door_state', doorStateIds.has(doorId) ? doorId : 'unknown');
        if (doorStateIds.has(doorId)) {
          await this.updateCapabilityValue('alarm_washer_door_locked', doorLockedStates.has(doorState.value));
        }
      }

      if (detergentLevel) {
        await this.updateConsumableLevel(
          detergentLevel.value,
          'xiaomi_washer_detergent_level',
          'alarm_washer_detergent_low',
          'washerDetergentLow'
        );
      }

      if (softenerLevel) {
        await this.updateConsumableLevel(
          softenerLevel.value,
          'xiaomi_washer_softener_level',
          'alarm_washer_softener_low',
          'washerSoftenerLow'
        );
      }

      if (fault !== undefined) {
        const errorStr = this.errorCodes[fault.value] || `Unknown error: ${fault.value}`;
        await this.updateSettingValue('error', errorStr);
      }

      if (status !== undefined) {
        await this.handleStatusChange(status.value);
      }
    } catch (error) {
      if (this._wifiStopped || this.miio !== connection) return;
      this.homey.clearInterval(this.pollingInterval);
      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch(err => this.error(err));
      }
      this.homey.setTimeout(() => {
        this.createDevice();
      }, 60000);
      this.error(error.message);
    } finally {
      this.isRetrievingDeviceData = false;
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

    if (currentStatus === 3 && previousStatus !== 3) {
      this.homey.flow.getDeviceTriggerCard('washerStarted').trigger(this, {}, {}).catch(error => this.error(error));
    }

    if (currentStatus === 5 && previousStatus !== 5) {
      this.homey.flow.getDeviceTriggerCard('washerFinished').trigger(this, {}, {}).catch(error => this.error(error));
    }
  }
}

module.exports = WasherMiotDevice;
