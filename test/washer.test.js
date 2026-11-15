'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

function loadDeviceClass() {
  const originalLoad = Module._load;
  Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../drivers/washer/device.js');
  } finally {
    Module._load = originalLoad;
  }
}

const DeviceClass = loadDeviceClass();
const manifest = require('../drivers/washer/driver.compose.json');
const newCapabilities = [
  'xiaomi_washer_washed_times', 'xiaomi_washer_door_state', 'alarm_washer_door_locked',
  'xiaomi_washer_detergent_level', 'alarm_washer_detergent_low',
  'xiaomi_washer_softener_level', 'alarm_washer_softener_low',
];
const consumables = [
  ['detergent_left_level', 'xiaomi_washer_detergent_level', 'alarm_washer_detergent_low', 'washerDetergentLow'],
  ['softener_left_level', 'xiaomi_washer_softener_level', 'alarm_washer_softener_low', 'washerSoftenerLow'],
];

async function createDevice({ failCapability } = {}) {
  const device = Object.create(DeviceClass.prototype);
  device.values = new Map();
  device.capabilities = new Set(manifest.capabilities.filter(id => !newCapabilities.includes(id)));
  device.added = [];
  device.errors = [];
  device.logs = [];
  device.triggers = [];
  device.calls = [];
  device.timers = [];
  device.listeners = new Map();
  device.settings = {};
  device.store = { model: 'mibx5.washer.f05gl' };
  device.util = {};
  device.bootSequence = () => {};
  device.log = (...args) => device.logs.push(args);
  device.error = (...args) => device.errors.push(args);
  device.getName = () => 'Test washer';
  device.getData = () => ({ id: 'test-washer' });
  device.getStoreValue = key => device.store[key];
  device.setStoreValue = async (key, value) => { device.store[key] = value; };
  device.hasCapability = id => device.capabilities.has(id);
  device.addCapability = async id => {
    if (id === failCapability) throw new Error('migration failed');
    device.added.push(id);
    device.capabilities.add(id);
  };
  device.removeCapability = async id => device.capabilities.delete(id);
  device.getCapabilityValue = id => device.values.get(id) ?? null;
  device.setCapabilityValue = async (id, value) => {
    assert.ok(device.hasCapability(id));
    device.values.set(id, value);
  };
  device.updateSettingValue = async (key, value) => { device.settings[key] = value; };
  device.registerCapabilityListener = (id, listener) => device.listeners.set(id, listener);
  device.getAvailable = () => true;
  device.setUnavailable = async () => {};
  device.homey = {
    __: key => key,
    clearInterval: () => {},
    setTimeout: callback => device.timers.push(callback),
    flow: { getDeviceTriggerCard: id => ({ trigger: async (target, tokens, state) => {
      assert.equal(target, device);
      assert.deepEqual(tokens, {});
      assert.deepEqual(state, {});
      device.triggers.push(id);
    } }) },
  };
  device.response = [];
  device.miio = { call: async (...args) => {
    device.calls.push(args);
    return device.response;
  } };
  await device.onInit();
  return device;
}

function reading(device, did, value, overrides = {}) {
  const definition = device.deviceProperties.get_properties.find(entry => entry.did === did);
  assert.ok(definition, did);
  return { ...definition, code: 0, value, ...overrides };
}

test('existing washer migration adds seven capabilities once and preserves existing interfaces', async () => {
  const device = await createDevice();
  assert.deepEqual(new Set(device.added), new Set(newCapabilities));
  const capabilities = new Set(device.capabilities);
  await device.onInit();
  assert.equal(device.added.length, 7);
  assert.deepEqual(device.capabilities, capabilities);
  assert.equal(device.store.model, 'mibx5.washer.f05gl');
  assert.equal(device.errors.length, 0);
  assert.ok(device.logs.some(args => /Adding washer capability/.test(args[0])));
  assert.ok(device.logs.some(args => /Added washer capability/.test(args[0])));
  for (const id of ['xiaomi_washer_left_time', 'meter_power', 'meter_water']) {
    device.capabilities.add(id);
  }
  await device.cleanupWasherCapabilities();
  assert.deepEqual(device.capabilities, capabilities);
});

