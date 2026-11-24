'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const { models } = require('miio');
const MiioVacuum = require('miio/lib/devices/vacuum');
const checkResult = require('miio/lib/checkResult');
const { openRoborockConnection } = require('../../lib/isolated-roborock');

/* basic supported devices */
// https://home.miot-spec.com/spec/rockrobo.vacuum.v1
// https://home.miot-spec.com/spec/rockrobo.vacuum.m1s
// https://home.miot-spec.com/spec/rockrobo.vacuum.c1
// https://home.miot-spec.com/spec/roborock.vacuum.e2
// https://home.miot-spec.com/spec/roborock.vacuum.s4
// https://home.miot-spec.com/spec/roborock.vacuum.s5
// https://home.miot-spec.com/spec/roborock.vacuum.s5e
// https://home.miot-spec.com/spec/roborock.vacuum.s6
// https://home.miot-spec.com/spec/roborock.vacuum.t6
// https://home.miot-spec.com/spec/roborock.vacuum.a01
// https://home.miot-spec.com/spec/roborock.vacuum.a08
// https://home.miot-spec.com/spec/roborock.vacuum.a10
// https://home.miot-spec.com/spec/roborock.vacuum.a11
// https://home.miot-spec.com/spec/roborock.vacuum.a14
// https://home.miot-spec.com/spec/roborock.vacuum.a15
// https://home.miot-spec.com/spec/roborock.vacuum.a19
// https://home.miot-spec.com/spec/roborock.vacuum.a23
// https://home.miot-spec.com/spec/roborock.vacuum.a27
// https://home.miot-spec.com/spec/roborock.vacuum.a29
// https://home.miot-spec.com/spec/roborock.vacuum.a34
// https://home.miot-spec.com/spec/roborock.vacuum.a38
// https://home.miot-spec.com/spec/roborock.vacuum.a40
// https://home.miot-spec.com/spec/roborock.vacuum.a46
// https://home.miot-spec.com/spec/roborock.vacuum.a51
// https://home.miot-spec.com/spec/roborock.vacuum.a62
// https://home.miot-spec.com/spec/roborock.vacuum.a70
// https://home.miot-spec.com/spec/roborock.vacuum.a73
// https://home.miot-spec.com/spec/roborock.vacuum.a75

const mapping = {
  "rockrobo.vacuum.v1": "rockrobo_vacuum_v3",
  "rockrobo.vacuum.m1s": "rockrobo_vacuum_v2",
	"rockrobo.vacuum.c1": "rockrobo_vacuum_v2",
	"roborock.vacuum.e2": "rockrobo_vacuum_e2",
	"roborock.vacuum.s4": "rockrobo_vacuum_v2",
  "roborock.vacuum.t4": "rockrobo_vacuum_v2",
	"roborock.vacuum.s5": "rockrobo_vacuum_v2",
	"roborock.vacuum.s5e": "rockrobo_vacuum_v2",
	"roborock.vacuum.s6": "rockrobo_vacuum_v2",
	"roborock.vacuum.a01": "rockrobo_vacuum_v2",
  "roborock.vacuum.a08": "rockrobo_vacuum_v2",
  "roborock.vacuum.a09": "rockrobo_vacuum_v2",
	"roborock.vacuum.a10": "rockrobo_vacuum_v2",
  "roborock.vacuum.a11": "rockrobo_vacuum_v2",
  "roborock.vacuum.a14": "rockrobo_vacuum_v2",
	"roborock.vacuum.a15": "rockrobo_vacuum_s7",
	"roborock.vacuum.a19": "rockrobo_vacuum_v2",
	"roborock.vacuum.a23": "rockrobo_vacuum_v2",
  "roborock.vacuum.a26": "rockrobo_vacuum_v2",
	"roborock.vacuum.a27": "rockrobo_vacuum_s7_vmax",
	"roborock.vacuum.a29": "rockrobo_vacuum_v2",
	"roborock.vacuum.a34": "rockrobo_vacuum_v2",
	"roborock.vacuum.a38": "rockrobo_vacuum_v2",
  "roborock.vacuum.a40": "rockrobo_vacuum_v2",
	"roborock.vacuum.a46": "rockrobo_vacuum_v2",
  "roborock.vacuum.a51": "rockrobo_vacuum_v2",
  "roborock.vacuum.a62": "rockrobo_vacuum_v2",
  "roborock.vacuum.a70": "rockrobo_vacuum_v2",
  "roborock.vacuum.a73": "rockrobo_vacuum_v2",
  "roborock.vacuum.a75": "rockrobo_vacuum_v2",
  "roborock.vacuum.*": "rockrobo_vacuum_v2",
};

