'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/deerma.humidifier.mjjsq // Mijia Smart Sterilization Humidifier MJJSQ
// https://home.miot-spec.com/spec/deerma.humidifier.jsq // Mijia Smart Sterilization Humidifier JSQ
// https://home.miot-spec.com/spec/deerma.humidifier.jsq1 // Mijia Smart Sterilization Humidifier JSQ1

const modes = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Humidity"
};

const properties = [
  "Humidifier_Gear",
  "Humidity_Value",
  "HumiSet_Value",
  "Led_State",
  "OnOff_State",
  "TemperatureValue",
  "TipSound_State",
  "waterstatus",
  "watertankstatus"
];

const validModeValues = new Set(["1", "2", "3", "4"]);

class HumidifierDeermaJSQDevice extends Device {

  async onInit() {
    try {
      if (!this.util) this.util = new Util({homey: this.homey});
      
      // GENERIC DEVICE INIT ACTIONS
      this.bootSequence();

      // FLOW TRIGGER CARDS
      this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

      // LISTENERS FOR UPDATING CAPABILITIES
      this.registerCapabilityListener('onoff', async ( value ) => {
        try {
          if (this.miio) {
            return await this.miio.call("Set_OnOff", [+value]);
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
            const humidity = value * 100;
            return await this.miio.call("Set_HumiValue", [humidity]);
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
            return await this.miio.call("Set_HumidifierGears", [Number(value)]);
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
      const led = await this.miio.call("SetLedState", [newSettings.led ? 1 : 0]);
    }

    if (changedKeys.includes("buzzer")) {
      const buzzer = await this.miio.call("SetTipSound_Status", [newSettings.buzzer ? 1 : 0]);
    }

    return Promise.resolve(true);
  }

  async getPropertiesSingleRequest() {
    const values = [];

    // Some deerma.humidifier.(mj)jsq models return invalid values when queried in bulk.
    for (const property of properties) {
      const result = await this.miio.call("get_prop", [property], { retries: 1 });
      values.push(Array.isArray(result) ? result[0] : result);
    }

    return values;
  }

  asNumber(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  async retrieveDeviceData() {
    try {

      const result = await this.getPropertiesSingleRequest();
      if (!this.getAvailable()) { await this.setAvailable(); }

      const modeValue = this.asNumber(result[0]);
      const humidityValue = this.asNumber(result[1]);
      const targetHumidityValue = this.asNumber(result[2]);
      const ledValue = this.asNumber(result[3]);
      const onOffValue = this.asNumber(result[4]);
      const temperatureValue = this.asNumber(result[5]);
      const buzzerValue = this.asNumber(result[6]);
      const waterStatusValue = this.asNumber(result[7]);
      const waterTankStatusValue = this.asNumber(result[8]);

      /* capabilities */
      if (humidityValue !== null) {
        await this.updateCapabilityValue("measure_humidity", humidityValue);
      }
      if (targetHumidityValue !== null) {
        await this.updateCapabilityValue("target_humidity", targetHumidityValue / 100);
      }
      if (onOffValue !== null) {
        await this.updateCapabilityValue("onoff", onOffValue === 1);
      }
      if (temperatureValue !== null) {
        await this.updateCapabilityValue("measure_temperature", temperatureValue);
      }
      if (waterStatusValue !== null) {
        await this.updateCapabilityValue("alarm_water", waterStatusValue === 0);
      }
      if (waterTankStatusValue !== null) {
        await this.updateCapabilityValue("alarm_tank_empty", waterTankStatusValue !== 0);
      }
      
      /* settings */
      if (ledValue !== null) {
        await this.updateSettingValue("led", ledValue === 1);
      }
      if (buzzerValue !== null) {
        await this.updateSettingValue("buzzer", buzzerValue === 1);
      }

      /* mode capability */
      const modeCapabilityValue = modeValue !== null ? modeValue.toString() : null;
      if (modeCapabilityValue && validModeValues.has(modeCapabilityValue) && this.getCapabilityValue('humidifier_deerma_jsq_mode') !== modeCapabilityValue) {
        const previous_mode = this.getCapabilityValue('humidifier_deerma_jsq_mode');
        await this.setCapabilityValue('humidifier_deerma_jsq_mode', modeCapabilityValue);
        await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, {"new_mode": modes[modeValue], "previous_mode": modes[+previous_mode] }).catch(error => { this.error(error) });
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

module.exports = HumidifierDeermaJSQDevice;