test('migration failure logs the capability and cause and continues initialization', async () => {
  const device = await createDevice({ failCapability: 'xiaomi_washer_washed_times' });
  assert.equal(device.hasCapability('xiaomi_washer_washed_times'), false);
  assert.ok(device.hasCapability('alarm_washer_softener_low'));
  assert.ok(device.listeners.has('xiaomi_washer_start'));
  assert.match(device.errors[0][0], /Failed to add washer capability xiaomi_washer_washed_times/);
  assert.match(device.errors[0][1].message, /migration failed/);
});

test('polling matches MIoT addresses with physical DIDs and retains existing washer readings and triggers', async () => {
  const device = await createDevice();
  device.store.previous_status = 1;
  device.response = [
    ['power', true], ['status', 3], ['fault', 0], ['mode', 1], ['spin_speed', 1200],
    ['target_temperature', 40], ['left_time', 25], ['has_washed_times', 42],
    ['door_state', 3], ['detergent_left_level', 2], ['softener_left_level', 1],
  ].map(([did, value]) => reading(device, did, value, { did: 'physical-did' })).reverse();
  await device.retrieveDeviceData();
  assert.equal(device.getCapabilityValue('onoff'), true);
  assert.equal(device.getCapabilityValue('measure_washer_left_time'), 25);
  assert.equal(device.getCapabilityValue('measure_temperature'), 40);
  assert.equal(device.getCapabilityValue('xiaomi_washer_mode'), '1');
  assert.equal(device.getCapabilityValue('xiaomi_washer_spin_speed'), '1200');
  assert.equal(device.getCapabilityValue('xiaomi_washer_washed_times'), 42);
  assert.equal(device.getCapabilityValue('xiaomi_washer_door_state'), '3');
  assert.equal(device.getCapabilityValue('alarm_washer_door_locked'), true);
  assert.equal(device.getCapabilityValue('xiaomi_washer_detergent_level'), 'normal');
  assert.equal(device.getCapabilityValue('alarm_washer_detergent_low'), false);
  assert.equal(device.getCapabilityValue('xiaomi_washer_softener_level'), 'low');
  assert.equal(device.getCapabilityValue('alarm_washer_softener_low'), true);
  assert.deepEqual(device.triggers, ['washerStarted']);
  assert.equal(device.settings.error, 'No Faults');
  device.response = [reading(device, 'status', 5)];
  await device.retrieveDeviceData();
  assert.deepEqual(device.triggers, ['washerStarted', 'washerFinished']);
  assert.deepEqual(device.calls[0], ['get_properties', device.deviceProperties.get_properties, { retries: 1 }]);
  assert.deepEqual(device.errors, []);
});

for (const [did, enumId, alarmId, triggerId] of consumables) {
  test(`${did}: first low poll and restart while low do not trigger; normal-to-low fires once and rearms`, async () => {
    const device = await createDevice();
    async function poll(raw) {
      device.response = [reading(device, did, raw)];
      await device.retrieveDeviceData();
    }
    await poll(1);
    await device.onInit();
    await poll(1);
    assert.deepEqual(device.triggers, []);
    await poll(2);
    await device.onInit();
    await poll(1);
    await poll(1);
    assert.deepEqual(device.triggers, [triggerId]);
    assert.equal(device.getCapabilityValue(enumId), 'low');
    assert.equal(device.getCapabilityValue(alarmId), true);
    await poll(2);
    await poll(1);
    assert.deepEqual(device.triggers, [triggerId, triggerId]);
  });

  test(`${did}: unknown and failed readings never clear a low alarm or create false transitions`, async () => {
    const device = await createDevice();
    await device.updateConsumableLevel(1, enumId, alarmId, triggerId);
    for (const raw of [0, 3, -1, NaN, Infinity, '1', '2', null, undefined, false, {}, 'toString']) {
      await device.updateConsumableLevel(raw, enumId, alarmId, triggerId);
      assert.equal(device.getCapabilityValue(enumId), 'low');
      assert.equal(device.getCapabilityValue(alarmId), true);
    }
    for (const entry of [null, reading(device, did, 2, { code: -4004 }), reading(device, did, null),
      reading(device, did, 2, { siid: 99 }), reading(device, did, undefined)]) {
      device.response = [entry];
      await device.retrieveDeviceData();
    }
    device.response = [];
    await device.retrieveDeviceData();
    await device.updateConsumableLevel(1, enumId, alarmId, triggerId);
    assert.equal(device.getCapabilityValue(enumId), 'low');
    assert.equal(device.getCapabilityValue(alarmId), true);
    assert.deepEqual(device.triggers, []);
    assert.deepEqual(device.errors, []);
    assert.deepEqual(device.timers, []);
  });
}

