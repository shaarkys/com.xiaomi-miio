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

  async retrieveDeviceData() {
    try {

      const result = await this.miio.call("get_prop", ["Humidifier_Gear", "Humidity_Value", "HumiSet_Value", "Led_State", "OnOff_State", "TemperatureValue", "TipSound_State", "waterstatus", "watertankstatus"], { retries: 1 });
      if (!this.getAvailable()) { await this.setAvailable(); }

      /* capabilities */
      await this.updateCapabilityValue("measure_humidity", parseInt(result[1]));
      await this.updateCapabilityValue("target_humidity", parseInt(result[2]) / 100);
      await this.updateCapabilityValue("onoff", result[4] === 1 ? true : false);
      await this.updateCapabilityValue("measure_temperature", parseInt(result[5]));
      await this.updateCapabilityValue("alarm_water", result[7] === 0 ? true : false);
      await this.updateCapabilityValue("alarm_tank_empty", result[8] === 0 ? false : true);
      
      /* settings */
      await this.updateSettingValue("led", result[3] === 1 ? true : false);
      await this.updateSettingValue("buzzer", result[6] === 1 ? true : false);

      /* mode capability */
      if (this.getCapabilityValue('humidifier_deerma_jsq_mode') !== result[0].toString()) {
        const previous_mode = this.getCapabilityValue('humidifier_deerma_jsq_mode');
        await this.setCapabilityValue('humidifier_deerma_jsq_mode', result[0].toString());
        await this.homey.flow.getDeviceTriggerCard('triggerModeChanged').trigger(this, {"new_mode": modes[result[0]], "previous_mode": modes[+previous_mode] }).catch(error => { this.error(error) });
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
