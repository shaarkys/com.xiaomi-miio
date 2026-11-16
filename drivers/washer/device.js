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
    return this.callWasherCommand('set_properties', [{ siid, piid, value }], siid === 2 && piid === 1 && value === false);
  }

  async runWasherAction(action) {
    if (!washerActions[action]) throw new Error(`Unsupported washer action: ${action}`);
    return this.callWasherCommand('action', washerActions[action], action === 'stop', action === 'start');
  }

  async callWasherCommand(method, payload, abortsCycle = false, startsCycle = false) {
    const connection = this.miio;
    if (abortsCycle || startsCycle) this._washerCommandRevision = (this._washerCommandRevision || 0) + 1;
    const commandRevision = this._washerCommandRevision || 0;
    if (abortsCycle) this._washerAbortPending = (this._washerAbortPending || 0) + 1;
    try {
      if (this._wifiStopped || !connection) throw new Error('Device unreachable');
      const result = await connection.call(method, payload, { retries: 1 });
      const acknowledgement = method === 'set_properties'
        ? Array.isArray(result) && result.find(entry => entry && entry.siid === payload[0].siid && entry.piid === payload[0].piid)
        : result;
      if (!acknowledgement || acknowledgement.code !== 0) {
        throw new Error(`Washer ${method} failed (code ${acknowledgement?.code ?? 'missing'})`);
      }
      if (abortsCycle || startsCycle) {
        // Keep previous_status as observed telemetry; cancellation must survive stale busy replies and restarts.
        await this.queueWasherState(async () => {
          if (this._wifiStopped || this.miio !== connection || commandRevision !== (this._washerCommandRevision || 0)) return;
          await this.setStoreValue('washer_cycle_handled', abortsCycle);
          this.log(abortsCycle ? 'Washer cycle cancelled from Homey' : 'Washer cycle started from Homey');
        });
      }
      return result;
    } catch (error) {
      this.error(error);
      return Promise.reject(error);
    } finally {
      if (abortsCycle) this._washerAbortPending--;
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
    if (this._wifiStopped || this.isRetrievingDeviceData || this._washerAbortPending) return;
    this.isRetrievingDeviceData = true;
    const connection = this.miio;
    const commandRevision = this._washerCommandRevision || 0;
    try {
      const result = await connection.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
      if (this._wifiStopped || this.miio !== connection || commandRevision !== (this._washerCommandRevision || 0)) return;
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
      const runStatus = property('run_status');
      const washedTimes = property('has_washed_times');
      const doorState = property('door_state');
      const detergentLevel = property('detergent_left_level');
      const softenerLevel = property('softener_left_level');

      const previousWashedTimes = this.getCapabilityValue('xiaomi_washer_washed_times');
      const isOn = power && (power.value === true || power.value === 1) ? true
        : power && (power.value === false || power.value === 0) ? false : undefined;
      const validWashedTimes = Boolean(
        washedTimes && Number.isInteger(washedTimes.value) && washedTimes.value >= 0 && washedTimes.value <= 65535
      );
      const washedTimesIncreased = validWashedTimes
        && Number.isInteger(previousWashedTimes)
        && (washedTimes.value > previousWashedTimes || (previousWashedTimes === 65535 && washedTimes.value === 0));

      if (isOn !== undefined) {
        await this.updateCapabilityValue('onoff', isOn);
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

      if (validWashedTimes) {
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

      let effectiveStatus = status && Number.isInteger(status.value) && status.value >= 0 && status.value <= 7
        ? status.value : undefined;
      if (isOn === false && (effectiveStatus === undefined || effectiveStatus === 3)) effectiveStatus = 0;

      if (commandRevision === (this._washerCommandRevision || 0) && this.miio === connection
        && (effectiveStatus !== undefined || runStatus || washedTimesIncreased)) {
        await this.handleStatusChange(effectiveStatus, {
          runStatus: runStatus ? runStatus.value : undefined,
          washedTimesIncreased,
        });
      }
    } catch (error) {
      if (this._wifiStopped || this.miio !== connection || commandRevision !== (this._washerCommandRevision || 0)) return;
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

  async handleStatusChange(currentStatus, { runStatus, washedTimesIncreased = false } = {}) {
    const commandRevision = this._washerCommandRevision || 0;
    return this.queueWasherState(async () => {
      const current = () => !this._wifiStopped && !this._washerAbortPending
        && commandRevision === (this._washerCommandRevision || 0);
      if (!current()) return;
      const previousStatus = this.getStoreValue('previous_status');
      let handled = this.getStoreValue('washer_cycle_handled');
      const hasPreviousStatus = Number.isInteger(previousStatus) && previousStatus >= 0 && previousStatus <= 7;
      const statusChanged = currentStatus !== undefined && currentStatus !== previousStatus;

      // Preserve an active cycle when upgrading an installation without the new latch.
      if (typeof handled !== 'boolean' && (previousStatus === 3 || previousStatus === 2)) {
        await this.setStoreValue('washer_cycle_handled', false);
        handled = false;
      }
      if (!current()) return;
      if (statusChanged) {
        await this.setStoreValue('previous_status', currentStatus);
      }
      if (!current()) return;

      if (currentStatus === 3 || currentStatus === 2) {
        if (previousStatus !== 3 && previousStatus !== 2) {
          await this.setStoreValue('washer_cycle_handled', false);
        }
        if (current() && hasPreviousStatus && currentStatus === 3 && statusChanged) {
          await this.homey.flow.getDeviceTriggerCard('washerStarted').trigger(this, {}, {}).catch(error => this.error(error));
        }
        return;
      }

      // Initial terminal readings seed state; maintenance completion is not a finished wash.
      if (!hasPreviousStatus || currentStatus === 6 || currentStatus === 7) {
        if (handled !== true) await this.setStoreValue('washer_cycle_handled', true);
        return;
      }

      if (handled === true || ((handled === null || handled === undefined) && previousStatus === 5)) return;
      const cycleWasActive = handled === false || previousStatus === 3 || previousStatus === 2;
      const explicitCompletion = currentStatus === 5 || runStatus === 15;
      // Auto-off alone also occurs after cancellation. Require an increased completed-cycle counter.
      const completedBetweenPolls = cycleWasActive && (currentStatus === 0 || currentStatus === 1) && washedTimesIncreased;
      if (explicitCompletion || completedBetweenPolls) {
        await this.setStoreValue('washer_cycle_handled', true);
        if (!current()) return;
        this.log(`Washer cycle completed (${explicitCompletion ? 'completion status' : 'cycle count increased'})`);
        await this.homey.flow.getDeviceTriggerCard('washerFinished').trigger(this, {}, {}).catch(error => this.error(error));
      }
    });
  }

  async queueWasherState(operation) {
    const pending = (this._washerStateQueue || Promise.resolve()).then(operation);
    // Return the original rejection to the caller without poisoning later state updates.
    this._washerStateQueue = pending.catch(() => {});
    return pending;
  }
}

module.exports = WasherMiotDevice;
