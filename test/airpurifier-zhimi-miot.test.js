'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const {
  getModelProfile,
  encodeValue,
  decodeValue,
  findValidResult,
  getOptionalCapabilities
} = require('../lib/airpurifier-zhimi-miot.js');

const driverCompose = require('../drivers/airpurifier_zhimi_advanced_miot/driver.compose.json');
const Util = require('../lib/util.js');

const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
  if (request === 'homey') {
    return { Device: class Device {} };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

const AdvancedMiAirPurifierMiotDevice = require('../drivers/airpurifier_zhimi_advanced_miot/device.js');
Module._load = originalModuleLoad;

const profile = getModelProfile('xiaomi.airp.mb5');
const cpa5Profile = getModelProfile('xiaomi.airp.cpa5');

function createMiotDevice(deviceProperties = profile.properties) {
  const calls = [];
  const device = Object.create(AdvancedMiAirPurifierMiotDevice.prototype);
  device.deviceProperties = deviceProperties;
  device.getData = () => ({ id: 'stored-token' });
  device.miio = {
    handle: { api: { id: 123456 } },
    call: async (...args) => {
      calls.push(args);
      return ['ok'];
    }
  };
  device.error = () => {};
  return { device, calls };
}

test('centralized MIoT writes include the connected device ID and mapped property', async () => {
  const { device, calls } = createMiotDevice();

  await device.setMiotProperty('power', true);

  assert.deepEqual(calls, [
    ['set_properties', [{ did: '123456', siid: 2, piid: 1, value: true }], { retries: 1 }]
  ]);
});

test('centralized MIoT writes use the selected model mapping for a second property', async () => {
  const { device, calls } = createMiotDevice(cpa5Profile.properties);

  await device.setMiotProperty('fanlevel', 7);

  assert.deepEqual(calls, [
    ['set_properties', [{ did: '123456', siid: 9, piid: 1, value: 7 }], { retries: 1 }]
  ]);
});

test('xiaomi.airp.mb5 uses its released MIoT property layout', () => {
  assert.ok(profile);

  const readable = Object.fromEntries(profile.properties.get_properties.map(({ did, siid, piid }) => [did, { siid, piid }]));
  assert.deepEqual(readable, {
    power: { siid: 2, piid: 1 },
    fanlevel: { siid: 2, piid: 5 },
    mode: { siid: 2, piid: 4 },
    humidity: { siid: 3, piid: 1 },
    temperature: { siid: 3, piid: 7 },
    aqi: { siid: 3, piid: 4 },
    anion: { siid: 2, piid: 6 },
    uv: { siid: 2, piid: 7 },
    buzzer: { siid: 6, piid: 1 },
    child_lock: { siid: 8, piid: 1 },
    light: { siid: 7, piid: 1 },
    filter_life_remaining: { siid: 4, piid: 1 },
    filter_hours_used: { siid: 4, piid: 3 }
  });
  assert.equal(readable.purify_volume, undefined, 'the MB5 spec has no purify-volume property');

  assert.deepEqual(profile.properties.set_properties.buzzer, { siid: 6, piid: 1 });
  assert.deepEqual(profile.properties.set_properties.light, { siid: 7, piid: 1 });
});

test('xiaomi.airp.mb5 mode values round-trip through the existing Homey capability IDs', () => {
  const expected = new Map([
    ['0', 0],
    ['1', 3],
    ['2', 5],
    ['3', 6]
  ]);

  for (const [homeyValue, deviceValue] of expected) {
    assert.equal(encodeValue(profile, 'mode', homeyValue), deviceValue);
    assert.equal(decodeValue(profile, 'mode', deviceValue), homeyValue);
  }
});

test('xiaomi.airp.cpa5 uses its dedicated released MIoT property layout', () => {
  assert.ok(cpa5Profile);
  assert.equal(cpa5Profile.mapping, 'mapping_xiaomi_cpa5');

  const readable = Object.fromEntries(cpa5Profile.properties.get_properties.map(({ did, siid, piid }) => [did, { siid, piid }]));
  assert.deepEqual(readable, {
    power: { siid: 2, piid: 1 },
    mode: { siid: 2, piid: 3 },
    aqi: { siid: 3, piid: 4 },
    filter_life_remaining: { siid: 4, piid: 1 },
    filter_hours_used: { siid: 4, piid: 3 },
    light: { siid: 6, piid: 2 },
    buzzer: { siid: 7, piid: 1 },
    child_lock: { siid: 8, piid: 1 },
    fanlevel: { siid: 9, piid: 1 }
  });
  assert.equal(readable.humidity, undefined);
  assert.equal(readable.temperature, undefined);
  assert.equal(readable.anion, undefined);
  assert.equal(readable.uv, undefined);
  assert.equal(readable.purify_volume, undefined);

  assert.deepEqual(cpa5Profile.properties.set_properties, {
    power: { siid: 2, piid: 1 },
    mode: { siid: 2, piid: 3 },
    light: { siid: 6, piid: 2 },
    buzzer: { siid: 7, piid: 1 },
    child_lock: { siid: 8, piid: 1 },
    fanlevel: { siid: 9, piid: 1 }
  });
  assert.deepEqual(cpa5Profile.properties.device_properties.light, { min: 0, max: 2 });
});

test('xiaomi.airp.cpa5 modes preserve the Homey enum and reject unsupported mode 3', () => {
  const expected = new Map([
    ['0', 0],
    ['1', 1],
    ['2', 2]
  ]);

  for (const [homeyValue, deviceValue] of expected) {
    assert.equal(encodeValue(cpa5Profile, 'mode', homeyValue), deviceValue);
    assert.equal(decodeValue(cpa5Profile, 'mode', deviceValue), homeyValue);
  }

  assert.throws(() => encodeValue(cpa5Profile, 'mode', '3'), /Unsupported mode value/);
  assert.equal(decodeValue(cpa5Profile, 'mode', 3), undefined);
});

test('xiaomi.airp.cpa5 favorite fan level is numeric and limited to 0 through 14', () => {
  for (const level of [0, 7, 14]) {
    assert.equal(encodeValue(cpa5Profile, 'fanlevel', level), level);
    assert.equal(decodeValue(cpa5Profile, 'fanlevel', level), String(level));
  }

  assert.throws(() => encodeValue(cpa5Profile, 'fanlevel', -1), /Unsupported fanlevel value/);
  assert.throws(() => encodeValue(cpa5Profile, 'fanlevel', 15), /Unsupported fanlevel value/);
  assert.equal(decodeValue(cpa5Profile, 'fanlevel', 15), undefined);
});

test('xiaomi.airp.cpa5 has its App-facing friendly name', () => {
  assert.equal(new Util({}).getFriendlyNameWiFi('xiaomi.airp.cpa5'), 'Xiaomi Smart Pet Care Air Purifier');
});

test('xiaomi.airp.mb5 zero-based fan levels round-trip through the legacy 1-based capability', () => {
  const expected = new Map([
    ['1', 0],
    ['2', 1],
    ['3', 2]
  ]);

  for (const [homeyValue, deviceValue] of expected) {
    assert.equal(encodeValue(profile, 'fanlevel', homeyValue), deviceValue);
    assert.equal(decodeValue(profile, 'fanlevel', deviceValue), homeyValue);
  }
});

test('unknown enum values are rejected instead of being written to Homey or the purifier', () => {
  assert.throws(() => encodeValue(profile, 'mode', '4'), /Unsupported mode value/);
  assert.throws(() => encodeValue(profile, 'fanlevel', '0'), /Unsupported fanlevel value/);
  assert.equal(decodeValue(profile, 'mode', 1), undefined);
  assert.equal(decodeValue(profile, 'fanlevel', 3), undefined);
});

test('optional MIoT properties ignore failed and empty results', () => {
  const result = [
    { did: 'anion', code: -4004 },
    { did: 'uv', code: 0, value: null },
    { did: 'mode', code: 0, value: 3 }
  ];

  assert.equal(findValidResult(result, 'anion'), undefined);
  assert.equal(findValidResult(result, 'uv'), undefined);
  assert.deepEqual(findValidResult(result, 'mode'), { did: 'mode', code: 0, value: 3 });
});

test('CPA4 and CPA5 fan levels ignore failed or null MIoT results but preserve zero', () => {
  for (const model of ['xiaomi.airp.cpa4', 'xiaomi.airp.cpa5']) {
    const invalidResult = [
      { did: 'fanlevel', code: -4004, value: 7 },
      { did: 'fanlevel', code: 0, value: null }
    ];
    assert.equal(findValidResult(invalidResult, 'fanlevel'), undefined, `${model} invalid fan level should be ignored`);

    const validResult = [{ did: 'fanlevel', code: 0, value: 0 }];
    assert.deepEqual(findValidResult(validResult, 'fanlevel'), validResult[0], `${model} zero fan level should be accepted`);
  }
});

test('ion and UV remain model-specific instead of becoming default driver capabilities', () => {
  assert.deepEqual(getOptionalCapabilities(profile.properties).map(({ capability }) => capability), ['onoff.ion', 'onoff.uv']);
  assert.ok(!driverCompose.capabilities.includes('onoff.ion'));
  assert.ok(!driverCompose.capabilities.includes('onoff.uv'));
  assert.ok(driverCompose.capabilitiesOptions['onoff.ion']);
  assert.ok(driverCompose.capabilitiesOptions['onoff.uv']);

  const unsupportedProperties = {
    get_properties: [{ did: 'power', siid: 2, piid: 1 }],
    set_properties: { power: { siid: 2, piid: 1 } }
  };
  assert.deepEqual(getOptionalCapabilities(unsupportedProperties), []);
});

async function createInitializedPurifier(model = 'zhimi.airpurifier.mb3') {
  const { device, calls } = createMiotDevice();
  const capabilityUpdates = [];
  const settingUpdates = [];
  const errors = [];
  const unavailableReasons = [];
  const reconnects = [];
  let available = false;
  let availableCalls = 0;

  device.util = {};
  device.getStoreValue = () => model;
  device.bootSequence = () => {};
  device.hasCapability = () => true;
  device.log = () => {};
  device.registerCapabilityListener = () => {};
  device.getCapabilityValue = () => '0';
  device.getAvailable = () => available;
  device.setAvailable = async () => { available = true; availableCalls += 1; };
  device.setUnavailable = async (reason) => { available = false; unavailableReasons.push(reason); };
  device.updateCapabilityValue = async (...args) => { capabilityUpdates.push(args); };
  device.updateSettingValue = async (...args) => { settingUpdates.push(args); };
  device.error = (error) => { errors.push(error); };
  device.homey = {
    flow: { getDeviceTriggerCard: () => ({ trigger: async () => {} }) },
    clearInterval: () => {},
    clearTimeout: () => {},
    setTimeout: (callback, delay) => { const timer = { callback, delay }; reconnects.push(timer); return timer; },
    __: () => 'Device unavailable: '
  };
  await device.onInit();
  assert.deepEqual(errors, []);

  return {
    device, calls, capabilityUpdates, settingUpdates, errors, unavailableReasons, reconnects,
    isAvailable: () => available,
    availableCalls: () => availableCalls
  };
}

test('3H and shared default mappings read and write child lock at 7/1, including a missing stored model', async () => {
  for (const model of ['zhimi.airpurifier.mb3', 'zhimi.airpurifier.mb3a', 'zhimi.airp.mb3a',
    'zhimi.airpurifier.ma4', 'zhimi.airpurifier.va1', 'zhimi.airpurifier.vb2', null]) {
    const { device, calls } = await createInitializedPurifier(model);
    assert.deepEqual(device.deviceProperties.get_properties.find(({ did }) => did === 'child_lock'),
      { did: 'child_lock', siid: 7, piid: 1 });
    await device.onSettings({ newSettings: { childLock: true }, changedKeys: ['childLock'] });
    assert.deepEqual(calls, [
      ['set_properties', [{ did: '123456', siid: 7, piid: 1, value: true }], { retries: 1 }]
    ]);
  }
});

test('MIoT reads use sequential batches of at most 15 without changing the mapping or response order', async () => {
  for (const count of [0, 1, 12, 15, 16, 31]) {
    const requested = Array.from({ length: count }, (_, index) => ({ did: `property${index}`, siid: 2, piid: index + 1 }));
    const original = structuredClone(requested);
    const { device } = createMiotDevice({ get_properties: requested });
    const batches = [];
    let inFlight = 0;
    device.miio.call = async (method, batch, options) => {
      assert.equal(method, 'get_properties');
      assert.deepEqual(options, { retries: 1 });
      inFlight += 1;
      assert.equal(inFlight, 1);
      await Promise.resolve();
      batches.push(batch);
      inFlight -= 1;
      return batch.map(({ did }) => ({ did, code: 0, value: did }));
    };
    const result = await device.getMiotProperties();
    assert.deepEqual(batches.map((batch) => batch.length),
      count === 0 ? [] : Array.from({ length: Math.ceil(count / 15) }, (_, index) => Math.min(15, count - index * 15)));
    assert.deepEqual(batches.flat(), original);
    assert.deepEqual(requested, original);
    assert.deepEqual(result.map(({ did }) => did), original.map(({ did }) => did));
  }
});

test('a failed MIoT batch stops further requests and preserves the underlying timeout', async () => {
  const requested = Array.from({ length: 31 }, (_, index) => ({ did: `property${index}`, siid: 2, piid: index + 1 }));
  const { device } = createMiotDevice({ get_properties: requested });
  const timeout = new Error('Call to device timed out');
  let calls = 0;
  device.miio.call = async () => {
    calls += 1;
    if (calls === 2) throw timeout;
    return [];
  };
  await assert.rejects(device.getMiotProperties(), (error) => error === timeout);
  assert.equal(calls, 2);
});

test('MIoT reads reject malformed non-array responses', async () => {
  const { device } = createMiotDevice();
  device.miio.call = async () => ({ error: 'invalid response' });
  await assert.rejects(device.getMiotProperties(), /Invalid MIoT response for property batch 1/);
});

test('3H polling preserves valid false and zero values while ignoring failed, missing and empty optional properties', async () => {
  const state = await createInitializedPurifier();
  state.device.miio.call = async () => [
    { did: 'power', code: 0, value: false },
    { did: 'aqi', code: 0, value: 0 },
    { did: 'buzzer', code: 0, value: false },
    { did: 'child_lock', code: -4004, value: true },
    { did: 'humidity', code: -4001 },
    { did: 'temperature', code: 0, value: null },
    { did: 'light', code: -4004 },
    { did: 'filter_life_remaining', code: 0 },
    { did: 'filter_hours_used', code: 0, value: 0 },
    { did: 'mode', code: 0, value: 0 }
  ];
  await state.device.retrieveDeviceData();
  assert.deepEqual(state.capabilityUpdates, [['onoff', false], ['measure_pm25', 0]]);
  assert.deepEqual(state.settingUpdates, [['buzzer', false], ['filter_hours_used', '0h']]);
  assert.equal(state.isAvailable(), true);
  assert.equal(state.availableCalls(), 1);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.unavailableReasons, []);
  assert.deepEqual(state.reconnects, []);
});

