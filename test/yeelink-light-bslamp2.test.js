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

const legacyStatus = ['on', '42', '3500', '16711680', '1', '0'];
const timeout = () => Object.assign(new Error('Call to device timed out'), { code: 'timeout' });

async function makeLamp(handler, options = {}) {
  const device = Object.create(Lamp.prototype);
  device.calls = [];
  device.logs = [];
  device.errors = [];
  device.values = { light_hue: 0, light_saturation: 1, light_temperature: 0.5 };
  device.listeners = {};
  device.retries = [];
  device.added = [];
  device.available = true;
  device.homey = {
    __: () => '', clearInterval() {}, clearTimeout() {},
    setTimeout: (callback, delay) => device.retries.push({ callback, delay })
  };
  device.bootSequence = () => {};
  device.getStoreValue = () => 'yeelink.light.bslamp2';
  device.hasCapability = (id) => !options.capabilities || options.capabilities.has(id);
  device.addCapability = async (id) => {
    if (id === options.failCapability) throw new Error('Capability migration failed');
    device.added.push(id);
    options.capabilities?.add(id);
  };
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
  if (!options.failCapability) assert.deepEqual(device.errors, []);
  return device;
}

test('working MIoT polling and writes retain their existing protocol', async () => {
  const device = await makeLamp(async (method, params) => {
    if (method === 'get_properties') return params.map((property, index) => ({ ...property, code: 0, value: [true, 42, 3500, 0xff0000, 1][index] }));
    return method === 'get_prop' ? ['0'] : [{ code: 0 }];
  });
  await device.retrieveDeviceData();
  await device.listeners.onoff(false);
  assert.deepEqual(device.calls.map((call) => call.method), ['get_properties', 'get_prop', 'set_properties']);
  assert.deepEqual(device.calls[2].params, [{ siid: 2, piid: 1, value: false }]);
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
  assert.deepEqual(device.calls[1].params, ['power', 'bright', 'ct', 'rgb', 'color_mode', 'active_mode']);
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
  const device = await makeLamp(async () => [...legacyStatus.slice(0, 4), '3', '0']);
  device._useLegacyProtocol = true;
  await device.retrieveDeviceData();
  assert.equal(device.values.light_mode, 'color');
});

