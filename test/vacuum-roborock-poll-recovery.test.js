'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

let openRecoveryConnection;
const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  if (request === '../../lib/isolated-roborock') {
    return { openRoborockConnection: (options) => openRecoveryConnection(options) };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const WifiDevice = require('../drivers/wifi_device.js');
const VacuumDevice = require('../drivers/vacuum_mi_rockrobo_vacuum_advanced/device.js');
Module._load = originalModuleLoad;
const DeviceInfo = require('miio/lib/device_info');

function createTimers() {
  const timeouts = [];
  const intervals = [];
  const homey = {
    __: (key) => key,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, active: true };
      timeouts.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { if (timer) timer.active = false; },
    setInterval: (callback, delay) => {
      const timer = { callback, delay, active: true };
      intervals.push(timer);
      return timer;
    },
    clearInterval: (timer) => { if (timer) timer.active = false; }
  };
  const fire = (timer) => {
    if (!timer.active) return;
    timer.active = false;
    timer.callback();
  };
  return { fire, homey, intervals, timeouts };
}

function createVacuum(miio) {
  const timers = createTimers();
  const errors = [];
  const unavailable = [];
  const capabilities = [];
  let available = true;
  const device = Object.create(VacuumDevice.prototype);
  device.homey = timers.homey;
  device.miio = miio;
  device.pollingInterval = { active: true };
  device.deviceProperties = { fanspeeds: { 101: 1 } };
  device.getAvailable = () => available;
  device.setAvailable = async () => { available = true; };
  device.setUnavailable = async (reason) => { available = false; unavailable.push(reason); };
  device.updateCapabilityValue = async (id, value) => { capabilities.push({ id, value }); };
  device.vacuumCleanerState = () => {};
  device.vacuumConsumables = () => {};
  device.vacuumTotals = () => {};
  device.log = () => {};
  device.error = (error) => { errors.push(error); };
  device.createDevice = () => { device.createCalls = (device.createCalls || 0) + 1; };
  return { capabilities, device, errors, unavailable, ...timers };
}

test('repeated S5 status timeouts schedule only one reconnect and never call a null connection', async () => {
  const calls = [];
  const fixture = createVacuum({
    call: async (method, params, options) => {
      calls.push({ method, params, options });
      throw new Error('Call to device timed out');
    }
  });

  await fixture.device.retrieveDeviceData();
  await fixture.device.retrieveDeviceData();
  fixture.device.miio = null;
  await fixture.device.retrieveDeviceData();

  assert.deepEqual(calls, [
    { method: 'get_status', params: [], options: { retries: 2 } },
    { method: 'get_status', params: [], options: { retries: 2 } }
  ]);
  assert.equal(fixture.timeouts.length, 1);
  assert.equal(fixture.timeouts[0].delay, 60000);
  assert.equal(fixture.unavailable.length, 1);
  assert.equal(fixture.errors.length, 2);
  assert.equal(fixture.device.pollingInterval, null);

  fixture.fire(fixture.timeouts[0]);
  assert.equal(fixture.device.createCalls, 1);
  assert.equal(fixture.device.recreateTimeout, null);
});

test('Advanced Roborock retries a timed-out status read without requiring model metadata', async () => {
  const info = new DeviceInfo(null, 1, '127.0.0.1', 54321);
  const requests = [];
  const timeout = Object.assign(new Error('Call to device timed out'), { code: 'timeout' });
  info.handshake = async () => {};
  info._sendAndWaitForResponse = async () => {
    const request = JSON.parse(info.packet.data);
    requests.push(request);
    if (request.method === 'get_status') {
      if (request.id === 1) throw timeout;
      return [{ fan_power: 101, battery: 80, state: 8 }];
    }
    if (request.method !== 'get_room_mapping') return [];
  };
  const fixture = createVacuum(info);
  fixture.device.getCapabilityValue = () => 80;

  await fixture.device.retrieveDeviceData();

  assert.deepEqual(requests.map(({ method, id }) => [method, id]), [
    ['get_status', 1], ['get_status', 101], ['get_consumable', 102],
    ['get_clean_summary', 103], ['get_room_mapping', 104]
  ]);
  assert.deepEqual(fixture.unavailable, []);
  assert.deepEqual(fixture.errors, []);
  assert.equal(fixture.timeouts.length, 0);
});

function createTimedOutRoborock() {
  const original = {
    miioModel: 'roborock.vacuum.a65',
    async call() { throw Object.assign(new Error('Call to device timed out'), { code: 'timeout' }); },
    async destroy() { this.closed = true; }
  };
  const fixture = createVacuum(original);
  fixture.device.getSetting = (key) => ({ address: '127.0.0.1', token: '0'.repeat(32) })[key];
  return { original, ...fixture };
}