test('failed power reads and transport timeouts never mark the purifier available or publish partial state', async () => {
  for (const failure of ['power', 'missing', 'transport']) {
    const state = await createInitializedPurifier();
    state.device.miio.call = async () => {
      if (failure === 'transport') throw new Error('Call to device timed out');
      return [
        ...(failure === 'power' ? [{ did: 'power', code: -4004, value: true }] : []),
        { did: 'aqi', code: 0, value: 12 }
      ];
    };
    await state.device.retrieveDeviceData();
    assert.equal(state.isAvailable(), false);
    assert.equal(state.availableCalls(), 0);
    assert.deepEqual(state.capabilityUpdates, []);
    assert.deepEqual(state.settingUpdates, []);
    assert.equal(state.errors.length, 1);
    assert.match(state.errors[0], failure === 'transport' ? /Call to device timed out/ : /MIoT power read failed/);
    assert.equal(state.reconnects.length, 1);
    assert.equal(state.reconnects[0].delay, 60000);
  }
});

const transportTimeout = () => Object.assign(new Error('Call to device timed out'), { code: 'timeout' });
const powerReply = value => [{ did: 'power', siid: 2, piid: 1, code: 0, value }];
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('vb4 recovers from transient polling timeouts before changing availability', async () => {
  const state = await createInitializedPurifier('zhimi.airp.vb4');
  let attempts = 0;
  const batches = [];
  state.device.miio.call = async (method, params, options) => {
    assert.equal(method, 'get_properties');
    assert.equal(options.retries, 1);
    batches.push(params);
    if (++attempts < 3) throw transportTimeout();
    return powerReply(false);
  };
  await state.device.retrieveDeviceData();
  assert.equal(attempts, 3);
  assert.deepEqual(batches[0], state.device.deviceProperties.get_properties);
  assert.deepEqual(batches[1], batches[0]);
  assert.deepEqual(batches[2], batches[0]);
  assert.deepEqual(state.capabilityUpdates, [['onoff', false]]);
  assert.equal(state.isAvailable(), true);
  assert.deepEqual(state.unavailableReasons, []);
  assert.deepEqual(state.reconnects, []);
});

