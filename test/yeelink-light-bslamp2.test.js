'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'homey') return { Device: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const Lamp = require('../drivers/yeelink_light_bslamp2_miot/device');
Module._load = originalLoad;

const legacyStatus = ['on', '42', '3500', '16711680', '1'];
const timeout = () => Object.assign(new Error('Call to device timed out'), { code: 'timeout' });

async function makeLamp(handler) {
  const device = Object.create(Lamp.prototype);
  device.calls = [];
  device.logs = [];
  device.errors = [];
  device.values = { light_hue: 0, light_saturation: 1, light_temperature: 0.5 };
  device.listeners = {};
  device.retries = [];
  device.available = true;
  device.homey = {
    __: () => '', clearInterval() {}, clearTimeout() {},
    setTimeout: (callback, delay) => device.retries.push({ callback, delay })
  };
  device.bootSequence = () => {};
  device.getStoreValue = () => 'yeelink.light.bslamp2';
  device.hasCapability = () => true;
  device.registerCapabilityListener = (id, callback) => { device.listeners[id] = callback; };
  device.registerMultipleCapabilityListener = (ids, callback) => { device.lightListener = callback; };
  device.getCapabilityValue = (id) => device.values[id];
  device.updateCapabilityValue = async (id, value) => { device.values[id] = value; };
  device.getAvailable = () => device.available;
  device.setAvailable = async () => { device.available = true; };
  device.setUnavailable = async (message) => { device.available = false; device.unavailableMessage = message; };
  device.log = (...args) => device.logs.push(args.join(' '));
  device.error = (...args) => device.errors.push(args.join(' '));
  device.miio = {
    call: async (method, params, options) => {
      device.calls.push({ method, params, options });
      return handler(method, params, options);
    },
    destroy() {}
  };
  await device.onInit();
  assert.deepEqual(device.errors, []);
  return device;
}

test('working MIoT polling and writes retain their existing protocol', async () => {
  const device = await makeLamp(async (method, params) => method === 'get_properties'
    ? params.map((property, index) => ({ ...property, code: 0, value: [true, 42, 3500, 0xff0000, 1][index] }))
    : [{ code: 0 }]);
  await device.retrieveDeviceData();
  await device.listeners.onoff(false);
  assert.deepEqual(device.calls.map((call) => call.method), ['get_properties', 'set_properties']);
  assert.deepEqual(device.calls[1].params, [{ siid: 2, piid: 1, value: false }]);
  assert.equal(device.values.dim, 0.42);
  assert.equal(device._useLegacyProtocol, undefined);
});

test('a timed out MIoT poll selects validated legacy status for subsequent polls and controls', async () => {
  const device = await makeLamp(async (method) => {
    if (method === 'get_properties') throw timeout();
    return method === 'get_prop' ? legacyStatus : ['ok'];
  });
  device.available = false;
  await device.retrieveDeviceData();
  await device.retrieveDeviceData();
  await device.listeners.onoff(false);
  assert.deepEqual(device.calls.map((call) => call.method), ['get_properties', 'get_prop', 'get_prop', 'set_power']);
  assert.deepEqual(device.calls[1].params, ['power', 'bright', 'ct', 'rgb', 'color_mode']);
  assert.deepEqual(device.calls[3].params, ['off', 'smooth', 500]);
  assert.equal(device.values.onoff, true);
  assert.equal(device.values.dim, 0.42);
  assert.equal(device.values.light_mode, 'color');
  assert.equal(device.values.light_hue, 0);
  assert.equal(device.values.light_saturation, 1);
  assert.equal(device.available, true);
  assert.equal(device.logs.filter((line) => line.includes('switching to legacy')).length, 1);
  assert.deepEqual(device.retries, []);
});

test('a timed out power write probes legacy status before retrying as an absolute power command', async () => {
  const device = await makeLamp(async (method) => {
    if (method === 'set_properties') throw timeout();
    return method === 'get_prop' ? legacyStatus : ['ok'];
  });
  await device.listeners.onoff(true);
  assert.deepEqual(device.calls.map((call) => call.method), ['set_properties', 'get_prop', 'set_power']);
  assert.deepEqual(device.calls[2].params, ['on', 'smooth', 500]);
});

