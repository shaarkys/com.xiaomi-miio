const Homey = require("homey");

class AqaraCurtainAQ2 extends Homey.Device {
  async onInit() {
    this.initialize = this.initialize.bind(this);
    this.handleStateChange = this.handleStateChange.bind(this);
    this.driver = this.getDriver();
    this.data = this.getData();
    this.initialize();
    this.log("Mi Homey device init | name: " + this.getName() + " - class: " + this.getClass() + " - data: " + JSON.stringify(this.data));
  }

  async initialize() {
    if (Homey.app.mihub.hubs) {
      this.registerStateChangeListener();
      this.registerCapabilities();
    } else {
      this.unregisterStateChangeListener();
    }
  }

  registerCapabilities() {
    this.registerToggle("onoff", "open", "close");
    this.registerDim("dim");
    this.registerCovering("windowcoverings_state");
  }

  handleStateChange(device) {
    if (parseInt(device["data"]["curtain_level"]) > 0) {
      this.updateCapabilityValue("onoff", true);
    }

    if (parseInt(device["data"]["curtain_level"]) == 0) {
      this.updateCapabilityValue("onoff", false);
    }

    if (device["data"]["curtain_level"]) {
      this.updateCapabilityValue("dim", parseInt(device["data"]["curtain_level"]) / 100);
    }

    clearTimeout(this.curtainTernaryTimeout);

    this.curtainTernaryTimeout = setTimeout(() => {
      this.setCapabilityValue("windowcoverings_state", "idle");
    }, 3000);

    let gateways = Homey.app.mihub.gateways;
    for (let sid in gateways) {
      gateways[sid]["childDevices"].forEach(deviceSid => {
        if (this.data.sid == deviceSid) {
          this.setSettings({
            gatewaySid: sid
          });
        }
      });
    }
  }

  registerAuthChangeListener() {
    Homey.app.mihub.on("gatewaysList", this.initialize);
  }

  registerStateChangeListener() {
    Homey.app.mihub.on(`${this.data.sid}`, this.handleStateChange);
  }

  unregisterAuthChangeListener() {
    Homey.app.mihub.removeListener("gatewaysList", this.initialize);
  }

  unregisterStateChangeListener() {
    Homey.app.mihub.removeListener(`${this.data.sid}`, this.handleStateChange);
  }

  updateCapabilityValue(name, value) {
    if (this.getCapabilityValue(name) != value) {
      this.setCapabilityValue(name, value)
        .then(() => {
          this.log("[" + this.data.sid + "]" + " [" + name + "] [" + value + "] Capability successfully updated");
        })
        .catch(error => {
          this.log("[" + this.data.sid + "]" + " [" + name + "] [" + value + "] Capability not updated because there are errors: " + error.message);
        });
    }
  }

  registerToggle(name, valueOn = true, valueOff = false) {
    let sid = this.data.sid;
    this.registerCapabilityListener(name, async value => {
      const newValue = value ? valueOn : valueOff;
      const data = { curtain_status: newValue };
      await Homey.app.mihub.sendWrite(sid, data);
    });
  }

  registerDim(name) {
    let sid = this.data.sid;
    this.registerCapabilityListener(name, async value => {
      const level = Math.round(value * 100);
      const data = { curtain_level: level.toString() };
      await Homey.app.mihub.sendWrite(sid, data);
    });
  }

  registerCovering(name) {
    let sid = this.data.sid;
    this.registerCapabilityListener(name, async value => {
      const states = { up: "open", idle: "stop", down: "close" };
      const data = { curtain_status: states[value] };
      await Homey.app.mihub.sendWrite(sid, data);
    });
  }

  onAdded() {
    this.log("Device added");
  }

  onDeleted() {
    this.unregisterAuthChangeListener();
    this.unregisterStateChangeListener();
    this.log("Device deleted deleted");
  }
}

module.exports = AqaraCurtainAQ2;