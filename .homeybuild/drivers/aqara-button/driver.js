'use strict';

const Driver = require('../subdevice_driver.js');
const Util = require('../../lib/util.js');

class AqaraButton extends Driver {

  async onInit() {

    if (!this.util) this.util = new Util({homey: this.homey});

    this.homey.flow.getDeviceTriggerCard('click_single');
    this.homey.flow.getDeviceTriggerCard('click_double');
    this.homey.flow.getDeviceTriggerCard('click_long');

    this.config = {
      model: ["sensor_switch.aq2", "sensor_switch", "remote.b1acn01"]
    }

  }

}

module.exports = AqaraButton;