test('failed alarm writes do not fire low triggers and report the underlying error', async () => {
  const device = await createDevice();
  const [, enumId, alarmId, triggerId] = consumables[0];
  await device.updateConsumableLevel(2, enumId, alarmId, triggerId);
  const setCapabilityValue = device.setCapabilityValue;
  device.setCapabilityValue = async (id, value) => {
    if (id === alarmId) throw new Error('alarm write failed');
    return setCapabilityValue(id, value);
  };
  await device.updateConsumableLevel(1, enumId, alarmId, triggerId);
  assert.deepEqual(device.triggers, []);
  assert.equal(device.getCapabilityValue(alarmId), false);
  assert.match(device.errors[0][1].message, /alarm write failed/);
  device.setCapabilityValue = setCapabilityValue;
  await device.updateConsumableLevel(1, enumId, alarmId, triggerId);
  await device.updateConsumableLevel(1, enumId, alarmId, triggerId);
  assert.deepEqual(device.triggers, [triggerId]);
});

test('Flow trigger rejection is logged and does not repeat on the next low reading', async () => {
  const device = await createDevice();
  const [, enumId, alarmId, triggerId] = consumables[1];
  let attempts = 0;
  device.homey.flow.getDeviceTriggerCard = () => ({ trigger: async () => {
    attempts++;
    throw new Error('Flow failed');
  } });
  await device.updateConsumableLevel(2, enumId, alarmId, triggerId);
  await device.updateConsumableLevel(1, enumId, alarmId, triggerId);
  await device.updateConsumableLevel(1, enumId, alarmId, triggerId);
  assert.equal(attempts, 1);
  assert.match(device.errors[0][0].message, /Flow failed/);
});

test('door states map correctly; unknown or failed readings preserve the lock alarm', async () => {
  const device = await createDevice();
  for (const value of [0, 2, 3, 4, 5, 6, 7]) {
    device.response = [reading(device, 'door_state', value)];
    await device.retrieveDeviceData();
    assert.equal(device.getCapabilityValue('xiaomi_washer_door_state'), String(value));
    assert.equal(device.getCapabilityValue('alarm_washer_door_locked'), value >= 3);
  }
  device.response = [reading(device, 'door_state', 99)];
  await device.retrieveDeviceData();
  assert.equal(device.getCapabilityValue('xiaomi_washer_door_state'), 'unknown');
  assert.equal(device.getCapabilityValue('alarm_washer_door_locked'), true);
  for (const entry of [reading(device, 'door_state', 0, { code: -1 }), reading(device, 'door_state', '0')]) {
    device.response = [entry];
    await device.retrieveDeviceData();
    assert.equal(device.getCapabilityValue('xiaomi_washer_door_state'), 'unknown');
    assert.equal(device.getCapabilityValue('alarm_washer_door_locked'), true);
  }
});

test('cycle count accepts uint16 boundaries and ignores invalid, missing and failed readings', async () => {
  const device = await createDevice();
  for (const value of [0, 65535]) {
    device.response = [reading(device, 'has_washed_times', value)];
    await device.retrieveDeviceData();
    assert.equal(device.getCapabilityValue('xiaomi_washer_washed_times'), value);
  }
  for (const value of [-1, 65536, 1.5, NaN, Infinity, '42', null, undefined]) {
    device.response = [reading(device, 'has_washed_times', value)];
    await device.retrieveDeviceData();
    assert.equal(device.getCapabilityValue('xiaomi_washer_washed_times'), 65535);
  }
  device.response = [reading(device, 'has_washed_times', 0, { code: -1 })];
  await device.retrieveDeviceData();
  assert.equal(device.getCapabilityValue('xiaomi_washer_washed_times'), 65535);
});

