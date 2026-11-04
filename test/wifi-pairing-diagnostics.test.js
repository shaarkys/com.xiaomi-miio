'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

let miioDevice;
const miioStub = {
  device: (...args) => miioDevice(...args)
};

const originalModuleLoad = Module._load;
Module._load = function loadWithPairingStubs(request, parent, isMain) {
  if (request === 'homey') return { Driver: class Driver {} };
  if (request === 'miio') return miioStub;
  return originalModuleLoad.call(this, request, parent, isMain);
};

const WifiDriver = require('../drivers/wifi_driver.js');
const RiceCookerDriver = require('../drivers/ricecooker_chunmi_cooker_r2/driver.js');
const RepeaterDriver = require('../drivers/xiaomi_repeater/driver.js');
Module._load = originalModuleLoad;

const TOKEN = '0123456789abcdef0123456789abcdef';

function createPairingHarness(DriverClass, friendlyNames = {}) {
  const handlers = {};
  const logs = [];
  const errors = [];
  const driver = Object.create(DriverClass.prototype);
  driver._requirePairingConnection = async () => {};
  driver.log = (message) => logs.push(message);
  driver.error = (error) => errors.push(error);
  driver.util = {
    getFriendlyNameWiFi: (model) => friendlyNames[model]
  };
  driver.onPair({
    setHandler: (name, handler) => {
      handlers[name] = handler;
    }
  });
  return { driver, errors, handlers, logs };
}

