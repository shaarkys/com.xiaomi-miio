'use strict';

const Driver = require('../wifi_driver.js');

class AdvancedDmakerFanMiotDriver extends Driver {

  onInit() {
    super.onInit();

    // Flow capability filters do not track capabilities added to existing devices during migration.
    const requireCapability = (device, capabilityId) => {
      if (!device.hasCapability(capabilityId)) {
        throw new Error('This fan does not support vertical swing');
      }
    };

    this.homey.flow.getActionCard('rotateLeftStep')
      .registerRunListener(({ device }) => device.rotateFanHead('left'));

    this.homey.flow.getActionCard('rotateRightStep')
      .registerRunListener(({ device }) => device.rotateFanHead('right'));

    this.homey.flow.getActionCard('rotateUpStep')
      .registerRunListener(({ device }) => device.rotateFanHead('up'));

    this.homey.flow.getActionCard('rotateDownStep')
      .registerRunListener(({ device }) => device.rotateFanHead('down'));

    this.homey.flow.getActionCard('verticalSwingOn')
      .registerRunListener(({ device }) => {
        requireCapability(device, 'fan_dmaker_vertical_swing');
        return device.triggerCapabilityListener('fan_dmaker_vertical_swing', true);
      });

    this.homey.flow.getActionCard('verticalSwingOff')
      .registerRunListener(({ device }) => {
        requireCapability(device, 'fan_dmaker_vertical_swing');
        return device.triggerCapabilityListener('fan_dmaker_vertical_swing', false);
      });

    this.homey.flow.getActionCard('verticalSwingToggle')
      .registerRunListener(({ device }) => {
        requireCapability(device, 'fan_dmaker_vertical_swing');
        return device.triggerCapabilityListener('fan_dmaker_vertical_swing', !device.getCapabilityValue('fan_dmaker_vertical_swing'));
      });

    this.homey.flow.getActionCard('setVerticalAngle')
      .registerRunListener(({ device, angle }) => {
        requireCapability(device, 'fan_dmaker_vertical_angle');
        return device.triggerCapabilityListener('fan_dmaker_vertical_angle', angle);
      });

    this.homey.flow.getConditionCard('verticalSwingIsOn')
      .registerRunListener(({ device }) => {
        requireCapability(device, 'fan_dmaker_vertical_swing');
        return device.getCapabilityValue('fan_dmaker_vertical_swing') === true;
      });
  }

}

module.exports = AdvancedDmakerFanMiotDriver;