test('vb4 stops after three polling timeouts and tracks one cancellable reconnect', async () => {
  const state = await createInitializedPurifier('zhimi.airp.vb4');
  await state.device.setAvailable();
  let attempts = 0;
  const cleared = [];
  state.device.homey.clearTimeout = timer => cleared.push(timer);
  state.device.miio.call = async () => { attempts++; throw transportTimeout(); };
  await state.device.retrieveDeviceData();
  assert.equal(attempts, 3);
  assert.equal(state.isAvailable(), false);
  assert.equal(state.reconnects.length, 1);
  assert.equal(state.device.recreateTimeout, state.reconnects[0]);
  assert.equal(state.reconnects[0].delay, 60000);
  assert.match(state.errors[0], /reconnect scheduled in 60s: Call to device timed out/);
  await state.device.onUninit();
  assert.ok(cleared.includes(state.reconnects[0]));
  let recreated = 0;
  state.device.createDevice = () => { recreated++; };
  state.reconnects[0].callback();
  assert.equal(recreated, 0);
});

test('vb4 retries absolute writes in order and a failed write does not poison the queue', async () => {
  const state = await createInitializedPurifier('zhimi.airp.vb4');
  const values = [];
  state.device.miio.call = async (method, params, options) => {
    assert.equal(method, 'set_properties');
    assert.equal(options.retries, 1);
    values.push(params[0].value);
    if (params[0].value) throw transportTimeout();
    return params.map(entry => ({ ...entry, code: 0 }));
  };
  const on = state.device.setMiotProperty('power', true);
  const off = state.device.setMiotProperty('power', false);
  await assert.rejects(on, /Call to device timed out/);
  await off;
  assert.deepEqual(values, [true, true, true, false]);
});

