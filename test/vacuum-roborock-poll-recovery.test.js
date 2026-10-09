'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
  if (request === 'homey') return { Device: class Device {} };
  return originalModuleLoad.call(this, request, parent, isMain);
};
const WifiDevice = require('../drivers/wifi_device.js');
const VacuumDevice = require('../drivers/vacuum_mi_rockrobo_vacuum_advanced/device.js');
Module._load = originalModuleLoad;

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
    { method: 'get_status', params: [], options: { retries: 1 } },
    { method: 'get_status', params: [], options: { retries: 1 } }
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