test('legacy brightness, temperature, RGB and standalone mode changes use Yeelight commands', async () => {
  const device = await makeLamp(async () => ['ok']);
  device._useLegacyProtocol = true;
  await device.lightListener({ dim: 0.25 });
  await device.lightListener({ light_temperature: 1 });
  await device.lightListener({ light_hue: 1 / 3, light_saturation: 1 });
  await device.lightListener({ light_mode: 'temperature' });
  await device.lightListener({ light_mode: 'color' });
  assert.deepEqual(device.calls.map(({ method, params }) => [method, params]), [
    ['set_bright', [25, 'smooth', 500]],
    ['set_ct_abx', [1700, 'smooth', 500]],
    ['set_rgb', [0x00ff00, 'smooth', 500]],
    ['set_ct_abx', [4100, 'smooth', 500]],
    ['set_rgb', [0xff0000, 'smooth', 500]]
  ]);
});

test('legacy HSV mode is reported as colour', async () => {
  const device = await makeLamp(async () => [...legacyStatus.slice(0, 4), '3']);
  device._useLegacyProtocol = true;
  await device.retrieveDeviceData();
  assert.equal(device.values.light_mode, 'color');
});

test('empty or invalid optional legacy properties do not prevent power and brightness polling', async () => {
  const device = await makeLamp(async (method) => {
    if (method === 'get_properties') throw timeout();
    return ['off', '25', null, -1, ''];
  });
  await device.retrieveDeviceData();
  assert.equal(device._useLegacyProtocol, true);
  assert.equal(device.values.onoff, false);
  assert.equal(device.values.dim, 0.25);
  assert.equal(device.values.light_temperature, 0.5);
  assert.equal(device.values.light_mode, undefined);
});

test('legacy fallback also accepts an explicit method-not-found response', async () => {
  const device = await makeLamp(async (method) => {
    if (method === 'get_properties') throw Object.assign(new Error('Method not found'), { code: -32601 });
    return legacyStatus;
  });
  await device.readProperties();
  assert.equal(device._useLegacyProtocol, true);
});

test('other MIoT errors do not switch protocol', async () => {
  const failure = Object.assign(new Error('Permission denied'), { code: -4003 });
  const device = await makeLamp(async () => { throw failure; });
  await assert.rejects(device.readProperties(), (error) => error === failure);
  assert.equal(device.calls.length, 1);
  assert.equal(device._useLegacyProtocol, undefined);
});

test('a failed legacy probe preserves both failures and does not select legacy commands', async () => {
  const device = await makeLamp(async (method) => {
    if (method === 'get_properties') throw timeout();
    throw new Error('Legacy request also timed out');
  });
  await device.retrieveDeviceData();
  assert.equal(device._useLegacyProtocol, undefined);
  assert.match(device.unavailableMessage, /MIoT failed: Call to device timed out; legacy Yeelight probe failed: Legacy request also timed out/);
  assert.equal(device.retries.length, 1);
});

test('malformed legacy status cannot select the fallback or trigger a write', async () => {
  for (const response of [[], ['on'], ['on', '', 3500, 1, 1], ['on', true, 3500, 1, 1], ['invalid', 25, 3500, 1, 1]]) {
    const device = await makeLamp(async (method) => {
      if (method === 'set_properties') throw timeout();
      return response;
    });
    await assert.rejects(device.listeners.onoff(true), /Invalid Yeelight bslamp2 legacy status response/);
    assert.equal(device._useLegacyProtocol, undefined);
    assert.deepEqual(device.calls.map((call) => call.method), ['set_properties', 'get_prop']);
  }
});

test('deletion during MIoT timeout prevents the legacy probe', async () => {
  let reject;
  const device = await makeLamp(() => new Promise((resolve, fail) => { reject = fail; }));
  const poll = device.retrieveDeviceData();
  await device.onDeleted();
  reject(timeout());
  await poll;
  assert.equal(device.calls.length, 1);
  assert.deepEqual(device.retries, []);
});

test('deletion during the legacy probe prevents fallback writes and protocol selection', async () => {
  let resolve;
  let started;
  const probeStarted = new Promise((done) => { started = done; });
  const device = await makeLamp(async (method) => {
    if (method === 'set_properties') throw timeout();
    started();
    return new Promise((done) => { resolve = done; });
  });
  const write = device.listeners.onoff(true);
  await probeStarted;
  await device.onDeleted();
  resolve(legacyStatus);
  await assert.rejects(write, /Call to device timed out/);
  assert.equal(device._useLegacyProtocol, undefined);
  assert.equal(device.calls.length, 2);
});

test('legacy write failures are returned to the caller', async () => {
  const device = await makeLamp(async () => ['error']);
  device._useLegacyProtocol = true;
  await assert.rejects(device.listeners.onoff(true), /set_power did not return ok/);
});
