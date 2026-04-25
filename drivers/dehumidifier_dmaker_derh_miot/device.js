'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/dmaker.derh.22ht
// https://home.miot-spec.com/spec/xiaomi.derh.lite

const mapping = {
  "dmaker.derh.22": "mapping_default",
  "dmaker.derh.22ht": "mapping_default",
  "dmaker.derh.*": "mapping_default",
  "xiaomi.derh.lite": "mapping_default",
  "xiaomi.derh.13l": "mapping_default",
  "xiaomi.derh.*": "mapping_default",
};

const properties = {
  "mapping_default": {
    "get_properties": [
      { did: "onoff", siid: 2, piid: 1 }, // onoff
      { did: "error", siid: 2, piid: 2 }, // settings.error
      { did: "mode", siid: 2, piid: 3 }, // dehumidifier_dmaker_mode
      { did: "target_humidity", siid: 2, piid: 5 }, // target_humidity [40, 50, 60, 70]
      { did: "relative_humidity", siid: 3, piid: 1 }, // measure_humidity
      { did: "temperature", siid: 3, piid: 2 }, // measure_temperature
      { did: "buzzer", siid: 4, piid: 1 }, // settings.buzzer
      { did: "led_light", siid: 5, piid: 1 }, // settings.led
      { did: "child_lock", siid: 6, piid: 1 } // settings.childLock
    ],
    "set_properties": {
      "onoff": { siid: 2, piid: 1 },
      "mode": { siid: 2, piid: 3 },
      "target_humidity": { siid: 2, piid: 5 },
      "buzzer": { siid: 4, piid: 1 },
      "light": { siid: 5, piid: 1 },
      "child_lock": { siid: 6, piid: 1 }
    }
  }
}

const modes = {
  0: "Smart",
  1: "Sleep",
  2: "Clothes Drying"
};

class DehumidifierDmakerDerhMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // DEVICE VARIABLES
      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['dmaker.derh.*']];

      if (!this.hasCapability('alarm_water')) {
        await this.addCapability('alarm_water');
      }

      this.errorCodes = {
        0: "No Faults",
        1: "Water Full",
        2: "Sensor Fault1",
        3: "Sensor Fault2",
        4: "Communication Fault1",
        5: "Filter Clean",
        6: "Defrost",
        7: "Fan Motor",
        8: "Overload",
        9: "Lack Of Refrigerant",
        10: "Out Of Temperature"
      }

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.onoff.siid, piid: this.deviceProperties.set_properties.onoff.piid, value }], { retries: 1 });
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

      this.registerCapabilityListener('target_humidity', async ( value ) => {
        try {
          if (this.miio) {
            let humidity = value * 100;
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.target_humidity.siid, piid: this.deviceProperties.set_properties.target_humidity.piid, value: humidity }], { retries: 1 });
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

      this.registerCapabilityListener('dehumidifier_dmaker_mode', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.mode.siid, piid: this.deviceProperties.set_properties.mode.piid, value: +value }], { retries: 1 });
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

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes("address") || changedKeys.includes("token") || changedKeys.includes("polling")) {
      this.refreshDevice();
    }

    if (changedKeys.includes("led")) {
      await this.miio.call("set_properties", [{ did: "light", siid: this.deviceProperties.set_properties.light.siid, piid: this.deviceProperties.set_properties.light.piid, value: newSettings.led }], { retries: 1 });
    }

    if (changedKeys.includes("buzzer")) {
      await this.miio.call("set_properties", [{ did: "buzzer", siid: this.deviceProperties.set_properties.buzzer.siid, piid: this.deviceProperties.set_properties.buzzer.piid, value: newSettings.buzzer }], { retries: 1 });
    }

    if (changedKeys.includes("childLock")) {
      await this.miio.call("set_properties", [{ did: "child_lock", siid: this.deviceProperties.set_properties.child_lock.siid, piid: this.deviceProperties.set_properties.child_lock.piid, value: newSettings.childLock }], { retries: 1 });
    }

    return Promise.resolve(true);
  }

  async retrieveDeviceData() {
    try {

      const result = await this.miio.call("get_properties", this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      /* data */
      const onoff = result.find(obj => obj.did === 'onoff');
      const errors = result.find(obj => obj.did === 'error');
      const target_humidity = result.find(obj => obj.did === 'target_humidity');
      const measure_humidity = result.find(obj => obj.did === 'relative_humidity');
      const measure_temperature = result.find(obj => obj.did === 'temperature');
      const buzzer = result.find(obj => obj.did === 'buzzer');
      const led = result.find(obj => obj.did === 'led_light');
      const child_lock = result.find(obj => obj.did === 'child_lock');

      /* capabilities */
      await this.updateCapabilityValue("onoff", onoff.value);
      await this.updateCapabilityValue("alarm_water", errors.value === 1);
      await this.updateCapabilityValue("target_humidity", target_humidity.value / 100);
      await this.updateCapabilityValue("measure_humidity", measure_humidity.value);
      await this.updateCapabilityValue("measure_temperature", measure_temperature.value);    

      /* settings */
      const error = this.errorCodes[errors.value];
      await this.updateSettingValue("error", error);

      await this.updateSettingValue("led", led.value);
      await this.updateSettingValue("buzzer", buzzer.value);
      await this.updateSettingValue("childLock", child_lock.value);

      /* mode capability */
      const mode = result.find(obj => obj.did === 'mode');
      if (this.getCapabilityValue('dehumidifier_dmaker_mode') !== mode.value.toString()) {
        const previous_mode = this.getCapabilityValue('dehumidifier_dmaker_mode');
        await this.setCapabilityValue('dehumidifier_dmaker_mode', mode.value.toString());
        await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, {"new_mode": modes[mode.value], "previous_mode": modes[+previous_mode] }).catch(error => { this.error(error) });
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

module.exports = DehumidifierDmakerDerhMiotDevice;