test('unsupported optional properties do not prevent existing power and status updates', async () => {
  const device = await createDevice();
  device.store.previous_status = 3;
  device.response = [reading(device, 'power', false), reading(device, 'status', 5),
    reading(device, 'detergent_left_level', undefined, { code: -4004 }),
    reading(device, 'softener_left_level', undefined, { code: -4004 })];
  await device.retrieveDeviceData();
  assert.equal(device.getCapabilityValue('onoff'), false);
  assert.deepEqual(device.triggers, ['washerFinished']);
  assert.deepEqual(device.errors, []);
  assert.deepEqual(device.timers, []);
});

test('washerFinished fires once when a cycle auto-powers off or finishes between polls and does not duplicate', async () => {
  const device = await createDevice();

  // Initial off poll after boot does not fire triggers.
  device.response = [
    reading(device, 'power', false),
    reading(device, 'status', 0),
    reading(device, 'left_time', 0),
    reading(device, 'has_washed_times', 198),
  ];
  await device.retrieveDeviceData();
  assert.equal(device.getCapabilityValue('onoff'), false);
  assert.deepEqual(device.triggers, []);

  // Wash starts (status 3 Busy) -> fires washerStarted once.
  device.response = [
    reading(device, 'power', true),
    reading(device, 'status', 3),
    reading(device, 'left_time', 45),
    reading(device, 'has_washed_times', 198),
  ];
  await device.retrieveDeviceData();
  assert.equal(device.getCapabilityValue('onoff'), true);
  assert.deepEqual(device.triggers, ['washerStarted']);

  // Wash finishes and washer auto-powers off before next 60s poll (status 0 Off, power false) -> fires washerFinished once.
  device.response = [
    reading(device, 'power', false),
    reading(device, 'status', 0),
    reading(device, 'left_time', 0),
    reading(device, 'has_washed_times', 199),
  ];
  await device.retrieveDeviceData();
  assert.equal(device.getCapabilityValue('onoff'), false);
  assert.equal(device.getCapabilityValue('xiaomi_washer_washed_times'), 199);
  assert.deepEqual(device.triggers, ['washerStarted', 'washerFinished']);

  // Subsequent off polls do not re-trigger washerFinished.
  await device.retrieveDeviceData();
  assert.deepEqual(device.triggers, ['washerStarted', 'washerFinished']);

  // Next cycle starts and finishes with status 5 observed before auto-power-off -> fires washerFinished only once.
  device.response = [reading(device, 'power', true), reading(device, 'status', 3), reading(device, 'has_washed_times', 199)];
  await device.retrieveDeviceData();
  assert.deepEqual(device.triggers, ['washerStarted', 'washerFinished', 'washerStarted']);

  device.response = [reading(device, 'power', true), reading(device, 'status', 5), reading(device, 'has_washed_times', 200)];
  await device.retrieveDeviceData();
  assert.deepEqual(device.triggers, ['washerStarted', 'washerFinished', 'washerStarted', 'washerFinished']);

  device.response = [reading(device, 'power', false), reading(device, 'status', 0), reading(device, 'has_washed_times', 200)];
  await device.retrieveDeviceData();
  assert.deepEqual(device.triggers, ['washerStarted', 'washerFinished', 'washerStarted', 'washerFinished']);

  // Manual stop or power-off from Homey mid-cycle does not falsely trigger washerFinished.
  device.response = [reading(device, 'power', true), reading(device, 'status', 3)];
  await device.retrieveDeviceData();
  assert.equal(device.triggers.length, 5);

  await device.listeners.get('xiaomi_washer_stop')();
  device.response = [reading(device, 'power', true), reading(device, 'status', 1), reading(device, 'left_time', 20)];
  await device.retrieveDeviceData();
  assert.equal(device.triggers.length, 5);

  device.response = [reading(device, 'power', true), reading(device, 'status', 3)];
  await device.retrieveDeviceData();
  assert.equal(device.triggers.length, 6);

  await device.listeners.get('onoff')(false);
  device.response = [reading(device, 'power', false), reading(device, 'status', 0)];
  await device.retrieveDeviceData();
  assert.equal(device.triggers.length, 6);
});

