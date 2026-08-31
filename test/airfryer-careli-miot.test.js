'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const {
  getModelProfile,
  findValidResult,
  encodePreheat,
  decodePreheat
} = require('../lib/airfryer-careli-miot.js');
const Util = require('../lib/util.js');
const modeCapability = require('../.homeycompose/capabilities/airfryer_careli_mode.json');

const originalLoad = Module._load;
Module._load = function loadWithHomeyAndWifiDeviceStubs(request, parent, isMain) {
  if (request === 'homey') return {};
  if (request === '../wifi_device.js' && /airfryer_careli_miot[\\/]device\.js$/.test(parent.filename)) {
    return class WifiDevice {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

const AirfryerCareliMiotDevice = require('../drivers/airfryer_careli_miot/device.js');
Module._load = originalLoad;

function createDevice(model, response = []) {
  const calls = [];
  const capabilityOptions = {};
  const capabilityValues = new Map();
  const clearedTimeouts = [];
  const errors = [];
  const listeners = {};
  const scheduledTimeouts = [];
  const settings = {};
  const triggers = [];
  let available = false;
  let bootCount = 0;
  let createCount = 0;

  const device = Object.create(AirfryerCareliMiotDevice.prototype);
  device.util = {};
  device.homey = {
    __: (key) => key,
    clearInterval: () => {},
    clearTimeout: (handle) => clearedTimeouts.push(handle),
    setTimeout: (callback, delay) => {
      const handle = { callback, delay };
      scheduledTimeouts.push(handle);
      return handle;
    },
    flow: {
      getDeviceTriggerCard: () => ({
        trigger: async (...args) => triggers.push(args)
      })
    }
  };
  device.getStoreValue = (key) => key === 'model' ? model : undefined;
  device.hasCapability = () => true;
  device.getCapabilityOptions = () => ({});
  device.setCapabilityOptions = async (capability, options) => {
    capabilityOptions[capability] = options;
  };
  device.registerCapabilityListener = (capability, listener) => {
    listeners[capability] = listener;
  };
  device.bootSequence = () => { bootCount += 1; };
  device.miio = {
    call: async (...args) => {
      calls.push(args);
      return args[0] === 'get_properties' ? response : ['ok'];
    }
  };
  device.getAvailable = () => available;
  device.setAvailable = async () => { available = true; };
  device.setUnavailable = async (message) => { available = false; settings.unavailable = message; };
  device.updateCapabilityValue = async (capability, value) => {
    capabilityValues.set(capability, value);
  };
  device.getCapabilityValue = (capability) => capabilityValues.get(capability) ?? null;
  device.setCapabilityValue = async (capability, value) => {
    capabilityValues.set(capability, value);
  };
  device.updateSettingValue = async (setting, value) => {
    settings[setting] = value;
  };
  device.createDevice = () => { createCount += 1; };
  device.error = (...args) => errors.push(args);

  return {
    calls,
    capabilityOptions,
    capabilityValues,
    clearedTimeouts,
    device,
    errors,
    getBootCount: () => bootCount,
    getCreateCount: () => createCount,
    listeners,
    scheduledTimeouts,
    settings,
    triggers
  };
}

test('xiaomi.fryer.maf65 uses its released service-2 MIoT property layout', () => {
  const profile = getModelProfile('xiaomi.fryer.maf65');
  const readable = Object.fromEntries(profile.properties.get_properties.map(({ did, siid, piid }) => [did, { siid, piid }]));

  assert.equal(profile.mapping, 'properties_maf65');
  assert.deepEqual(readable, {
    status: { siid: 2, piid: 1 },
    fault: { siid: 2, piid: 2 },
    target_time: { siid: 2, piid: 3 },
    target_temperature: { siid: 2, piid: 4 },
    food_quantity: { siid: 2, piid: 13 },
    preheat_switch: { siid: 2, piid: 9 }
  });
  assert.deepEqual(profile.properties.set_properties.food_quantity, { siid: 2, piid: 13 });
  assert.deepEqual(profile.properties.set_properties.preheat_switch, { siid: 2, piid: 9 });
  assert.deepEqual(profile.properties.actions.start_cook, { siid: 2, aiid: 1, did: 'call-2-1', in: [] });
  assert.deepEqual(profile.properties.actions.stop_cook, { siid: 2, aiid: 2, did: 'call-2-2', in: [] });
});

test('legacy Careli profiles retain their existing property IDs and preheat encoding', () => {
  const profile = getModelProfile('careli.fryer.maf02');
  const maf10a = getModelProfile('careli.fryer.maf10a');

  assert.equal(profile.mapping, 'properties_default');
  assert.deepEqual(profile.properties.set_properties.food_quantity, { siid: 3, piid: 6 });
  assert.deepEqual(profile.properties.set_properties.preheat_switch, { siid: 3, piid: 7 });
  assert.equal(encodePreheat(profile, true), 2);
  assert.equal(encodePreheat(profile, false), 1);
  assert.equal(decodePreheat(profile, 2), true);
  assert.equal(decodePreheat(profile, 1), false);
  assert.equal(profile.status_names[9], 'Pause2');
  assert.equal(maf10a.mapping, 'properties_maf10a');
  assert.equal(maf10a.properties.get_properties.some(({ did }) => did === 'food_quantity'), false);
});

test('maf65 initialization applies its temperature range and routes writes through its profile', async () => {
  const fixture = createDevice('xiaomi.fryer.maf65');
  await fixture.device.onInit();

  assert.equal(fixture.getBootCount(), 1);
  assert.deepEqual(fixture.capabilityOptions.airfryer_careli_target_temperature, { min: 40, max: 230, step: 5 });

  await fixture.listeners.airfryer_careli_target_temperature(230);
  await fixture.listeners['onoff.preheat'](true);
  await fixture.listeners.airfryer_careli_food_quantity('4');
  await fixture.listeners.onoff(false);

  assert.deepEqual(fixture.calls, [
    ['set_properties', [{ siid: 2, piid: 4, value: 230 }], { retries: 1 }],
    ['set_properties', [{ siid: 2, piid: 9, value: true }], { retries: 1 }],
    ['set_properties', [{ siid: 2, piid: 13, value: 4 }], { retries: 1 }],
    ['action', { siid: 2, aiid: 2, did: 'call-2-2', in: [] }, { retries: 1 }]
  ]);
});

test('maf65 polling accepts released values including status 13, E3, preheat and quantity', async () => {
  const response = [
    { did: 'status', code: 0, value: 13 },
    { did: 'fault', code: 0, value: 3 },
    { did: 'target_time', code: 0, value: 90 },
    { did: 'target_temperature', code: 0, value: 230 },
    { did: 'food_quantity', code: 0, value: 4 },
    { did: 'preheat_switch', code: 0, value: true }
  ];
  const fixture = createDevice('xiaomi.fryer.maf65', response);
  await fixture.device.onInit();
  fixture.capabilityValues.set('airfryer_careli_mode', '12');

  await fixture.device.retrieveDeviceData();

  assert.deepEqual(fixture.calls[0], ['get_properties', fixture.device.deviceProperties.get_properties, { retries: 1 }]);
  assert.equal(fixture.capabilityValues.get('airfryer_careli_target_time'), 90);
  assert.equal(fixture.capabilityValues.get('airfryer_careli_target_temperature'), 230);
  assert.equal(fixture.capabilityValues.get('airfryer_careli_food_quantity'), '4');
  assert.equal(fixture.capabilityValues.get('onoff.preheat'), true);
  assert.equal(fixture.capabilityValues.get('onoff'), true);
  assert.equal(fixture.capabilityValues.get('airfryer_careli_mode'), '13');
  assert.equal(fixture.settings.error, 'E3');
  assert.deepEqual(fixture.triggers[0].slice(1), [{ new_mode: 'Crispy roast', previous_mode: 'Keep warm finished' }]);
  assert.deepEqual(fixture.errors, []);
  assert.equal(fixture.scheduledTimeouts.length, 0);
});

test('failed optional legacy properties are ignored without dropping the connection', async () => {
  const response = [
    { did: 'status', code: 0, value: 4 },
    { did: 'fault', code: 0, value: 0 },
    { did: 'target_time', code: 0, value: 30 },
    { did: 'target_temperature', code: 0, value: 180 },
    { did: 'food_quantity', code: -4004 },
    { did: 'preheat_switch', code: 0, value: null }
  ];
  const fixture = createDevice('careli.fryer.maf02', response);
  await fixture.device.onInit();

  await fixture.device.retrieveDeviceData();

  assert.equal(fixture.capabilityValues.has('airfryer_careli_food_quantity'), false);
  assert.equal(fixture.capabilityValues.has('onoff.preheat'), false);
  assert.equal(fixture.capabilityValues.get('onoff'), true);
  assert.deepEqual(fixture.errors, []);
  assert.equal(fixture.scheduledTimeouts.length, 0);
});

test('missing required MIoT data schedules one tracked reconnect with an actionable error', async () => {
  const response = [
    { did: 'fault', code: 0, value: 0 },
    { did: 'target_time', code: 0, value: 30 },
    { did: 'target_temperature', code: 0, value: 180 }
  ];
  const fixture = createDevice('xiaomi.fryer.maf65', response);
  await fixture.device.onInit();
  fixture.device.recreateTimeout = { old: true };
  await fixture.device.setAvailable();

  await fixture.device.retrieveDeviceData();

  assert.deepEqual(fixture.clearedTimeouts, [{ old: true }]);
  assert.equal(fixture.device.recreateTimeout, fixture.scheduledTimeouts[0]);
  assert.equal(fixture.scheduledTimeouts[0].delay, 60000);
  assert.equal(fixture.getCreateCount(), 0);
  assert.match(fixture.settings.unavailable, /missing valid status/);
  assert.equal(fixture.errors[0][0], 'Invalid MIoT response: missing valid status');
});

test('valid-result filtering preserves false and zero while rejecting failures and empty values', () => {
  const result = [
    { did: 'failed', code: -4004 },
    { did: 'empty', code: 0, value: null },
    { did: 'off', code: 0, value: false },
    { did: 'zero', value: 0 }
  ];

  assert.equal(findValidResult(result, 'failed'), undefined);
  assert.equal(findValidResult(result, 'empty'), undefined);
  assert.deepEqual(findValidResult(result, 'off'), result[2]);
  assert.deepEqual(findValidResult(result, 'zero'), result[3]);
});

test('published mode IDs and the pairing name cover every maf65 status', () => {
  assert.deepEqual(modeCapability.values.map(({ id }) => id), Array.from({ length: 15 }, (_, id) => String(id)));
  assert.equal(new Util({}).getFriendlyNameWiFi('xiaomi.fryer.maf65'), 'Xiaomi Smart Air Fryer 6.5L');
});