test('vb4 settings use the same bounded write retries', async () => {
  const state = await createInitializedPurifier('zhimi.airp.vb4');
  let attempts = 0;
  state.device.miio.call = async (method, params) => {
    assert.equal(method, 'set_properties');
    assert.equal(params[0].value, false);
    if (++attempts < 3) throw transportTimeout();
    return params.map(entry => ({ ...entry, code: 0 }));
  };
  await state.device.onSettings({ newSettings: { buzzer: false }, changedKeys: ['buzzer'] });
  assert.equal(attempts, 3);
});

test('vb4 does not retry device errors, malformed acknowledgements or non-timeout failures', async () => {
  for (const reply of [[], null, [{ siid: 2, piid: 1, code: -4004 }], [{ siid: 2, piid: 9, code: 0 }], new Error('network closed')]) {
    const state = await createInitializedPurifier('zhimi.airp.vb4');
    let attempts = 0;
    state.device.miio.call = async () => { attempts++; if (reply instanceof Error) throw reply; return reply; };
    await assert.rejects(state.device.setMiotProperty('power', false), /write failed|network closed/);
    assert.equal(attempts, 1);
  }
});

test('vb4 suppresses overlapping polls and finishes publication before a queued control', async () => {
  const state = await createInitializedPurifier('zhimi.airp.vb4');
  const read = deferred();
  const publishing = deferred();
  const published = deferred();
  const events = [];
  state.device.miio.call = async (method, params) => {
    events.push(method);
    if (method === 'get_properties') return read.promise;
    return params.map(entry => ({ ...entry, code: 0 }));
  };
  state.device.updateCapabilityValue = async () => { publishing.resolve(); await published.promise; events.push('published'); };
  const poll = state.device.retrieveDeviceData();
  await state.device.retrieveDeviceData();
  const off = state.device.setMiotProperty('power', false);
  read.resolve(powerReply(true));
  await publishing.promise;
  assert.deepEqual(events, ['get_properties']);
  published.resolve();
  await Promise.all([poll, off]);
  assert.deepEqual(events, ['get_properties', 'published', 'set_properties']);
});