test('shared WiFi pairing adds safe diagnostics without changing submitted values or device identity', async () => {
  const rawAddress = ' 192.168.178.153 ';
  const data = { address: rawAddress, token: TOKEN, polling: 60 };
  const miioCalls = [];
  miioDevice = async (options) => {
    miioCalls.push(options);
    return { miioModel: 'xiaomi.vacuum.c102gl' };
  };
  const { handlers, logs } = createPairingHarness(WifiDriver, {
    'xiaomi.vacuum.c102gl': 'Xiaomi Robot Vacuum X20+'
  });

  const result = await handlers.test_connection(data);

  assert.deepEqual(miioCalls, [{ address: rawAddress, token: TOKEN }]);
  assert.deepEqual(result, {
    name: 'Xiaomi Robot Vacuum X20+ (xiaomi.vacuum.c102gl)',
    data: { id: TOKEN },
    settings: data,
    store: { model: 'xiaomi.vacuum.c102gl' }
  });
  assert.strictEqual(await handlers.add_device({}), result);
  const diagnostic = logs.join('\n');
  assert.match(diagnostic, /\[PAIR\] Test #1 started: stage=miio\.device/);
  assert.match(diagnostic, /addressType=ipv4/);
  assert.match(diagnostic, /addressWhitespace=true/);
  assert.match(diagnostic, /tokenLength=32/);
  assert.match(diagnostic, /tokenFormat=hex32/);
  assert.match(diagnostic, /succeeded: stage=complete/);
  assert.match(diagnostic, /model=xiaomi\.vacuum\.c102gl/);
  assert.doesNotMatch(diagnostic, /192\.168\.178\.153/);
  assert.doesNotMatch(diagnostic, new RegExp(TOKEN));
});

test('shared WiFi pairing preserves the exact rejection and redacts failure details', async () => {
  const address = 'vacuum-bedroom.local';
  const invalidToken = 'not-a-valid-local-token';
  const error = Object.assign(new Error(`Could not reach ${address}; token=${invalidToken}`), { code: 'timeout' });
  miioDevice = async () => { throw error; };
  const { errors, handlers, logs } = createPairingHarness(WifiDriver);

  await assert.rejects(handlers.test_connection({ address, token: invalidToken, polling: 60 }), (caught) => caught === error);

  assert.deepEqual(errors, [error]);
  const diagnostic = logs.join('\n');
  assert.match(diagnostic, /failed: stage=miio\.device/);
  assert.match(diagnostic, /code=timeout/);
  assert.match(diagnostic, /message=Could not reach \[redacted-input\]; token=\[redacted\]/);
  assert.doesNotMatch(diagnostic, new RegExp(address));
  assert.doesNotMatch(diagnostic, new RegExp(invalidToken));
});

test('diagnostic logging failures never change a successful shared pairing result', async () => {
  miioDevice = async () => ({ miioModel: 'xiaomi.vacuum.c102gl' });
  const { driver, handlers } = createPairingHarness(WifiDriver, {
    'xiaomi.vacuum.c102gl': 'Xiaomi Robot Vacuum X20+'
  });
  driver.log = () => { throw new Error('logger unavailable'); };

  const result = await handlers.test_connection({ address: '192.168.1.10', token: TOKEN, polling: 60 });

  assert.equal(result.store.model, 'xiaomi.vacuum.c102gl');
  assert.equal(result.data.id, TOKEN);
});

test('custom rice-cooker pairing reports model-validation failures and preserves cleanup', async () => {
  let destroyCalls = 0;
  miioDevice = async () => ({
    miioModel: 'unsupported.model',
    destroy: () => { destroyCalls += 1; }
  });
  const { errors, handlers, logs } = createPairingHarness(RiceCookerDriver);

  await assert.rejects(
    handlers.test_connection({ address: '192.168.1.20', token: TOKEN, polling: 60 }),
    /Unsupported model unsupported\.model/
  );

  assert.equal(destroyCalls, 1);
  assert.equal(errors.length, 1);
  assert.match(logs.join('\n'), /failed: stage=model-validation/);
});

test('custom repeater pairing keeps its payload and adds the same safe diagnostics', async () => {
  let destroyCalls = 0;
  miioDevice = async () => ({
    miioModel: 'xiaomi.repeater.rd10m',
    destroy: () => { destroyCalls += 1; }
  });
  const data = { address: '192.168.1.30', token: TOKEN, polling: 90 };
  const { handlers, logs } = createPairingHarness(RepeaterDriver, {
    'xiaomi.repeater.rd10m': 'Xiaomi WiFi Range Extender N300'
  });

  const result = await handlers.test_connection(data);

  assert.equal(destroyCalls, 1);
  assert.deepEqual(result.settings, data);
  assert.equal(result.store.model, 'xiaomi.repeater.rd10m');
  assert.deepEqual(result.capabilities, [
    'measure_repeater_download_speed',
    'measure_repeater_upload_speed',
    'measure_repeater_connected_devices',
    'repeater_status',
    'alarm_repeater_fault',
    'repeater_indicator_light',
    'repeater_indicator_brightness'
  ]);
  assert.match(logs.join('\n'), /succeeded: stage=complete/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(TOKEN));
});

test('pairing refuses to claim success when the authenticated request fails', async () => {
  const { driver, handlers } = createPairingHarness(WifiDriver);
  delete driver._requirePairingConnection;
  driver._diagnoseConnection = async () => ({ input: 'valid', handshake: 'passed', authentication: 'no_response' });
  let calls = 0;
  miioDevice = async () => { calls += 1; };
  await assert.rejects(handlers.test_connection({ address: '192.0.2.1', token: TOKEN, polling: 60 }), /authenticated information request failed/);
  assert.equal(calls, 0);
});

test('repair uses the saved settings without returning the token', async () => {
  const { driver } = createPairingHarness(WifiDriver);
  const handlers = {};
  const received = [];
  driver._diagnoseConnection = async (...args) => {
    received.push(args);
    return { input: 'valid', handshake: 'passed', authentication: 'passed' };
  };
  driver.onRepair({ setHandler: (name, fn) => { handlers[name] = fn; } }, {
    getSetting: (name) => ({ address: '192.0.2.1', token: TOKEN })[name]
  });
  const result = await handlers.diagnose_connection();
  assert.deepEqual(received, [['192.0.2.1', TOKEN]]);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('repair prevents simultaneous tests for the same device across sessions', async () => {
  const { driver } = createPairingHarness(WifiDriver);
  let complete;
  driver._diagnoseConnection = () => new Promise((resolve) => { complete = resolve; });
  const device = { getSetting: () => 'value' };
  const first = {};
  const second = {};
  driver.onRepair({ setHandler: (name, fn) => { first[name] = fn; } }, device);
  driver.onRepair({ setHandler: (name, fn) => { second[name] = fn; } }, device);
  const pending = first.diagnose_connection();
  assert.equal((await second.diagnose_connection()).input, 'busy');
  complete({ input: 'valid', handshake: 'passed', authentication: 'passed' });
  await pending;
  assert.equal(driver._repairDiagnostics.has(device), false);
});