test('overlapping polls send one request and malformed responses release the poll guard', async () => {
  const device = await createDevice();
  let resolve;
  let calls = 0;
  device.miio.call = () => {
    calls++;
    return new Promise(done => { resolve = done; });
  };
  const pending = device.retrieveDeviceData();
  await device.retrieveDeviceData();
  assert.equal(calls, 1);
  resolve([]);
  await pending;
  assert.equal(device.isRetrievingDeviceData, false);
  device.miio.call = async () => ({});
  await device.retrieveDeviceData();
  assert.equal(device.isRetrievingDeviceData, false);
  assert.match(device.errors[0][0], /Invalid washer get_properties response/);
  assert.equal(device.timers.length, 1);
});

test('late poll success or failure after deletion or connection replacement cannot publish or reconnect', async () => {
  for (const stopped of [true, false]) {
    for (const fails of [true, false]) {
      const device = await createDevice();
      device.values.set('alarm_washer_detergent_low', false);
      let resolve;
      let reject;
      device.miio.call = () => new Promise((done, fail) => { resolve = done; reject = fail; });
      const pending = device.retrieveDeviceData();
      if (stopped) device._wifiStopped = true;
      else device.miio = {};
      if (fails) reject(new Error('late timeout'));
      else resolve([reading(device, 'detergent_left_level', 1)]);
      await pending;
      assert.equal(device.getCapabilityValue('alarm_washer_detergent_low'), false);
      assert.deepEqual(device.triggers, []);
      assert.deepEqual(device.timers, []);
      assert.deepEqual(device.errors, []);
      assert.equal(device.isRetrievingDeviceData, false);
    }
  }
});

test('existing command listeners retain their MIoT contracts', async () => {
  const device = await createDevice();
  await device.listeners.get('onoff')(true);
  await device.listeners.get('xiaomi_washer_mode')('3');
  await device.listeners.get('xiaomi_washer_spin_speed')('1200');
  await device.listeners.get('xiaomi_washer_start')();
  await device.listeners.get('xiaomi_washer_pause')();
  await device.listeners.get('xiaomi_washer_stop')();
  assert.deepEqual(device.calls, [
    ['set_properties', [{ siid: 2, piid: 1, value: true }], { retries: 1 }],
    ['set_properties', [{ siid: 2, piid: 3, value: 3 }], { retries: 1 }],
    ['set_properties', [{ siid: 2, piid: 7, value: 1200 }], { retries: 1 }],
    ['action', { siid: 2, aiid: 2, did: 'call-2-2', in: [] }, { retries: 1 }],
    ['action', { siid: 2, aiid: 3, did: 'call-2-3', in: [] }, { retries: 1 }],
    ['action', { siid: 2, aiid: 1, did: 'call-2-1', in: [] }, { retries: 1 }],
  ]);
});

test('new capability and Flow Compose definitions match the driver and trigger IDs', () => {
  for (const id of newCapabilities) {
    assert.ok(manifest.capabilities.includes(id));
    const definition = JSON.parse(fs.readFileSync(path.join(__dirname, '../.homeycompose/capabilities', `${id}.json`)));
    assert.equal(definition.getable, true);
    assert.equal(definition.setable, false);
  }
  for (const triggerId of ['washerStarted', 'washerFinished', ...consumables.map(([, , , id]) => id)]) {
    const definition = JSON.parse(fs.readFileSync(path.join(__dirname, '../.homeycompose/flow/triggers', `${triggerId}.json`)));
    assert.deepEqual(definition.args, [{ name: 'device', type: 'device', filter: 'driver_id=washer' }]);
  }
});