test('late polls cannot publish or reconnect after replacement, deletion or uninitialization', async () => {
  for (const action of ['replace', 'delete', 'uninit']) {
    for (const failed of [false, true]) {
      const state = await createInitializedPurifier('zhimi.airp.vb4');
      const pending = deferred();
      let attempts = 0;
      state.device.miio.call = () => { attempts++; return pending.promise; };
      const poll = state.device.retrieveDeviceData();
      await Promise.resolve();
      if (action === 'replace') state.device.miio = {};
      else if (action === 'delete') await state.device.onDeleted();
      else await state.device.onUninit();
      if (failed) pending.reject(transportTimeout());
      else pending.resolve(powerReply(true));
      await poll;
      assert.equal(attempts, 1);
      assert.deepEqual(state.capabilityUpdates, []);
      assert.deepEqual(state.reconnects, []);
      assert.deepEqual(state.unavailableReasons, []);
    }
  }
});

test('a replacement connection polls immediately while old operations are cancelled', async () => {
  const state = await createInitializedPurifier('zhimi.airp.vb4');
  const oldRead = deferred();
  state.device.miio.call = () => oldRead.promise;
  const oldPoll = state.device.retrieveDeviceData();
  const oldWrite = state.device.setMiotProperty('power', true);
  const rejectedWrite = assert.rejects(oldWrite, /connection changed/);
  await Promise.resolve();
  let newCalls = 0;
  state.device.miio = { call: async () => { newCalls++; return powerReply(false); } };
  await state.device.retrieveDeviceData();
  assert.equal(newCalls, 1);
  oldRead.reject(transportTimeout());
  await Promise.all([oldPoll, rejectedWrite]);
  assert.deepEqual(state.capabilityUpdates, [['onoff', false]]);
  assert.deepEqual(state.reconnects, []);
});