const properties = {
  "rockrobo_vacuum_v1": {
    "fanspeeds": {
      1: 38,
      2: 60,
      3: 77,
      4: 90,
      5: 90,
      38: 1,
      60: 2,
      77: 3,
      90: 4
    }
  },
  "rockrobo_vacuum_v2": {
    "fanspeeds": {
      1: 101,
      2: 102,
      3: 103,
      4: 104,
      5: 105,
      101: 1,
      102: 2,
      103: 3,
      104: 4,
      105: 5,
      106: 5
    }
  },
  "rockrobo_vacuum_v3": {
    "fanspeeds": {
      1: 38,
      2: 60,
      3: 75,
      4: 100,
      5: 100,
      38: 1,
      60: 2,
      75: 3,
      100: 4
    }
  },
  "rockrobo_vacuum_e2": {
    "fanspeeds": {
      1: 41,
      2: 50,
      3: 68,
      4: 79,
      5: 100,
      41: 1,
      50: 2,
      68: 3,
      79: 4,
      100: 5
    }
  },
  "rockrobo_vacuum_s7": {
    "fanspeeds": {
      1: 101,
      2: 102,
      3: 103,
      4: 104,
      5: 105,
      101: 1,
      102: 2,
      103: 3,
      104: 4,
      105: 5,
      106: 5
    }
  },
  "rockrobo_vacuum_s7_vmax": {
    "fanspeeds": {
      1: 101,
      2: 102,
      3: 103,
      4: 104,
      5: 108,
      101: 1,
      102: 2,
      103: 3,
      104: 4,
      105: 4,
      108: 5
    }
  }
}

class MiRobotAdvancedDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // DEVICE VARIABLES
      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['roborock.vacuum.*']];

      // DEVICE VARIABLES
      this.vacuumErrorCodes = {
        0: "No error",
        1: "Laser distance sensor error",
        2: "Collision sensor error",
        3: "Wheels on top of void, move robot",
        4: "Clean hovering sensors, move robot",
        5: "Clean main brush",
        6: "Clean side brush",
        7: "Main wheel stuck?",
        8: "Device stuck, clean area",
        9: "Dust collector missing",
        10: "Clean filter",
        11: "Stuck in magnetic barrier",
        12: "Low battery",
        13: "Charging fault",
        14: "Battery fault",
        15: "Wall sensors dirty, wipe them",
        16: "Place me on flat surface",
        17: "Side brushes problem, reboot me",
        18: "Suction fan problem",
        19: "Unpowered charging station",
      };

      // RESET CONSUMABLE ALARMS
      this.updateCapabilityValue("alarm_main_brush_work_time", false);
      this.updateCapabilityValue("alarm_side_brush_work_time", false);
      this.updateCapabilityValue("alarm_filter_work_time", false);
      this.updateCapabilityValue("alarm_sensor_dirty_time", false);

      // DEVICE TOKENS
      this.main_brush_lifetime_token = await this.homey.flow.createToken("main_brush_lifetime"+ this.getData().id, {type: "number", title: "Main Brush Lifetime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.side_brush_lifetime_token = await this.homey.flow.createToken("side_brush_lifetime"+ this.getData().id, {type: "number", title: "Side Brush Lifetime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.filter_lifetime_token = await this.homey.flow.createToken("filter_lifetime"+ this.getData().id, {type: "number", title: "Filter LifeTime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.sensor_dirty_lifetime_token = await this.homey.flow.createToken("sensor_dirty_lifetime"+ this.getData().id, {type: "number", title: "Sensor Dirty Time " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.total_work_time_token = await this.homey.flow.createToken("total_work_time"+ this.getData().id, {type: "number", title: "Total Work Time " + this.getName() +" h)" }).catch(error => { this.error(error) });
      this.total_cleared_area_token = await this.homey.flow.createToken("total_cleared_area"+ this.getData().id, {type: "number", title: "Total Cleaned Area " + this.getName() +" (m2)" }).catch(error => { this.error(error) });
      this.total_clean_count_token = await this.homey.flow.createToken("total_clean_count"+ this.getData().id, {type: "number", title: "Total Clean Count "+ this.getName() }).catch(error => { this.error(error) });

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('statusVacuum');
      this.homey.flow.getDeviceTriggerCard('alertVacuum');
      this.homey.flow.getDeviceTriggerCard('triggerVacuumRoomSegments');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener("onoff", this.onCapabilityOnoffVacuumcleaner.bind(this));
      this.registerCapabilityListener("vacuumcleaner_state", this.onCapabilityVacuumcleanerState.bind(this));
      this.registerCapabilityListener("vacuum_roborock_mop_intensity", this.onCapabilityVacuumMopIntensity.bind(this));
      this.registerCapabilityListener("button.consumable", this.onCapabilityButtonConsumable.bind(this));

      this.registerCapabilityListener('vacuum_roborock_fanspeed', async ( value ) => {
        try {
          if (this.miio) {
            const fanspeed = this.deviceProperties.fanspeeds[+value];
            return await this.miio.call("set_custom_mode", [fanspeed], { retries: 1 });
          } else {
            this.setUnavailable(this.homey.__('unreachable')).catch(error => { this.error(error) });
            this.createDevice();
            return Promise.reject('Device unreachable, please try again ...');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

    } catch (error) {
      this.error(error);
    }
  }

  supportsCleaningRecovery() {
    const model = this.miio?.miioModel || this.getStoreValue('model');
    return models[model] === MiioVacuum;
  }

  refreshDeviceConnection() {
    if (!this.supportsCleaningRecovery()) return super.refreshDeviceConnection();
    // createDevice coordinates the hourly replacement with Flow and poll recovery.
    return this.createDevice();
  }

  async createDevice() {
    // Startup, hourly refresh and Wi-Fi backoff can all reach this method.
    // A validated recovery fulfils their pending reconnect as well.
    if (this._statusRecovery) {
      let recovered;
      try {
        recovered = await this._statusRecovery;
      } catch {
        // The pending recovery failed. Continue with the normal Wi-Fi reconnect.
      }
      if (recovered && this.miio === recovered.connection) return;
    }
    if (!this._connectionSetup) {
      // Keep the socket alive until acknowledgement of any writes already sent.
      const setup = this._cleaningWrites?.size
        ? Promise.allSettled(this._cleaningWrites).then(() => super.createDevice())
        : super.createDevice();
      this._connectionSetup = setup.finally(() => { this._connectionSetup = null; });
    }
    return this._connectionSetup;
  }

  async onCapabilityOnoffVacuumcleaner(value, opts) {
    if (!value || !this.supportsCleaningRecovery()) return super.onCapabilityOnoffVacuumcleaner(value, opts);
    await this.runRoborockCleaning('app_start', []);
    return this.setCapabilityValue('vacuumcleaner_state', 'cleaning');
  }

  async onCapabilityVacuumcleanerState(value, opts) {
    if (!['cleaning', 'spot_cleaning'].includes(value) || !this.supportsCleaningRecovery()) {
      return super.onCapabilityVacuumcleanerState(value, opts);
    }
    await this.runRoborockCleaning(value === 'cleaning' ? 'app_start' : 'app_spot', []);
    await this.setCapabilityValue('onoff', true);
  }

  async runRoborockCleaning(method, params, rawResult = false) {
    let connection = this.miio;
    this.log(`Cleaning action received (${method}, available=${this.getAvailable()})`);
    try {
      if (this._connectionSetup) {
        await this._connectionSetup;
        connection = this.miio;
      }
      if (this._wifiStopped) throw new Error('Vacuum connection was stopped');
      if (this._statusRecovery || this._statusFailed || !this.getAvailable() || !connection) {
        const recovered = await this._recoverStatusConnection(connection);
        if (!recovered || this._wifiStopped || this.miio !== recovered.connection) {
          throw new Error('Vacuum connection changed during recovery');
        }
        connection = recovered.connection;
      }

      // A missing acknowledgement can mean the vacuum already started. Send once.
      const options = { retries: 1 };
      if (!rawResult) {
        options.refresh = ['state'];
        if (method !== 'app_spot') options.refreshDelay = 1000;
      }
      const write = connection.call(method, params, options);
      if (!this._cleaningWrites) this._cleaningWrites = new Set();
      this._cleaningWrites.add(write);
      let result;
      try {
        result = await write;
      } finally {
        this._cleaningWrites.delete(write);
      }
      if (!rawResult) checkResult(result);
      this.log(`Vacuum replied to cleaning action (${method})`);
      if (rawResult) return result;
    } catch (error) {
      if (error.code === 'timeout' && connection === this.miio) this._statusFailed = true;
      this.error(`Cleaning action failed (${method}): ${error.message}`);
      throw error;
    }
  }

  _schedulePollReconnect() {
    if (this.recreateTimeout || this._creatingDevice) return;

    this.log('Poll failed; retrying device connection in 60s');
    this.recreateTimeout = this.homey.setTimeout(() => {
      this.recreateTimeout = null;
      this.createDevice();
    }, 60000);
  }

  _recoverStatusConnection(previous) {
    if (!this._statusRecovery) {
      this._statusRecovery = this._openStatusConnection(previous).finally(() => {
        this._statusRecovery = null;
      });
    }
    return this._statusRecovery;
  }

  async _openStatusConnection(previous) {
    let candidate;
    let stage = 'handshake';
    let current = previous;
    try {
      if (this._cleaningWrites?.size) await Promise.allSettled(this._cleaningWrites);
      if (this._wifiStopped || this._connectionSetup || this.miio !== previous) return;
      candidate = await openRoborockConnection({
        address: this.getSetting('address'),
        token: this.getSetting('token'),
        model: previous?.miioModel || this.getStoreValue('model'),
      });
      if (this._wifiStopped || this._creatingDevice || this.miio !== previous) return;

      stage = 'get_status';
      const result = await candidate.call('get_status', [], { retries: 1 });
      if (this._wifiStopped || this._creatingDevice || this.miio !== previous) return;
      if (!Array.isArray(result) || !Number.isInteger(result[0]?.state)
        || !Number.isFinite(result[0]?.battery)) {
        throw new Error('Incomplete vacuum status');
      }

      // The same client must carry subsequent reads and Flow commands.
      const connection = candidate;
      current = connection;
      this.miio = connection;
      candidate = null;
      try {
        // abstract-things can rearm an in-flight poll after destroy() clears its timer.
        // Retire only this instance so a late timer cannot restart its network traffic.
        if (previous) {
          previous.internalPoll = () => {};
          previous.removeAllListeners?.();
          await previous.destroy();
        }
      } catch (error) {
        this.error('Could not release the previous vacuum connection', error);
      }
      if (this._wifiStopped || this.miio !== connection) return;
      await this.startCapabilityListeners();
      if (this._wifiStopped || this.miio !== connection) return;
      this._statusFailed = false;
      this.homey.clearTimeout(this.recreateTimeout);
      this.recreateTimeout = null;
      if (!this.pollingInterval) await this.pollDevice();
      if (this._wifiStopped || this.miio !== connection) return;
      stage = 'availability update';
      if (!this.getAvailable()) await this.setAvailable();
      this.log('Vacuum status recovered on a fresh miIO connection');
      return { connection, result };
    } catch (error) {
      if (this._wifiStopped || this.miio !== current) return;
      throw new Error(`Vacuum status timed out; fresh connection ${stage} failed: ${error.message}`);
    } finally {
      if (candidate) await candidate.destroy();
    }
  }

  async retrieveDeviceData() {
    if (this._pollInProgress || this._statusRecovery || this._wifiStopped) return;

    let miio = this.miio;
    if (!miio) {
      this._schedulePollReconnect();
      return;
    }

    this._pollInProgress = true;
    try {
      let result;
      try {
        // miio counts total attempts. A second attempt uses a fresh request ID after a timeout.
        result = await miio.call("get_status", [], { retries: 2 });
      } catch (error) {
        if (this._wifiStopped || this.miio !== miio) return;
        // Keep model-specific command implementations on their original clients.
        if (error.code !== 'timeout' || models[miio.miioModel] !== MiioVacuum) throw error;
        this._statusFailed = true;
        const recovery = await this._recoverStatusConnection(miio);
        if (!recovery) return;
        miio = recovery.connection;
        result = recovery.result;
      }
      if (this.miio !== miio) return;
      this._statusFailed = false;
      if (!this.getAvailable()) { await this.setAvailable(); }
      this.homey.clearTimeout(this.recreateTimeout);
      this.recreateTimeout = null;

      /* data */
      const fanspeed = this.deviceProperties.fanspeeds[result[0]["fan_power"]];
      if (fanspeed !== undefined) {
        await this.updateCapabilityValue("vacuum_roborock_fanspeed", fanspeed.toString());
      }
      await this.updateCapabilityValue("measure_battery", parseInt(result[0]["battery"]));
      await this.updateCapabilityValue("alarm_battery", parseInt(result[0]["battery"]) === 20 ? true : false);

      if (result[0].hasOwnProperty('error_code')) {
        const error = this.vacuumErrorCodes[result[0].error_code];
        if (this.getSetting('error') !== error ) {
          await this.setSettings({ error: error });
          if (error !== 0) {
            await this.homey.flow.getDeviceTriggerCard('statusVacuum').trigger(this, {"status": error }).catch(error => { this.error(error) });
          }
        }
      }

      if (result[0].hasOwnProperty('water_box_mode')) {
        if (!this.hasCapability('vacuum_roborock_mop_intensity')) {
          this.addCapability('vacuum_roborock_mop_intensity')
        } else {
          await this.updateCapabilityValue("vacuum_roborock_mop_intensity", result[0]["water_box_mode"].toString());
        }
      }

      /* vacuumcleaner_state */
      switch (result[0]["state"]) {
        case 1:
        case 5:
        case 6:
        case 7:
        case 16:
        case 17:
        case 18:
          this.vacuumCleanerState("cleaning");
          break;
        case 11:
          this.vacuumCleanerState("spot_cleaning");
          break;
        case 3:
        case 4:
        case 10:
        case 13:
          this.vacuumCleanerState("stopped");
          break;
        case 15:
          this.vacuumCleanerState("docked");
          break;
        case 8:
          if (this.getCapabilityValue('measure_battery') === 100) {
            this.vacuumCleanerState("docked");
          } else {
            this.vacuumCleanerState("charging");
          }
          break;
        case 9:
        case 12:
        case 13:
        case 101:
          this.vacuumCleanerState("stopped_error");
          break;
        default:
          this.log("Not a valid vacuumcleaner_state", result[0]["state"]);
          break;
      }

      const consumables = await miio.call("get_consumable", [], { retries: 1 });
      if (this.miio !== miio) return;
      this.vacuumConsumables(consumables);

      const totals = await miio.call("get_clean_summary", [], { retries: 1 });
      if (this.miio !== miio) return;
      this.vacuumTotals(totals);

      const rooms = await miio.call("get_room_mapping", [], { retries: 1 });
      if (this.miio !== miio) return;
      if (rooms !== undefined) {
        if (rooms.toString() !== 'unknown_method') {
          if (this.getSetting('rooms') !== rooms.toString() ) {
            await this.setSettings({ rooms: rooms.toString() });
            await this.homey.flow.getDeviceTriggerCard('triggerVacuumRoomSegments').trigger(this, {"segments": rooms.toString() }).catch(error => { this.error(error) });
          }
        } else {
          if (this.getSetting('rooms') !== 'Feature Not Supported' ) {
            await this.setSettings({ rooms: 'Feature Not Supported' });
          }
        }
      }
      

    } catch (error) {
      if (this.miio !== miio) return;

      this._statusFailed = true;
      this.homey.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.homey.clearTimeout(this.initialPollTimeout);
      this.initialPollTimeout = null;

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch(error => { this.error(error) });
      }

      this._schedulePollReconnect();

      this.error(error);
    } finally {
      this._pollInProgress = false;
    }
  }

}

module.exports = MiRobotAdvancedDevice;
