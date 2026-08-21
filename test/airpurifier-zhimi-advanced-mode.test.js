'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class WifiDeviceStub {
  async handleModeEvent(mode) {
    this.delegatedModes.push(mode);
  }
}

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

const AdvancedOlderMiAirPurifierDevice = require('../drivers/airpurifier_zhimi_advanced/device.js');
Module._load = originalLoad;

function createDevice({ isV7 = false } = {}) {
  const device = Object.create(AdvancedOlderMiAirPurifierDevice.prototype);
  device.isV7 = isV7;
  device.model = isV7 ? 'zhimi.airpurifier.v7' : 'zhimi.airpurifier.v6';
  device.delegatedModes = [];
  device.logs = [];
  device.log = (...args) => device.logs.push(args);
  return device;
}

test('normalizes raw numeric mode events before delegating to the shared handler', async () => {
  const device = createDevice();

  for (const [rawMode, expectedMode] of [[0, 'auto'], [1, 'silent'], [2, 'favorite'], [3, 'idle']]) {
    await device.handleModeEvent(rawMode);
    assert.equal(device.delegatedModes.at(-1), expectedMode);
  }

  assert.deepEqual(device.logs, []);
});

test('passes existing string modes through unchanged', async () => {
  const device = createDevice();

  await device.handleModeEvent('strong');

  assert.deepEqual(device.delegatedModes, ['strong']);
  assert.deepEqual(device.logs, []);
});

test('ignores unsupported numeric mode events without delegating them', async () => {
  const device = createDevice();

  for (const rawMode of [4, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await device.handleModeEvent(rawMode);
  }

  assert.deepEqual(device.delegatedModes, []);
  assert.equal(device.logs.length, 5);
  assert.match(device.logs[0][0], /Ignoring unsupported numeric mode event/);
  assert.match(device.logs[0][0], /model zhimi\.airpurifier\.v6/);
});

test('filters modes excluded from the dynamic V7 capability options after normalization', async () => {
  const device = createDevice({ isV7: true });

  await device.handleModeEvent(3);
  await device.handleModeEvent('idle');
  await device.handleModeEvent(2);

  assert.deepEqual(device.delegatedModes, ['favorite']);
  assert.equal(device.logs.length, 2);
  assert.match(device.logs[0][0], /unsupported mode event for v7 device: idle/);
  assert.match(device.logs[1][0], /unsupported mode event for v7 device: idle/);
});
