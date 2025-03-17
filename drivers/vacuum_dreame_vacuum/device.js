'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/dreame.vacuum.mc1808
// https://home.miot-spec.com/spec/dreame.vacuum.p2008
// https://home.miot-spec.com/spec/dreame.vacuum.p2009
// https://home.miot-spec.com/spec/dreame.vacuum.p2041o
// https://home.miot-spec.com/spec/dreame.vacuum.p2150a
// https://home.miot-spec.com/spec/dreame.vacuum.p2150o
// https://home.miot-spec.com/spec/dreame.vacuum.p2027
// https://home.miot-spec.com/spec/dreame.vacuum.p2028
// https://home.miot-spec.com/spec/dreame.vacuum.p2029
// https://home.miot-spec.com/spec/dreame.vacuum.p2041
// https://home.miot-spec.com/spec/dreame.vacuum.r2205
// https://home.miot-spec.com/spec/dreame.vacuum.r2228o
// https://home.miot-spec.com/spec/dreame.vacuum.r2209
// https://home.miot-spec.com/spec/dreame.vacuum.p2114a
// https://home.miot-spec.com/spec/dreame.vacuum.r2211o
// https://home.miot-spec.com/spec/dreame.vacuum.r2232c
// https://home.miot-spec.com/spec/dreame.vacuum.r2338a (not supported, docs is missing)
// https://home.miot-spec.com/spec/dreame.vacuum.r2416 (not supported, docs is missing)
// https://home.miot-spec.com/spec/dreame.vacuum.r2449 (not supported, docs is missing)


const mapping = {
  "dreame.vacuum.mc1808": "properties_mc1808",
  "dreame.vacuum.p2008": "properties_p2008",
	"dreame.vacuum.p2009": "properties_p2008",
  "dreame.vacuum.p2027": "properties_p2008",
	"dreame.vacuum.p2028": "properties_p2008",
  "dreame.vacuum.p2029": "properties_p2029",
	"dreame.vacuum.p2041o": "properties_p2008",
	"dreame.vacuum.p2150a": "properties_p2008",
	"dreame.vacuum.p2150o": "properties_p2008",
  // duplicated ??
	// "dreame.vacuum.p2041": "properties_p2008", 
	"dreame.vacuum.p2041": "properties_p2029",
  "dreame.vacuum.r2205": "properties_r2205",
  "dreame.vacuum.r2228o": "properties_r2205",
  "dreame.vacuum.r2209": "properties_r2205",
  "dreame.vacuum.p2114a": "properties_r2205",
  "dreame.vacuum.r2211o": "properties_r2205",
  "dreame.vacuum.r2232c": "properties_r2205",
  "dreame.vacuum.r2338a": "properties_r2205",
  "dreame.vacuum.r2416": "properties_r2205",
  "dreame.vacuum.r2449": "properties_r2205",
  "dreame.vacuum.*": "properties_p2008",
  
};

