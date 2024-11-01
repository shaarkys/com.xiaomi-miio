'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/mijia.vacuum.v1
// https://home.miot-spec.com/spec/mijia.vacuum.v2
// https://home.miot-spec.com/spec/mijia.vacuum.v3
// https://home.miot-spec.com/spec/mijia.vacuum.b108za
// https://home.miot-spec.com/spec/mijia.vacuum.b108zb
// https://home.miot-spec.com/spec/ijai.vacuum.v1
// https://home.miot-spec.com/spec/ijai.vacuum.v2
// https://home.miot-spec.com/spec/ijai.vacuum.v3
// https://home.miot-spec.com/spec/ijai.vacuum.v10
// https://home.miot-spec.com/spec/ijai.vacuum.v13
// https://home.miot-spec.com/spec/ijai.vacuum.v14
// https://home.miot-spec.com/spec/ijai.vacuum.v15
// https://home.miot-spec.com/spec/ijai.vacuum.v16
// https://home.miot-spec.com/spec/ijai.vacuum.v17
// https://home.miot-spec.com/spec/ijai.vacuum.v18
// https://home.miot-spec.com/spec/ijai.vacuum.v19

const mapping = {
  "mijia.vacuum.v1": "properties_default",
  "mijia.vacuum.v2": "properties_default",
  "mijia.vacuum.v3": "properties_mijia_v3",
  "mijia.vacuum.b108za": "properties_mijia_b108za",
  "mijia.vacuum.b108zb": "properties_mijia_b108za",
  "ijai.vacuum.v1": "properties_ijai_v1",
  "ijai.vacuum.v2": "properties_ijai_v1",
  "ijai.vacuum.v3": "properties_ijai_v1",
  "ijai.vacuum.v10": "properties_ijai_v1",
  "ijai.vacuum.v13": "properties_ijai_v1",
  "ijai.vacuum.v14": "properties_ijai_v1",
  "ijai.vacuum.v15": "properties_ijai_v1",
  "ijai.vacuum.v16": "properties_ijai_v1",
  "ijai.vacuum.v17": "properties_ijai_v1",
  "ijai.vacuum.v18": "properties_ijai_v1",
  "ijai.vacuum.v19": "properties_ijai_v1",
  "mijia.vacuum.*": "properties_default",
};

