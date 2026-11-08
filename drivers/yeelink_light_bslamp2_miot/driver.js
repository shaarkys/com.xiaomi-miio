'use strict';

const Driver = require('../wifi_driver.js');

class XiaomiMiBedsideLamp2Driver extends Driver {
  async onInit() {
    await super.onInit();
    this.homey.flow.getActionCard('yeelightBslamp2Scene').registerRunListener(async (args) => {
      return args.device.setScene(args.scene);
    });
  }
}

module.exports = XiaomiMiBedsideLamp2Driver;
