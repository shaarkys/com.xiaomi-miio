'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let connect;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'homey') return { Device: class {} };
  if (request === 'miio') return { device: (...args) => connect(...args) };
  return originalLoad.call(this, request, parent, isMain);
};
const WifiDevice = require('../drivers/wifi_device');
const Lamp = require('../drivers/yeelink_light_bslamp2_miot/device');
Module._load = originalLoad;

function makeDevice(Type) {
  const device = Object.create(Type.prototype);
  device.homey = { clearInterval() {}, clearTimeout() {}, setTimeout() { throw new Error('unexpected retry'); }, __: () => '' };
  device.getSetting = () => '';
  device.error = () => {};
  return device;
}

test('deletion during connection disposes a late connection without retrying', async () => {
  const device = makeDevice(WifiDevice);
  let resolve;
  let destroyed = 0;
  connect = () => new Promise((done) => { resolve = done; });
  const attempt = device.createDevice();
  await device.onDeleted();
  resolve({ destroy() { destroyed++; } });
  await attempt;
  await device.createDevice();
  assert.equal(destroyed, 1);
  assert.equal(device.miio, null);
});

test('a lamp poll failing after deletion does not schedule a reconnect', async () => {
  const device = makeDevice(Lamp);
  let reject;
  device.miio = { call: () => new Promise((_, fail) => { reject = fail; }), destroy() {} };
  device.deviceProperties = { get_properties: [] };
  const poll = device.retrieveDeviceData();
  await device.onDeleted();
  reject(new Error('timeout'));
  await poll;
  assert.equal(device.isRetrievingDeviceData, false);
});
