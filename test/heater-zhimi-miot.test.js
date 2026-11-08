'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const DeviceInfo = require('miio/lib/device_info');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'homey') return { Device: class {} };
  return originalLoad.call(this, request, parent, isMain);
};
const Heater = require('../drivers/heater_zhimi_heater_miot/device');
Module._load = originalLoad;

const values = {
  power: true, target_temperature: 30, temperature: 21.3, humidity: 45, light: 0,
  buzzer: true, child_lock: false, heater_zhimi_heatlevel: 1, heater_zhimi_oscillation: 0
};
const timeout = () => Object.assign(new Error('Call to device timed out'), { code: 'timeout' });
const response = (params) => params.map(property => ({ ...property, code: 0, value: values[property.did] }));

async function makeHeater(handler = (method, params) => response(params), model = 'zhimi.heater.nb1') {
  const device = Object.create(Heater.prototype);
  Object.assign(device, { calls: [], values: {}, settings: {}, listeners: {}, errors: [], logs: [], timers: [], available: false });
  device.homey = {
    __: () => '', clearInterval() {}, clearTimeout() {},
    setTimeout: (callback, delay) => { const timer = { callback, delay }; device.timers.push(timer); return timer; }
  };
  device.bootSequence = () => {};
  device.getStoreValue = () => model;
  device.hasCapability = id => {
    if (id === 'measure_humidity') return model === 'zhimi.heater.za2';
    if (id === 'heater_zhimi_heatlevel' || id === 'heater_zhimi_oscillation') return model === 'zhimi.heater.nb1';
    return true;
  };
  device.registerCapabilityListener = (id, callback) => { device.listeners[id] = callback; };
  device.getAvailable = () => device.available;
  device.setAvailable = async () => { device.available = true; };
  device.setUnavailable = async () => { device.available = false; };
  device.updateCapabilityValue = async (id, value) => { device.values[id] = value; };
  device.updateSettingValue = async (id, value) => { device.settings[id] = value; };
  device.error = (...args) => device.errors.push(args.join(' '));
  device.log = (...args) => device.logs.push(args.join(' '));
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

test('nb1 keeps measured and target temperatures separate using property addresses', async () => {
  const device = await makeHeater((method, params) => response(params).reverse().map(entry => ({ ...entry, did: 'same-device-id' })));
  await device.retrieveDeviceData();
  assert.equal(device.values.measure_temperature, 21.3);
  assert.equal(device.values.heater_zhimi_heater_target_temperature, 30);
  assert.equal(device.settings.led, true);
  assert.equal(device.available, true);
  assert.match(device.logs[0], /room \(9\/7\) 21.3 C, target \(2\/5\) 30 C/);
  assert.equal(device.calls.length, 8);
  assert.ok(device.calls.every(call => call.params.length === 1 && call.options.retries === 3));
  assert.deepEqual(device.calls.map(call => [call.params[0].siid, call.params[0].piid]), [[2, 2], [2, 5], [9, 7], [6, 1], [3, 1], [7, 1], [2, 3], [2, 4]]);
});

test('all nb1 controls and settings use three attempts and preserve absolute values', async () => {
  const device = await makeHeater();
  await device.listeners.onoff(false);
  await device.listeners.heater_zhimi_heater_target_temperature('24');
  await device.listeners.heater_zhimi_heatlevel('2');
  await device.listeners.heater_zhimi_oscillation(true);
  await device.onSettings({ newSettings: { led: false, buzzer: false, childLock: true }, changedKeys: ['led', 'buzzer', 'childLock'] });
  await device.onSettings({ newSettings: { led: true }, changedKeys: ['led'] });
  assert.deepEqual(device.calls.map(call => call.params[0].value), [false, 24, 2, 1, 2, false, true, 0]);
  assert.deepEqual(device.calls.map(call => [call.params[0].siid, call.params[0].piid]), [[2, 2], [2, 5], [2, 3], [2, 4], [6, 1], [3, 1], [7, 1], [6, 1]]);
  assert.ok(device.calls.every(call => call.options.retries === 3));
});

test('nb1 decodes dimmed and extinguished LEDs correctly', async () => {
  for (const [brightness, expected] of [[0, true], [1, true], [2, false]]) {
    const device = await makeHeater((method, params) => response(params).map(entry => entry.did === 'light' ? { ...entry, value: brightness } : entry));
    await device.retrieveDeviceData();
    assert.equal(device.settings.led, expected);
  }
});

test('nb1 rejects a device-side write error instead of reporting success', async () => {
  const device = await makeHeater((method, params) => params.map(property => ({ ...property, code: -4004 })));
  await assert.rejects(device.listeners.onoff(false), /2\/2 failed \(code -4004\)/);
  assert.equal(device.calls.length, 1);
});

test('nb1 rejects invalid property replies before publishing any values or availability', async () => {
  const mutations = [
    () => null,
    result => result.filter(entry => entry.did !== 'temperature'),
    result => result.map(entry => entry.did === 'temperature' ? { ...entry, code: -4004, value: 30 } : entry),
    result => result.map(entry => entry.did === 'temperature' ? { ...entry, siid: 2, piid: 5, value: 30 } : entry),
    ...[undefined, null, '30', NaN].map(value => result => result.map(entry => entry.did === 'temperature' ? { ...entry, value } : entry))
  ];
  for (const mutate of mutations) {
    const device = await makeHeater((method, params) => mutate(response(params)));
    await device.retrieveDeviceData();
    assert.deepEqual(device.values, {});
    assert.equal(device.available, false);
    assert.equal(device.timers.length, 1);
    assert.equal(device.recreateTimeout, device.timers[0]);
    assert.equal(device.timers[0].delay, 60000);
    assert.match(device.errors[0], /nb1/);
  }
});

test('overlapping nb1 polls share no additional transport request', async () => {
  let finish;
  const device = await makeHeater((method, params) => {
    if (!finish) return new Promise(resolve => { finish = () => resolve(response(params)); });
    return response(params);
  });
  const first = device.retrieveDeviceData();
  await device.retrieveDeviceData();
  assert.equal(device.calls.length, 1);
  finish();
  await first;
  assert.equal(device.isRetrievingDeviceData, false);
});

test('a failed nb1 property read stops the remaining requests without publishing partial values', async () => {
  const device = await makeHeater((method, params) => {
    if (params[0].did === 'target_temperature') throw timeout();
    return response(params);
  });
  await device.retrieveDeviceData();
  assert.equal(device.calls.length, 2);
  assert.deepEqual(device.values, {});
  assert.equal(device.available, false);
  assert.equal(device.timers.length, 1);
});

test('nb1 power off can run between individual polling requests', async () => {
  let finish;
  let power = true;
  const device = await makeHeater((method, params) => {
    if (method === 'set_properties') power = params[0].value;
    if (method === 'get_properties' && !finish) return new Promise(resolve => { finish = () => resolve(response(params)); });
    return response(params).map(entry => entry.did === 'power' ? { ...entry, value: power } : entry);
  });
  const poll = device.retrieveDeviceData();
  await Promise.resolve();
  const off = device.listeners.onoff(false);
  finish();
  await off;
  await poll;
  assert.deepEqual(device.calls.slice(0, 3).map(call => call.method), ['get_properties', 'set_properties', 'get_properties']);
  assert.equal(device.calls[1].params[0].value, false);
  assert.deepEqual(device.values, {});
  await device.retrieveDeviceData();
  assert.equal(device.values.onoff, false);
});

test('interleaved settings writes, including lost acknowledgements, invalidate the entire nb1 poll snapshot', async () => {
  for (const [key, value, property, rawValue] of [['led', false, 'light', 2], ['buzzer', false, 'buzzer', false], ['childLock', true, 'child_lock', true]]) {
    for (const fail of [false, true]) {
      let finish;
      const current = { ...values };
      const reply = params => params.map(prop => ({ ...prop, code: 0, value: current[prop.did] }));
      const device = await makeHeater((method, params) => {
        if (method === 'set_properties') {
          current[property] = rawValue;
          if (fail) throw timeout();
        }
        if (method === 'get_properties' && !finish) {
          const snapshot = reply(params);
          return new Promise(resolve => { finish = () => resolve(snapshot); });
        }
        return reply(params);
      });
      const poll = device.retrieveDeviceData();
      await Promise.resolve();
      const write = device.onSettings({ newSettings: { [key]: value }, changedKeys: [key] });
      const outcome = fail ? assert.rejects(write, /timed out/) : write;
      finish();
      await outcome;
      await poll;
      assert.deepEqual(device.values, {});
      assert.deepEqual(device.settings, {});
      await device.retrieveDeviceData();
      assert.equal(device.settings[key], value);
    }
  }
});

test('a nb1 command waits for already-started publication to finish', async () => {
  const device = await makeHeater();
  let release;
  let started;
  const publishing = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  device.updateCapabilityValue = async (id, value) => {
    if (id === 'onoff') { started(); await gate; }
    device.values[id] = value;
  };
  const poll = device.retrieveDeviceData();
  await publishing;
  const off = device.listeners.onoff(false);
  await Promise.resolve();
  assert.ok(device.calls.every(call => call.method === 'get_properties'));
  release();
  await poll;
  await off;
  device.values.onoff = false; // Homey's accepted capability command.
  assert.equal(device.values.onoff, false);
  assert.equal(device.calls.at(-1).method, 'set_properties');
});

test('late nb1 poll completion after deletion or connection replacement cannot update state or reconnect', async () => {
  for (const action of ['delete', 'replace']) {
    for (const fail of [true, false]) {
      let finish;
      const device = await makeHeater((method, params) => new Promise((resolve, reject) => {
        finish = () => fail ? reject(timeout()) : resolve(response(params));
      }));
      const poll = device.retrieveDeviceData();
      await Promise.resolve();
      if (action === 'delete') await device.onDeleted();
      else device.miio = {};
      finish();
      await poll;
      assert.deepEqual(device.values, {});
      assert.deepEqual(device.timers, []);
      assert.deepEqual(device.errors, []);
      assert.equal(device.available, false);
    }
  }
});

test('nb1 commands stay ordered and a failed command does not block power off', async () => {
  let finish;
  const device = await makeHeater((method, params) => {
    if (params[0].value === true) return new Promise((resolve, reject) => { finish = () => reject(timeout()); });
    return response(params);
  });
  const first = device.listeners.onoff(true);
  const failed = assert.rejects(first, /timed out/);
  const second = device.listeners.onoff(false);
  await Promise.resolve();
  assert.equal(device.calls.length, 1);
  finish();
  await failed;
  await second;
  assert.deepEqual(device.calls.map(call => call.params[0].value), [true, false]);
});

test('queued nb1 commands are cancelled after deletion or connection replacement', async () => {
  for (const action of ['delete', 'replace']) {
    let finish;
    const device = await makeHeater((method, params) => new Promise(resolve => { finish = () => resolve(response(params)); }));
    const first = device.listeners.onoff(true);
    const second = device.listeners.onoff(false);
    const cancelled = assert.rejects(second, /connection changed/);
    await Promise.resolve();
    if (action === 'delete') await device.onDeleted();
    else device.miio = {};
    finish();
    await first;
    await cancelled;
    assert.equal(device.calls.length, 1);
  }
});

test('other heater models retain one-attempt calls and existing reply handling', async () => {
  for (const model of ['zhimi.heater.mc2', 'zhimi.heater.za2', 'leshow.heater.bs1s', 'zhimi.heater.zb1a']) {
    const device = await makeHeater(undefined, model);
    await device.listeners.onoff(true);
    await device.retrieveDeviceData();
    assert.equal(device.values.measure_temperature, 21.3);
    assert.ok(device.calls.every(call => call.options.retries === 1));
    assert.deepEqual(device.errors, []);
  }
});

test('installed miio transport retries timeout attempts twice, but stops on protocol errors', async () => {
  let attempts = 0;
  const transport = Object.create(DeviceInfo.prototype);
  transport._createDeadline = () => ({ clear() {} });
  transport.debug = () => {};
  const device = await makeHeater((method, params, options) => transport._retryOnTimeout(options.retries, async () => {
    if (++attempts < 3) throw timeout();
    return response(params);
  }));
  await device.listeners.onoff(false);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(transport._retryOnTimeout(3, async () => {
    attempts++;
    throw Object.assign(new Error('unsupported property'), { code: -4004 });
  }), /unsupported property/);
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(transport._retryOnTimeout(3, async () => { attempts++; throw timeout(); }), /Call to device timed out/);
  assert.equal(attempts, 3);
});
