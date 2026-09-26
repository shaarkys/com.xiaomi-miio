'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class WifiDeviceStub {}

const originalLoad = Module._load;
Module._load = function loadWithHomeyAndWifiDeviceStubs(request, parent, isMain) {
  if (request === 'homey') {
    return { Device: class Device {} };
  }
  if (request === '../wifi_device.js') {
    return WifiDeviceStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const YeelightCeilingLight5Device = require('../drivers/yeelink_light_ceiling5/device.js');
const Util = require('../lib/util.js');
Module._load = originalLoad;

function createDevice(getPropResult) {
  const device = Object.create(YeelightCeilingLight5Device.prototype);
  device.util = new Util({ homey: {} });
  device.calls = [];
  device.values = {};
  device.miio = {
    call: async (method, params) => {
      device.calls.push([method, params]);
      return method === 'get_prop' ? getPropResult : ['ok'];
    }
  };
  device.getAvailable = () => true;
  device.updateCapabilityValue = async (capability, value) => { device.values[capability] = value; };
  device.error = () => {};
  return device;
}

test('polls with legacy get_prop instead of MIoT get_properties', async () => {
  const device = createDevice(['on', '27', '2801', '0', '0']);

  await device.retrieveDeviceData();

  assert.deepEqual(device.calls, [['get_prop', ['power', 'bright', 'ct', 'nl_br', 'active_mode']]]);
  assert.equal(device.values.onoff, true);
  assert.equal(device.values['onoff.nightlight'], false);
  assert.equal(device.values.dim, 0.27);
  assert.equal(device.values.light_temperature, 0.97);
});

test('reports night light brightness while night light mode is active', async () => {
  const device = createDevice(['on', '27', '3500', '48', '1']);

  await device.retrieveDeviceData();

  assert.equal(device.values['onoff.nightlight'], true);
  assert.equal(device.values.dim, 0.48);
});

test('maps Homey light temperature onto the 2700-6500K range', async () => {
  const device = createDevice([]);

  await device.sendCommand('set_ct_abx', [device.util.denormalize(0, 2700, 6500), 'smooth', 500]);
  await device.sendCommand('set_ct_abx', [device.util.denormalize(1, 2700, 6500), 'smooth', 500]);

  assert.deepEqual(device.calls.map(([, params]) => params[0]), [6500, 2700]);
});