const properties = {
  "properties_mc1808": {
    "get_properties": [
      { did: "battery_level", siid: 2, piid: 1 }, // measure_battery
      { did: "device_fault", siid : 3, piid: 1 }, // settings.error
      { did: "device_status", siid: 3, piid: 2 }, // vacuumcleaner_state
      { did: "brush_life_level", siid: 26, piid: 2 }, // settings.main_brush_work_time
      { did: "filter_life_level", siid: 27, piid: 1 }, // settings.filter_work_time
      { did: "brush_life_level2", siid: 28, piid: 2 }, // settings.side_brush_work_time
      { did: "cleaning_mode", siid: 18, piid: 6 }, // vacuum_dreame_fanspeed
      { did: "total_clean_time", siid: 18, piid: 13 }, // settings.total_work_time
      { did: "total_clean_times", siid: 18, piid: 14 }, // settings.clean_count
      { did: "total_clean_area", siid: 18, piid: 15 } // settings.total_cleared_area
    ],
    "set_properties": {
      "start_clean": { siid: 3, aiid: 1, did: "call-3-1", in: [] },
      "stop_clean": { siid: 3, aiid: 2, did: "call-3-2", in: [] },
      "home": { siid: 2, aiid: 1, did: "call-2-1", in: [] },
      "fanspeed": { siid: 18, piid: 6 }
    }
  },
  "properties_p2008": {
    "get_properties": [
      { did: "device_status", siid: 2, piid: 1 }, // vacuumcleaner_state
      { did: "device_fault", siid : 2, piid: 2 }, // settings.error
      { did: "rooms", siid: 2, piid: 4 }, // settings.rooms
      { did: "battery_level", siid: 3, piid: 1 }, // measure_battery
      { did: "cleaning_mode", siid: 4, piid: 4 }, // vacuum_dreame_fanspeed
      { did: "water_flow", siid: 4, piid: 5 }, // vacuum_dreame_mop_intensity
      { did: "brush_life_level", siid: 9, piid: 2 }, // settings.main_brush_work_time
      { did: "filter_life_level", siid: 11, piid: 1 }, // settings.filter_work_time
      { did: "brush_life_level2", siid: 10, piid: 2 }, // settings.side_brush_work_time
      { did: "total_clean_time", siid: 12, piid: 2 }, // settings.total_work_time
      { did: "total_clean_times", siid: 12, piid: 3 }, // settings.clean_count
      { did: "total_clean_area", siid: 12, piid: 4 }, // settings.total_cleared_area
    ],
    "set_properties": {
      "start_clean": { siid: 4, aiid: 1, did: "call-4-1", in: [] },
      "stop_clean": { siid: 4, aiid: 2, did: "call-4-2", in: [] },
      "home": { siid: 3, aiid: 1, did: "call-3-1", in: [] },
      "fanspeed": { siid: 4, piid: 4 },
      "mop_intensity": { siid: 4, piid: 5 }
    }
  },
  "properties_p2029": {
    "get_properties": [
      { did: "device_status", siid: 2, piid: 1 }, // vacuumcleaner_state
      { did: "device_fault", siid : 2, piid: 2 }, // settings.error
      { did: "rooms", siid: 2, piid: 4 }, // settings.rooms
      { did: "battery_level", siid: 3, piid: 1 }, // measure_battery
      { did: "cleaning_mode", siid: 4, piid: 4 }, // vacuum_dreame_fanspeed
      { did: "water_flow", siid: 4, piid: 5 }, // vacuum_dreame_mop_intensity
      { did: "brush_life_level", siid: 9, piid: 2 }, // settings.main_brush_work_time
      { did: "filter_life_level", siid: 11, piid: 1 }, // settings.filter_work_time
      { did: "brush_life_level2", siid: 10, piid: 2 }, // settings.side_brush_work_time
      { did: "total_clean_time", siid: 12, piid: 2 }, // settings.total_work_time
      { did: "total_clean_times", siid: 12, piid: 3 }, // settings.clean_count
      { did: "total_clean_area", siid: 12, piid: 4 }, // settings.total_cleared_area
    ],
    "set_properties": {
      "start_clean": { siid: 4, aiid: 1, did: "call-4-1", in: [] },
      "stop_clean": { siid: 4, aiid: 2, did: "call-4-2", in: [] },
      "home": { siid: 3, aiid: 1, did: "call-3-1", in: [] },
      "fanspeed": { siid: 4, piid: 4 },
      "mop_intensity": { siid: 4, piid: 5 }
    }
  },
  "properties_r2205": {
    "get_properties": [
      { did: "device_status", siid: 2, piid: 1 }, // vacuumcleaner_state
      { did: "device_fault", siid : 2, piid: 2 }, // settings.error
      { did: "cleaning_mode", siid: 2, piid: 3 }, // vacuum_dreame_fanspeed
      { did: "rooms", siid: 2, piid: 4 }, // settings.rooms
      { did: "battery_level", siid: 3, piid: 1 }, // measure_battery
      { did: "water_flow", siid: 4, piid: 5 }, // vacuum_dreame_mop_intensity
      { did: "brush_life_level", siid: 9, piid: 2 }, // settings.main_brush_work_time
      { did: "brush_life_level2", siid: 10, piid: 2 }, // settings.side_brush_work_time
      { did: "filter_life_level", siid: 11, piid: 1 }, // settings.filter_work_time
      { did: "total_clean_time", siid: 12, piid: 2 }, // settings.total_work_time
      { did: "total_clean_times", siid: 12, piid: 3 }, // settings.clean_count
      { did: "total_clean_area", siid: 12, piid: 4 }, // settings.total_cleared_area
    ],
    "set_properties": {
      "start_clean": { siid: 4, aiid: 1, did: "call-4-1", in: [] },
      "stop_clean": { siid: 4, aiid: 2, did: "call-4-2", in: [] },
      "home": { siid: 3, aiid: 1, did: "call-3-1", in: [] },
      "fanspeed": { siid: 4, piid: 4 },
      "mop_intensity": { siid: 4, piid: 5 }
    }
  }
}

class AdvancedDreameMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // ADD DEVICES DEPENDANT CAPABILITIES
      if (this.getStoreValue('model') !== 'dreame.vacuum.mc1808') {
        if (!this.hasCapability('vacuum_dreame_mop_intensity')) {
          this.addCapability('vacuum_dreame_mop_intensity');
        }
      }

      // DEVICE VARIABLES
      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['dreame.vacuum.*']];

      this.vacuumErrorCodes = {
        0: "Normal",
        1: "Drop",
        2: "Cliff",
        3: "Bumper",
        4: "Gesture",
        5: "Bumper Repeat",
        6: "Drop Repeat",
        7: "Optical Flow",
        8: "No Container",
        9: "No Tank",
        10: "Waterbox Empty",
        11: "Container Full",
        12: "Brush",
        13: "Sidebrush",
        14: "Fan",
        15: "Left Wheel Motor",
        16: "Right Wheel Motor",
        17: "Turn Soffacate",
        18: "Forward Soffacate",
        19: "Charger Get",
        20: "Battery Low",
        21: "Charge Fault",
        22: "Battery Percentage",
        23: "Heart",
        24: "Camera Occlusion",
        25: "Camera Fault",
        26: "Event Battery",
        27: "Forward Looking",
        28: "Gyroscope"
      }

      // RESET CONSUMABLE ALARMS
      this.updateCapabilityValue("alarm_main_brush_work_time", false);
      this.updateCapabilityValue("alarm_side_brush_work_time", false);
      this.updateCapabilityValue("alarm_filter_work_time", false);

      // DEVICE TOKENS
      this.main_brush_lifetime_token = await this.homey.flow.createToken("main_brush_lifetime"+ this.getData().id, {type: "number", title: "Main Brush Lifetime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.side_brush_lifetime_token = await this.homey.flow.createToken("side_brush_lifetime"+ this.getData().id, {type: "number", title: "Side Brush Lifetime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.filter_lifetime_token = await this.homey.flow.createToken("filter_lifetime"+ this.getData().id, {type: "number", title: "Filter LifeTime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.sensor_dirty_lifetime_token = await this.homey.flow.createToken("sensor_dirty_lifetime"+ this.getData().id, {type: "number", title: "Sensor Dirty Time " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.total_work_time_token = await this.homey.flow.createToken("total_work_time"+ this.getData().id, {type: "number", title: "Total Work Time " + this.getName() +" h)" }).catch(error => { this.error(error) });
      this.total_cleared_area_token = await this.homey.flow.createToken("total_cleared_area"+ this.getData().id, {type: "number", title: "Total Cleaned Area " + this.getName() +" (m2)" }).catch(error => { this.error(error) });
      this.total_clean_count_token = await this.homey.flow.createToken("total_clean_count"+ this.getData().id, {type: "number", title: "Total Clean Count "+ this.getName() }).catch(error => { this.error(error) });

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('alertVacuum');
      this.homey.flow.getDeviceTriggerCard('statusVacuum');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async ( value ) => {
        try {
          if (this.miio) {
            if (value) {
              return await this.miio.call("action", this.deviceProperties.set_properties.start_clean, { retries: 1 });
            } else {
              return await this.miio.call("action", this.deviceProperties.set_properties.stop_clean, { retries: 1 });
            }
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

      this.registerCapabilityListener('vacuumcleaner_state', async ( value ) => {
        try {
          if (this.miio) {
            switch (value) {
              case "cleaning":
              case "spot_cleaning":
                return await this.triggerCapabilityListener('onoff', true);
              case "docked":
              case "charging":
                return await this.miio.call("action", this.deviceProperties.set_properties.home, { retries: 1 });
              case "stopped":
                return await this.triggerCapabilityListener('onoff', false);
            }
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

      /* vacuumcleaner dreame fanspeed */
      this.registerCapabilityListener('vacuum_dreame_fanspeed', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.fanspeed.siid, piid: this.deviceProperties.set_properties.fanspeed.piid, value: Number(value) }], { retries: 1 });
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

      /* vacuumcleaner dreame mop intensity */
      this.registerCapabilityListener('vacuum_dreame_mop_intensity', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.mop_intensity.siid, piid: this.deviceProperties.set_properties.mop_intensity.piid, value: Number(value) }], { retries: 1 });
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

      this.registerCapabilityListener('button.consumable', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("reset_consumable", ["main_brush_work_time", "side_brush_work_time", "filter_work_time"], { retries: 1 });
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

  async retrieveDeviceData() {
    try {

      const result = await this.miio.call("get_properties", this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      /* data */
      const device_status = result.find(obj => obj.did === 'device_status');
      const battery_level = result.find(obj => obj.did === 'battery_level');
      const rooms = result.find(obj => obj.did === 'rooms');
      const cleaning_mode = result.find(obj => obj.did === 'cleaning_mode');
      const brush_life_level = result.find(obj => obj.did === 'brush_life_level');
      const brush_life_level2 = result.find(obj => obj.did === 'brush_life_level2');
      const filter_life_level = result.find(obj => obj.did === 'filter_life_level');
      const total_clean_time = result.find(obj => obj.did === 'total_clean_time');
      const total_clean_times = result.find(obj => obj.did === 'total_clean_times');
      const total_clean_area = result.find(obj => obj.did === 'total_clean_area');
      const device_fault = result.find(obj => obj.did === 'device_fault');

      const consumables = [
        {
          "main_brush_work_time": brush_life_level.value,
          "side_brush_work_time": brush_life_level2.value,
          "filter_work_time": filter_life_level.value,
        }
      ]

      const totals = {
        "clean_time": total_clean_time.value,
        "clean_count": total_clean_times.value,
        "clean_area": total_clean_area.value
      }

      /* onoff & vacuumcleaner_state */
      switch (device_status.value) {
        case 1:
        case 5:
        case 7:
        case 12:
          this.vacuumCleanerState("cleaning");
          break;
        case 2:
        case 3:
        case 11:
          this.vacuumCleanerState("stopped");
          break;
        case 6:
          if (this.getCapabilityValue('measure_battery') === 100) {
            this.vacuumCleanerState("docked");
          } else {
            this.vacuumCleanerState("charging");
          }
          break;
        case 4:
          this.vacuumCleanerState("stopped_error");
          break;
        case 13:
        case 14:
          this.vacuumCleanerState("docked");
          break;
        default:
          this.log("Not a valid vacuumcleaner_state", device_status.value);
          break;
      }

      /* measure_battery & alarm_battery */
      await this.updateCapabilityValue("measure_battery", battery_level.value);
      await this.updateCapabilityValue("alarm_battery", battery_level.value <= 20 ? true : false);

      /* vacuum_dreame_fanspeed */
      await this.updateCapabilityValue("vacuum_dreame_fanspeed", cleaning_mode.value.toString());

       /* vacuum_dreame_mop_intensity */
       if (this.hasCapability('vacuum_dreame_mop_intensity')) {
        const water_flow = result.find(obj => obj.did === 'water_flow');
        await this.updateCapabilityValue("vacuum_dreame_mop_intensity", water_flow.value.toString());
      }

      /* consumable settings */
      this.vacuumConsumables(consumables);

      /* totals */
      this.vacuumTotals(totals);

      /* room ID settings */
      if (rooms !== undefined) {
        await this.updateSettingValue("rooms", rooms.value);
      } else {
        await this.updateSettingValue("rooms", "Not supported for this model");
      }

      /* settings device error */
      const error = this.vacuumErrorCodes[device_fault.value] || String(device_fault.value);
      if (this.getSetting('error') !== error && error !== undefined) {
        await this.setSettings({ error: error });
        if (error !== 0) {
          await this.homey.flow.getDeviceTriggerCard('statusVacuum').trigger(this, {"status": error }).catch(error => { this.error(error) });
        }
      }

    } catch (error) {
      this.homey.clearInterval(this.pollingInterval);

      if (this.getAvailable()) {
        this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch(error => { this.error(error) });
      }

      this.homey.setTimeout(() => { this.createDevice(); }, 60000);

      this.error(error.message);
    }
  }

}

module.exports = AdvancedDreameMiotDevice;