test('empty or invalid optional legacy properties do not prevent power and brightness polling', async () => {
  const device = await makeLamp(async (method) => {
    if (method === 'get_properties') throw timeout();
    return ['off', '25', null, -1, '', ''];
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

test('existing paired lamps gain scene controls once, without changing their existing capabilities', async () => {
  const capabilities = new Set(['onoff', 'dim', 'light_mode', 'light_temperature', 'light_hue', 'light_saturation']);
  const device = await makeLamp(async () => ['ok'], { capabilities });
  assert.deepEqual(device.added, ['yeelight_bslamp2_nightlight', 'yeelight_bslamp2_sunrise', 'yeelight_bslamp2_sunset', 'yeelight_bslamp2_stop']);
  await device.initializeSceneCapabilities();
  assert.equal(device.added.length, 4);
  assert.equal(capabilities.has('onoff'), true);
  assert.equal(typeof device.listeners.onoff, 'function');
  assert.deepEqual(device.calls, []);
});

test('a failed scene-capability migration logs the cause and keeps normal controls initialized', async () => {
  const capabilities = new Set(['onoff', 'dim', 'light_mode']);
  const device = await makeLamp(async () => ['ok'], { capabilities, failCapability: 'yeelight_bslamp2_nightlight' });
  assert.match(device.errors[0], /yeelight_bslamp2_nightlight.*Capability migration failed/);
  assert.equal(typeof device.listeners.onoff, 'function');
  assert.equal(typeof device.listeners.yeelight_bslamp2_sunrise, 'function');
  assert.equal(device.listeners.yeelight_bslamp2_nightlight, undefined);
});

test('Night Light toggle sends moonlight and normal power modes and synchronizes the on state', async () => {
  const device = await makeLamp(async () => ['ok']);
  await device.listeners.yeelight_bslamp2_nightlight(true);
  assert.equal(device.values.yeelight_bslamp2_nightlight, true);
  assert.equal(device.values.onoff, true);
  await device.listeners.yeelight_bslamp2_nightlight(false);
  assert.equal(device.values.yeelight_bslamp2_nightlight, false);
  assert.deepEqual(device.calls.map(({ method, params }) => [method, params]), [
    ['set_power', ['on', 'smooth', 500, 5]],
    ['set_power', ['on', 'smooth', 500, 1]]
  ]);
});

test('Sunrise and Sunset submit one complete lamp-side effect, with all steps and the correct finish action', async () => {
  const device = await makeLamp(async () => ['ok']);
  await device.listeners.yeelight_bslamp2_sunrise(true);
  await device.listeners.yeelight_bslamp2_sunset(true);
  const [rise, set] = device.calls;
  assert.equal(rise.method, 'set_scene');
  assert.equal(set.method, 'set_scene');
  for (const command of [rise, set]) {
    assert.equal(command.params[0], 'cf');
    assert.equal(command.params[1], 3);
    assert.equal(command.params[3].split(',').length / 4, 3);
  }
  assert.equal(rise.params[2], 1);
  assert.equal(set.params[2], 2);
  const riseSteps = rise.params[3].split(',').map(Number);
  const setSteps = set.params[3].split(',').map(Number);
  assert.equal(riseSteps[0] + riseSteps[4] + riseSteps[8], 900050);
  assert.equal(setSteps[0] + setSteps[4] + setSteps[8], 600050);
  assert.deepEqual(riseSteps.slice(-3), [2, 2700, 100]);
  assert.deepEqual(setSteps.slice(-3), [1, 0xff4c00, 1]);
  assert.equal(device.values.onoff, true);
  assert.equal(device.values.yeelight_bslamp2_nightlight, false);
  assert.deepEqual(device.retries, []);
  assert.match(device.logs.at(-1), /replaced/);
});

test('manual brightness stops an effect before changing the lamp, and the stop button is available independently', async () => {
  const device = await makeLamp(async () => ['ok']);
  device._useLegacyProtocol = true;
  await device.startScene('sunrise');
  await device.lightListener({ dim: 0.3 });
  await device.listeners.yeelight_bslamp2_stop(true);
  assert.deepEqual(device.calls.map((call) => call.method), ['set_scene', 'stop_cf', 'set_bright', 'stop_cf']);
  assert.equal(device._sceneActive, false);
});

test('a manual change cannot overtake an in-flight scene start', async () => {
  let resolve;
  let started;
  const sceneStarted = new Promise((done) => { started = done; });
  const device = await makeLamp(async (method) => {
    if (method !== 'set_scene') return ['ok'];
    started();
    return new Promise((done) => { resolve = done; });
  });
  device._useLegacyProtocol = true;
  const scene = device.startScene('sunset');
  await sceneStarted;
  const change = device.setMiotProperty('brightness', 30);
  assert.equal(device.calls.length, 1);
  resolve(['ok']);
  await Promise.all([scene, change]);
  assert.deepEqual(device.calls.map((call) => call.method), ['set_scene', 'stop_cf', 'set_power', 'set_bright']);
});

test('failed scene commands do not report success or prevent a later valid command', async () => {
  const failure = timeout();
  const device = await makeLamp(async (method) => {
    if (method === 'set_scene') throw failure;
    return ['ok'];
  });
  await assert.rejects(device.startScene('sunrise'), (error) => error === failure);
  assert.equal(device._sceneActive, undefined);
  assert.equal(device.values.onoff, undefined);
  await device.setNightLight(true);
  assert.equal(device.values.yeelight_bslamp2_nightlight, true);
});

test('unsupported scenes and invalid Night Light values never send a command', async () => {
  const device = await makeLamp(async () => ['ok']);
  await assert.rejects(device.setScene('unknown'), /Unsupported lamp scene/);
  await assert.rejects(device.setNightLight('true'), /must be on or off/);
  assert.deepEqual(device.calls, []);
});

test('deletion during a scene request prevents capability updates and any queued command', async () => {
  let resolve;
  let started;
  const sceneStarted = new Promise((done) => { started = done; });
  const device = await makeLamp(() => {
    started();
    return new Promise((done) => { resolve = done; });
  });
  const scene = device.startScene('sunrise');
  await sceneStarted;
  const night = device.setNightLight(true);
  await device.onDeleted();
  resolve(['ok']);
  await assert.rejects(scene, /connection changed/);
  await assert.rejects(night, /no longer active/);
  assert.equal(device.values.onoff, undefined);
  assert.equal(device.calls.length, 1);
});

test('Night Light status follows actual legacy active_mode, including physical power off and unknown readings', async () => {
  let status = [...legacyStatus.slice(0, 5), '1'];
  const device = await makeLamp(async () => status);
  device._useLegacyProtocol = true;
  await device.retrieveDeviceData();
  assert.equal(device.values.yeelight_bslamp2_nightlight, true);
  status = [...legacyStatus.slice(0, 5), ''];
  await device.retrieveDeviceData();
  assert.equal(device.values.yeelight_bslamp2_nightlight, true);
  status = ['off', ...legacyStatus.slice(1, 5), '1'];
  await device.retrieveDeviceData();
  assert.equal(device.values.yeelight_bslamp2_nightlight, false);
});

test('unsupported optional Night Light status does not make a working MIoT lamp unavailable', async () => {
  const device = await makeLamp(async (method, params) => {
    if (method === 'get_prop') throw Object.assign(new Error('Method not found'), { code: -32601 });
    return params.map((property, index) => ({ ...property, code: 0, value: [true, 42, 3500, 0xff0000, 1][index] }));
  });
  await device.retrieveDeviceData();
  await device.retrieveDeviceData();
  assert.equal(device.available, true);
  assert.equal(device.values.dim, 0.42);
  assert.equal(device._useLegacyProtocol, undefined);
  assert.equal(device.logs.filter((message) => message.includes('Night Light status read failed')).length, 1);
  assert.deepEqual(device.retries, []);
});

test('the driver Flow action routes every declared scene and propagates device failures', async () => {
  const fs = require('node:fs');
  let listener;
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '../wifi_driver.js') return class {
      onInit() { this.baseInitialized = true; }
    };
    return original.call(this, request, parent, isMain);
  };
  let Driver;
  try {
    Driver = require('../drivers/yeelink_light_bslamp2_miot/driver');
  } finally {
    Module._load = original;
  }
  const driver = new Driver();
  driver.homey = { flow: { getActionCard: (id) => {
    assert.equal(id, 'yeelightBslamp2Scene');
    return { registerRunListener: (callback) => { listener = callback; } };
  } } };
  await driver.onInit();
  assert.equal(driver.baseInitialized, true);
  const card = JSON.parse(fs.readFileSync(require.resolve('../.homeycompose/flow/actions/yeelightBslamp2Scene.json'), 'utf8'));
  const device = await makeLamp(async () => ['ok']);
  for (const scene of card.args.find((arg) => arg.name === 'scene').values) {
    assert.equal(await listener({ device, scene: scene.id }), true);
  }
  const failure = new Error('Firmware rejected scene');
  await assert.rejects(listener({ scene: 'sunrise', device: { setScene: async () => { throw failure; } } }), (error) => error === failure);
});