const properties = {
  "properties_default": {
    "get_properties": [
      { did: "battery", siid: 3, piid: 1 }, // measure_battery
      { did: "device_fault", siid : 2, piid: 2 }, // settings.error
      { did: "device_status", siid: 2, piid: 1 }, // vacuumcleaner_state
      { did: "fan_speed", siid: 2, piid: 6 }, // vacuum_dreame_fanspeed
      { did: "main_brush_life_level", siid: 24, piid: 2 }, // settings.main_brush_work_time
      { did: "side_brush_life_level", siid: 25, piid: 1 }, // settings.side_brush_work_time
      { did: "filter_life_level", siid: 11, piid: 1 }, // settings.filter_work_time
      { did: "total_clean_time", siid: 9, piid: 4 }, // settings.total_work_time
      { did: "total_clean_count", siid: 9, piid: 5 }, // settings.clean_count
      { did: "total_clean_area", siid: 9, piid: 3 } // settings.total_cleared_area
    ],
    "set_properties": {
      "start_clean": { siid: 2, aiid: 1, did: "call-2-1", in: [] },
      "stop_clean": { siid: 2, aiid: 2, did: "call-2-2", in: [] },
      "find": { siid: 6, aiid: 1, did: "call-6-1", in: [] },
      "home": { siid: 2, aiid: 3, did: "call-2-3", in: [] },
      "fanspeed": { siid: 2, piid: 6 }
    },
    "error_codes": {
      0: "No Error",
      1: "Left-wheel-error",
      2: "Right-wheel-error",
      3: "Cliff-error",
      4: "Low-battery-error",
      5: "Bump-error",
      6: "Main-brush-error",
      7: "Side-brush-error",
      8: "Fan-motor-error",
      9: "Dustbin-error",
      10: "Charging-error",
      11: "No-water-error",
      0: "Everything-is-ok",
      12: "Pick-up-error"
    },
    "status_mapping": {
      "cleaning": [2, 6],
      "spot_cleaning": [],
      "docked": [],
      "charging": [5],
      "stopped": [1, 3],
      "stopped_error": [4]
    }
  },
  "properties_mijia_v3": {
    "get_properties": [
      { did: "battery", siid: 3, piid: 1 }, // measure_battery
      { did: "device_fault", siid : 2, piid: 2 }, // settings.error
      { did: "device_status", siid: 2, piid: 1 }, // vacuumcleaner_state
      { did: "fan_speed", siid: 2, piid: 6 }, // vacuum_dreame_fanspeed
      { did: "main_brush_life_level", siid: 14, piid: 1 }, // settings.main_brush_work_time
      { did: "side_brush_life_level", siid: 15, piid: 1 }, // settings.side_brush_work_time
      { did: "filter_life_level", siid: 11, piid: 1 }, // settings.filter_work_time
      { did: "total_clean_time", siid: 9, piid: 4 }, // settings.total_work_time
      { did: "total_clean_count", siid: 9, piid: 5 }, // settings.clean_count
      { did: "total_clean_area", siid: 9, piid: 3 } // settings.total_cleared_area
    ],
    "set_properties": {
      "start_clean": { siid: 2, aiid: 1, did: "call-2-1", in: [] },
      "stop_clean": { siid: 2, aiid: 2, did: "call-2-2", in: [] },
      "find": { siid: 6, aiid: 1, did: "call-6-1", in: [] },
      "home": { siid: 2, aiid: 3, did: "call-2-3", in: [] },
      "fanspeed": { siid: 2, piid: 6 }
    },
    "error_codes": {
      0: "No Error",
      1: "Left-wheel-error",
      2: "Right-wheel-error",
      3: "Cliff-error",
      4: "Low-battery-error",
      5: "Bump-error",
      6: "Main-brush-error",
      7: "Side-brush-error",
      8: "Fan-motor-error",
      9: "Dustbin-error",
      10: "Charging-error",
      11: "No-water-error",
      0: "Everything-is-ok",
      12: "Pick-up-error"
    },
    "status_mapping": {
      "cleaning": [2, 6],
      "spot_cleaning": [],
      "docked": [],
      "charging": [5],
      "stopped": [1, 3],
      "stopped_error": [4]
    }
  },
  "properties_mijia_b108za": {
    "get_properties": [
      { did: "battery", siid: 3, piid: 1 }, // measure_battery
      { did: "device_fault", siid : 2, piid: 2 }, // settings.error
      { did: "device_status", siid: 2, piid: 1 }, // vacuumcleaner_state
      { did: "fan_speed", siid: 2, piid: 8 }, // vacuum_dreame_fanspeed
      { did: "main_brush_life_level", siid: 8, piid: 1 }, // settings.main_brush_work_time
      { did: "side_brush_life_level", siid: 9, piid: 1 }, // settings.side_brush_work_time
      { did: "filter_life_level", siid: 10, piid: 2 }, // settings.filter_work_time
      { did: "total_clean_time", siid: 2, piid: 6 }, // settings.total_work_time
      { did: "total_clean_count", siid: 2, piid: 7 }, // settings.clean_count
      { did: "total_clean_area", siid: 2, piid: 5 } // settings.total_cleared_area
    ],
    "set_properties": {
      "start_clean": { siid: 2, aiid: 1, did: "call-2-1", in: [] },
      "stop_clean": { siid: 2, aiid: 2, did: "call-2-2", in: [] },
      "find": { siid: 6, aiid: 6, did: "call-6-6", in: [] },
      "home": { siid: 6, aiid: 15, did: "call-6-15", in: [] },
      "fanspeed": { siid: 2, piid: 8 }
    },
    "error_codes": {
      0: "No Error",
      1: "Left-wheel-error",
      2: "Right-wheel-error",
      3: "Cliff-error",
      4: "Low-battery-error",
      5: "Bump-error",
      6: "Main-brush-error",
      7: "Side-brush-error",
      8: "Fan-motor-error",
      9: "Dustbin-error",
      10: "Charging-error",
      11: "No-water-error",
      0: "Everything-is-ok",
      12: "Pick-up-error"
    },
    "status_mapping": {
      "cleaning": [4, 6, 7],
      "spot_cleaning": [],
      "docked": [8],
      "charging": [2, 3],
      "stopped": [1, 5, 9, 10],
      "stopped_error": []
    }
  },
  "properties_ijai_v1": {
    "get_properties": [
      { did: "device_status", siid: 2, piid: 1 }, // vacuumcleaner_state
      { did: "device_fault", siid : 2, piid: 2 }, // settings.error
      { did: "battery", siid: 3, piid: 1 }, // measure_battery
      { did: "main_brush_life_level", siid: 7, piid: 10 }, // settings.main_brush_work_time
      { did: "side_brush_life_level", siid: 7, piid: 8 }, // settings.side_brush_work_time
      { did: "filter_life_level", siid: 7, piid: 12 }, // settings.filter_work_time
      { did: "total_clean_time", siid: 7, piid: 28 }, // settings.total_work_time
      { did: "total_clean_count", siid: 7, piid: 22 }, // settings.clean_count
      { did: "total_clean_area", siid: 7, piid: 29 } // settings.total_cleared_area
    ],
    "set_properties": {
      "start_clean": { siid: 2, aiid: 1, did: "call-2-1", in: [] },
      "stop_clean": { siid: 2, aiid: 2, did: "call-2-2", in: [] },
      "find": { siid: 6, aiid: 6, did: "call-6-6", in: [] },
      "home": { siid: 3, aiid: 1, did: "call-3-1", in: [] }
    },
    "error_codes": {
      0: "No Error",
      1: "Left-wheel-error",
      2: "Right-wheel-error",
      3: "Cliff-error",
      4: "Low-battery-error",
      5: "Bump-error",
      6: "Main-brush-error",
      7: "Side-brush-error",
      8: "Fan-motor-error",
      9: "Dustbin-error",
      10: "Charging-error",
      11: "No-water-error",
      0: "Everything-is-ok",
      12: "Pick-up-error"
    },
    "status_mapping": {
      "cleaning": [3, 5, 6, 7],
      "spot_cleaning": [],
      "docked": [0],
      "charging": [4],
      "stopped": [1, 2, 8],
      "stopped_error": []
    }
  }
}

class MijaVacuumMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // ADD/REMOVE DEVICES DEPENDANT CAPABILITIES
      if (this.getStoreValue('model').startsWith('ijai.vacuum')) {
        if (this.hasCapability('vacuum_dreame_fanspeed')) {
          this.removeCapability('vacuum_dreame_fanspeed');
        }
      }

      // DEVICE VARIABLES
      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['mijia.vacuum.*']];

      // RESET CONSUMABLE ALARMS
      this.updateCapabilityValue("alarm_main_brush_work_time", false);
      this.updateCapabilityValue("alarm_side_brush_work_time", false);
      this.updateCapabilityValue("alarm_filter_work_time", false);

      // DEVICE TOKENS
      this.main_brush_lifetime_token = await this.homey.flow.createToken("main_brush_lifetime"+ this.getData().id, {type: "number", title: "Main Brush Lifetime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.side_brush_lifetime_token = await this.homey.flow.createToken("side_brush_lifetime"+ this.getData().id, {type: "number", title: "Side Brush Lifetime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
      this.filter_lifetime_token = await this.homey.flow.createToken("filter_lifetime"+ this.getData().id, {type: "number", title: "Filter LifeTime " + this.getName() +" (%)" }).catch(error => { this.error(error) });
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
      const battery = result.find(obj => obj.did === 'battery');
      const fan_speed = result.find(obj => obj.did === 'fan_speed');
      const main_brush_life_level = result.find(obj => obj.did === 'main_brush_life_level');
      const side_brush_life_level = result.find(obj => obj.did === 'side_brush_life_level');
      const filter_life_level = result.find(obj => obj.did === 'filter_life_level');
      const total_clean_time = result.find(obj => obj.did === 'total_clean_time');
      const total_clean_count = result.find(obj => obj.did === 'total_clean_count');
      const total_clean_area = result.find(obj => obj.did === 'total_clean_area');
      const device_fault = result.find(obj => obj.did === 'device_fault');

      const consumables = [
        {
          "main_brush_work_time": main_brush_life_level.value,
          "side_brush_work_time": side_brush_life_level.value,
          "filter_work_time": filter_life_level.value,
        }
      ]

      const totals = {
        "clean_time": total_clean_time.value,
        "clean_count": total_clean_count.value,
        "clean_area": total_clean_area.value,
      }

      /* onoff & vacuumcleaner_state */
      for (let key in this.deviceProperties.status_mapping) {
        if (this.deviceProperties.status_mapping[key].includes(device_status.value)) {
          if (this.getCapabilityValue('measure_battery') === 100 && (key === "stopped" || key === "charging")) {
            this.vacuumCleanerState("docked");
          } else {
            this.vacuumCleanerState(key);
          }
        } else {
          this.log("Not a valid vacuumcleaner_state", device_status.value);
        }
      }

      /* measure_battery & alarm_battery */
      await this.updateCapabilityValue("measure_battery", battery.value);
      await this.updateCapabilityValue("alarm_battery", battery.value <= 20 ? true : false);

      /* vacuum_dreame_fanspeed */
      if (fan_speed !== undefined && this.hasCapability('vacuum_dreame_fanspeed')) {
        await this.updateCapabilityValue("vacuum_dreame_fanspeed", fan_speed.value.toString());
      }

      /* consumable settings */
      this.vacuumConsumables(consumables);

      /* totals */
      this.vacuumTotals(totals);

      /* settings device error */
      const error = this.deviceProperties.error_codes[device_fault.value];
      if (this.getSetting('error') !== error ) {
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

module.exports = MijaVacuumMiotDevice;