test('a recovered Roborock uses the validated connection for later polls and cleaning', async () => {
  const { original, device, errors, unavailable, timeouts } = createTimedOutRoborock();
  const calls = [];
  const candidate = Object.assign(new EventEmitter(), {
    async call(method, params, options) {
      calls.push(method);
      if (method === 'get_status') {
        assert.equal(options.retries, calls.length === 1 ? 1 : 2);
        return [{ state: 3, battery: 80, fan_power: 101 }];
      }
      if (method !== 'get_room_mapping') return [];
    },
    async clean() { calls.push('clean'); }
  });
  let opened = 0;
  openRecoveryConnection = async (options) => {
    assert.equal(options.model, 'roborock.vacuum.a65');
    assert.equal(++opened, 1);
    return candidate;
  };
  device.setCapabilityValue = async () => {};
  await device.retrieveDeviceData();
  await device.onCapabilityOnoffVacuumcleaner(true);
  await device.retrieveDeviceData();
  assert.equal(device.miio, candidate);
  assert.equal(candidate.listenerCount('batteryLevelChanged'), 1);
  assert.equal(original.closed, true);
  assert.deepEqual(calls, ['get_status', 'get_consumable', 'get_clean_summary', 'get_room_mapping',
    'clean', 'get_status', 'get_consumable', 'get_clean_summary', 'get_room_mapping']);
  assert.deepEqual([errors.length, unavailable.length, timeouts.length], [0, 0, 0]);
});

test('invalid or timed-out status on a fresh connection closes it and schedules one reconnect', async () => {
  for (const status of [[], new Error('timed out')]) {
    const { original, device, errors, unavailable, timeouts } = createTimedOutRoborock();
    const candidate = {
      async call() { if (status instanceof Error) throw status; return status; },
      async destroy() { this.closed = true; }
    };
    openRecoveryConnection = async () => candidate;
    await device.retrieveDeviceData();
    assert.equal(candidate.closed, true);
    assert.equal(device.miio, original);
    assert.equal(unavailable.length, 1);
    assert.match(errors[0].message, /fresh connection get_status failed/);
    assert.deepEqual(timeouts.map((timer) => timer.delay), [60000]);
  }
});

test('a fresh connection arriving after teardown is closed without replacing the device', async () => {
  const { device, errors, unavailable, timeouts } = createTimedOutRoborock();
  const candidate = { async destroy() { this.closed = true; } };
  openRecoveryConnection = async () => { await device.onUninit(); return candidate; };
  await device.retrieveDeviceData();
  assert.equal(candidate.closed, true);
  assert.equal(device.miio, null);
  assert.deepEqual([errors.length, unavailable.length, timeouts.length], [0, 0, 0]);
});

test('S5 skips overlapping polls and ignores a timeout from a replaced connection', async () => {
  let rejectStatus;
  let callCount = 0;
  const oldMiio = {
    call: () => {
      callCount += 1;
      return new Promise((resolve, reject) => { rejectStatus = reject; });
    }
  };
  const fixture = createVacuum(oldMiio);

  const firstPoll = fixture.device.retrieveDeviceData();
  await fixture.device.retrieveDeviceData();
  assert.equal(callCount, 1);

  fixture.device.miio = { call: async () => [] };
  rejectStatus(new Error('stale connection timed out'));
  await firstPoll;

  assert.equal(fixture.device._pollInProgress, false);
  assert.equal(fixture.unavailable.length, 0);
  assert.equal(fixture.timeouts.length, 0);
  assert.equal(fixture.errors.length, 0);
});

test('a successful S5 poll keeps the existing request sequence and cancels stale recovery', async () => {
  const calls = [];
  const replies = {
    get_status: [{ fan_power: 101, battery: 80, state: 3 }],
    get_consumable: [],
    get_clean_summary: [],
    get_room_mapping: undefined
  };
  const fixture = createVacuum({
    call: async (method) => {
      calls.push(method);
      return replies[method];
    }
  });
  fixture.device.recreateTimeout = fixture.homey.setTimeout(() => {}, 60000);
  const staleRecovery = fixture.device.recreateTimeout;

  await fixture.device.retrieveDeviceData();

  assert.deepEqual(calls, ['get_status', 'get_consumable', 'get_clean_summary', 'get_room_mapping']);
  assert.deepEqual(fixture.capabilities.slice(0, 2), [
    { id: 'vacuum_roborock_fanspeed', value: '1' },
    { id: 'measure_battery', value: 80 }
  ]);
  assert.equal(staleRecovery.active, false);
  assert.equal(fixture.device.recreateTimeout, null);
  assert.deepEqual(fixture.errors, []);
});

test('shared Wi-Fi poller cancels an earlier initial poll on restart and refresh', async () => {
  const timers = createTimers();
  const logs = [];
  const device = Object.create(WifiDevice.prototype);
  device.homey = timers.homey;
  device.util = { getRandomTimeout: () => 0 };
  device.getSetting = () => 120;
  device.getStoreValue = () => 'roborock.vacuum.s5';
  device.getName = () => 'Roborock S5';
  device.miio = { miioModel: 'roborock.vacuum.s5' };
  device.log = (message) => logs.push(message);
  device.retrieveDeviceData = () => { device.pollCalls = (device.pollCalls || 0) + 1; };

  await device.pollDevice();
  const firstInitialPoll = device.initialPollTimeout;
  assert.match(logs[0], /paired model: roborock\.vacuum\.s5, live model: roborock\.vacuum\.s5/);
  await device.pollDevice();
  const secondInitialPoll = device.initialPollTimeout;

  assert.equal(firstInitialPoll.active, false);
  assert.equal(timers.intervals[0].active, false);
  assert.equal(timers.intervals[1].delay, 120000);

  await device.refreshDevice();
  timers.fire(device.refreshInterval);
  assert.equal(secondInitialPoll.active, false);
  assert.equal(timers.intervals[1].active, false);
  timers.fire(firstInitialPoll);
  timers.fire(secondInitialPoll);
  assert.equal(device.pollCalls || 0, 0);
});