test('a stale reconnect callback cannot replace a newer connection', async () => {
  const state = await createInitializedPurifier('zhimi.airp.vb4');
  state.device.miio.call = async () => { throw transportTimeout(); };
  await state.device.retrieveDeviceData();
  const timer = state.device.recreateTimeout;
  state.device.miio = {};
  let recreated = 0;
  state.device.createDevice = () => { recreated++; };
  timer.callback();
  assert.equal(recreated, 0);
});

test('connection replacement during publication stops subsequent capability updates', async () => {
  const state = await createInitializedPurifier('zhimi.airp.vb4');
  const capabilityUpdates = [];
  state.device.miio.call = async () => [...powerReply(true), { did: 'aqi', code: 0, value: 10 }];
  state.device.updateCapabilityValue = async (id, value) => {
    capabilityUpdates.push([id, value]);
    state.device.miio = {};
  };
  await state.device.retrieveDeviceData();
  assert.deepEqual(capabilityUpdates, [['onoff', true]]);
  assert.deepEqual(state.reconnects, []);
});

test('other purifier models still make one attempt on a transport timeout', async () => {
  for (const model of ['zhimi.airpurifier.mb3', 'zhimi.airp.va2', 'xiaomi.airp.mb5']) {
    const state = await createInitializedPurifier(model);
    let attempts = 0;
    state.device.miio.call = async () => { attempts++; throw transportTimeout(); };
    await state.device.retrieveDeviceData();
    assert.equal(attempts, 1);
    await assert.rejects(state.device.setMiotProperty('power', false), /Call to device timed out/);
    assert.equal(attempts, 2);
  }
});
