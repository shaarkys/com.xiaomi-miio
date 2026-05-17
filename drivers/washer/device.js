'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

const mapping = {
  "mibx5.washer.f05gl": "properties_default",
  "mibx5.washer.*": "properties_default",
};

const properties = {
  "properties_default": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 },
      { did: "status", siid: 2, piid: 2 },
      { did: "mode", siid: 2, piid: 3 },
      { did: "fault", siid: 2, piid: 4 },
      { did: "target_temperature", siid: 2, piid: 5 },
      { did: "spin_speed", siid: 2, piid: 7 },
      { did: "door_state", siid: 2, piid: 9 },
      { did: "left_time", siid: 2, piid: 10 },
      { did: "run_status", siid: 2, piid: 11 }
    ]
  }
};

class WasherMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      this.bootSequence();

      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['mibx5.washer.*']];

      this.errorCodes = {
        0: "No Faults", 1: "Door Lock Malfunction", 2: "Water Intake Malfunction", 
        3: "Water Draining Malfunction", 4: "Water Level Sensor Malfunction", 5: "Overflow",
        6: "Motor Driver Comm Malfunction", 7: "Motor Fault C2", 16: "Dehydration Fault (Unbalanced)",
        17: "Drying Heating Tube Malfunction", 18: "Drying Fan Malfunction"
      };

      // Dynamische migratie van capabilities (bijgewerkt met de measure_ prefix)
      const requiredCapabilities = [
        'onoff', 'xiaomi_washer_start', 'xiaomi_washer_pause', 'xiaomi_washer_stop',
        'measure_washer_left_time', 'measure_temperature', 'xiaomi_washer_mode',
        'xiaomi_washer_spin_speed'
      ];
      for (const cap of requiredCapabilities) {
        if (!this.hasCapability(cap)) {
          await this.addCapability(cap).catch(error => this.error(error));
        }
      }

      // RUIM OVERBODIGE ENERGIEMETERS OP (Als die er tijdens het testen in waren gezet)
      if (this.hasCapability('meter_water')) {
        await this.removeCapability('meter_water').catch(error => this.error(error));
      }
      if (this.hasCapability('meter_power')) {
        await this.removeCapability('meter_power').catch(error => this.error(error));
      }

      // 1. AAN/UIT SCHAKELAAR (Voor de flows & handmatige bediening)
      this.registerCapabilityListener('onoff', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 1, value: value }], { retries: 1 });
          } else {
            throw new Error('Device unreachable');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      // 2. WASPROGRAMMA KIEZEN
      this.registerCapabilityListener('xiaomi_washer_mode', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 3, value: parseInt(value) }], { retries: 1 });
          } else {
            throw new Error('Device unreachable');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      // 3. TOERENTAL INSTELLEN
      this.registerCapabilityListener('xiaomi_washer_spin_speed', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: 2, piid: 7, value: parseInt(value) }], { retries: 1 });
          } else {
            throw new Error('Device unreachable');
          }
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      // 4. UI KNOPPEN
      this.registerCapabilityListener('xiaomi_washer_start', async () => {
        try {
          if (this.miio) return await this.miio.call("action", { did: "call-2-2", siid: 2, aiid: 2, in: [] }, { retries: 1 });
          throw new Error('Device unreachable');
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      this.registerCapabilityListener('xiaomi_washer_pause', async () => {
        try {
          if (this.miio) return await this.miio.call("action", { did: "call-2-3", siid: 2, aiid: 3, in: [] }, { retries: 1 });
          throw new Error('Device unreachable');
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      this.registerCapabilityListener('xiaomi_washer_stop', async () => {
        try {
          if (this.miio) return await this.miio.call("action", { did: "call-2-1", siid: 2, aiid: 1, in: [] }, { retries: 1 });
          throw new Error('Device unreachable');
        } catch (error) {
          this.error(error);
          return Promise.reject(error);
        }
      });

      // 5. FLOW ACTIES
      this.homey.flow.getActionCard('WasherStart').registerRunListener(async (args, state) => {
        try {
          if (this.miio) return await this.miio.call("action", { did: "call-2-2", siid: 2, aiid: 2, in: [] }, { retries: 1 });
          throw new Error('Device unreachable');
        } catch (error) {
          this.error(error);
          return false;
        }
      });

      this.homey.flow.getActionCard('WasherPause').registerRunListener(async (args, state) => {
        try {
          if (this.miio) return await this.miio.call("action", { did: "call-2-3", siid: 2, aiid: 3, in: [] }, { retries: 1 });
          throw new Error('Device unreachable');
        } catch (error) {
          this.error(error);
          return false;
        }
      });

      this.homey.flow.getActionCard('WasherStop').registerRunListener(async (args, state) => {
        try {
          if (this.miio) return await this.miio.call("action", { did: "call-2-1", siid: 2, aiid: 1, in: [] }, { retries: 1 });
          throw new Error('Device unreachable');
        } catch (error) {
          this.error(error);
          return false;
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

      /* DATA EXTRACTIE */
      const power = result.find(obj => obj.did === 'power');
      const status = result.find(obj => obj.did === 'status');
      const fault = result.find(obj => obj.did === 'fault');
      const mode = result.find(obj => obj.did === 'mode');
      const spin_speed = result.find(obj => obj.did === 'spin_speed');
      const target_temperature = result.find(obj => obj.did === 'target_temperature');
      const left_time = result.find(obj => obj.did === 'left_time');

      /* CAPABILITIES UPDATEN */
      if (power !== undefined) {
         await this.updateCapabilityValue("onoff", power.value === true || power.value === 1);
      }

      if (left_time !== undefined) {
         await this.updateCapabilityValue("measure_washer_left_time", left_time.value);
      }

      if (target_temperature !== undefined) {
         await this.updateCapabilityValue("measure_temperature", target_temperature.value);
      }

      if (mode !== undefined) {
         await this.updateCapabilityValue("xiaomi_washer_mode", mode.value.toString());
      }

      if (spin_speed !== undefined) {
         await this.updateCapabilityValue("xiaomi_washer_spin_speed", spin_speed.value.toString());
      }

      /* SETTINGS UPDATEN */
      if (fault !== undefined) {
         const errorStr = this.errorCodes[fault.value] || `Unknown error: ${fault.value}`;
         await this.updateSettingValue("error", errorStr);
      }

      /* FLOW TRIGGERS */
      if (status !== undefined) {
         const currentStatus = status.value;
         const previousStatus = this.getStoreValue('previous_status');

         if (currentStatus !== previousStatus) {
            this.setStoreValue('previous_status', currentStatus);

            if (currentStatus === 3 && previousStatus !== 3) {
               this.homey.flow.getDeviceTriggerCard('WasherStarted').trigger(this, {}, {}).catch(error => this.error(error));
            }
            
            if (currentStatus === 5 && previousStatus !== 5) {
               this.homey.flow.getDeviceTriggerCard('WasherFinished').trigger(this, {}, {}).catch(error => this.error(error));
            }
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

module.exports = WasherMiotDevice;