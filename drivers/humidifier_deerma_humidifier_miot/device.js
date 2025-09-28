'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/deerma.humidifier.jsqs 
// https://home.miot-spec.com/spec/deerma.humidifier.jsq4
// https://home.miot-spec.com/spec/deerma.humidifier.jsq5
// https://home.miot-spec.com/spec/deerma.humidifier.jsq2w

const mapping = {
  "deerma.humidifier.jsqs": "mapping_default",
  "deerma.humidifier.jsq4": "mapping_default",
  "deerma.humidifier.jsq5": "mapping_default",
  "deerma.humidifier.jsq2w": "mapping_jsq2w",  // custom mapping for jsq2w
  "deerma.humidifier.*": "mapping_default",
};

const properties = {
  "mapping_default": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 }, // onoff
      { did: "watertank_shortage_fault", siid: 7, piid: 1 }, // alarm.water
      { did: "mode", siid: 2, piid: 5 }, // humidifier_deerma_jsq_mode
      { did: "target_humidity", siid: 2, piid: 6 }, // target_humidity [30, 40, 50, 60, 70, 80]
      { did: "relative_humidity", siid: 3, piid: 1 }, // measure_humidity
      { did: "temperature", siid: 3, piid: 7 }, // measure_temperature
      { did: "buzzer", siid: 5, piid: 1 }, // settings.buzzer
      { did: "led_light", siid: 6, piid: 1 }, // settings.led
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "mode": { siid: 2, piid: 5 },
      "target_humidity": { siid: 2, piid: 6 },
      "buzzer": { siid: 5, piid: 1 },
      "light": { siid: 6, piid: 1 }
    }
  },

  "mapping_jsq2w": {
    "get_properties": [
      { did: "power", siid: 2, piid: 1 },
      { did: "watertank_shortage_fault", siid: 7, piid: 2 }, // custom: corrected piid for jsq2w
      { did: "mode", siid: 2, piid: 5 },
      { did: "target_humidity", siid: 2, piid: 6 },
      { did: "relative_humidity", siid: 3, piid: 1 },
      { did: "temperature", siid: 3, piid: 7 },
      { did: "buzzer", siid: 5, piid: 1 },
      { did: "led_light", siid: 6, piid: 1 },
    ],
    "set_properties": {
      "power": { siid: 2, piid: 1 },
      "mode": { siid: 2, piid: 5 },
      "target_humidity": { siid: 2, piid: 6 },
      "buzzer": { siid: 5, piid: 1 },
      "light": { siid: 6, piid: 1 }
    }
  }
};

const modes = {
  1: "Level 1",
  2: "Level 2",
  3: "Level 3",
  4: "Humidity"
};

class HumidifierDeermaMiotDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // DEVICE VARIABLES
      this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['deerma.humidifier.*']];

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.power.siid, piid: this.deviceProperties.set_properties.power.piid, value }], { retries: 1 });
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

      this.registerCapabilityListener('humidifier_deerma_jsq_mode', async ( value ) => {
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
      const led = await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.light.siid, piid: this.deviceProperties.set_properties.light.piid, value: newSettings.led }], { retries: 1 });
    }

    if (changedKeys.includes("buzzer")) {
      const buzzer = await this.miio.call("set_properties", [{ siid: this.deviceProperties.set_properties.buzzer.siid, piid: this.deviceProperties.set_properties.buzzer.piid, value: newSettings.buzzer }], { retries: 1 });
    }

    return Promise.resolve(true);
  }

  async retrieveDeviceData() {
    try {

      const result = await this.miio.call("get_properties", this.deviceProperties.get_properties, { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      /* data */
      const onoff = result.find(obj => obj.did === 'power');
      const alarm_tank_empty = result.find(obj => obj.did === 'watertank_shortage_fault');
      const target_humidity = result.find(obj => obj.did === 'target_humidity');
      const measure_humidity = result.find(obj => obj.did === 'relative_humidity');
      const measure_temperature = result.find(obj => obj.did === 'temperature');
      const buzzer = result.find(obj => obj.did === 'buzzer');
      const led = result.find(obj => obj.did === 'led_light');

      /* capabilities */
      if (onoff && onoff.value !== undefined) {
        await this.updateCapabilityValue("onoff", onoff.value);
      }

      if (alarm_tank_empty && alarm_tank_empty.value !== undefined) {
        await this.updateCapabilityValue("alarm_tank_empty", alarm_tank_empty.value);
      }

      if (target_humidity && typeof target_humidity.value === "number") {
        await this.updateCapabilityValue("target_humidity", target_humidity.value / 100);
      }

      if (measure_humidity && measure_humidity.value !== undefined) {
        await this.updateCapabilityValue("measure_humidity", measure_humidity.value);
      }

      if (measure_temperature && measure_temperature.value !== undefined) {
        await this.updateCapabilityValue("measure_temperature", measure_temperature.value);
      }

      /* settings */
      if (led && led.value !== undefined) {
        await this.updateSettingValue("led", led.value);
      }

      if (buzzer && buzzer.value !== undefined) {
        await this.updateSettingValue("buzzer", buzzer.value);
      }

      /* mode capability */
      const mode = result.find(obj => obj.did === "mode");
      if (mode && mode.value !== undefined && mode.value !== null) {
        const newMode = mode.value.toString();
        const previousMode = this.getCapabilityValue("humidifier_deerma_jsq_mode");

        if (previousMode !== newMode) {
          await this.setCapabilityValue("humidifier_deerma_jsq_mode", newMode);

          const newModeLabel = modes[mode.value] ?? newMode;
          const previousModeLabel = (previousMode !== undefined && previousMode !== null)
            ? (modes[Number(previousMode)] ?? previousMode)
            : undefined;

          await this.homey.flow.getDeviceTriggerCard("triggerModeChanged")
            .trigger(this, { "new_mode": newModeLabel, "previous_mode": previousModeLabel })
            .catch(error => { this.error(error); });
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

module.exports = HumidifierDeermaMiotDevice;
