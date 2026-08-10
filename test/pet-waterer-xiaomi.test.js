'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const {
    IV02_PROFILE,
    MODES,
    buildPropertyPayload,
    buildSetPropertyPayload,
    findValidPropertyResult,
    getPropertyDefinition,
    isValidMiotResult,
    mapAlarmCapabilities,
    validateInterval
} = require('../lib/pet-waterer-xiaomi-miot.js');

function loadDeviceClass() {
    const originalLoad = Module._load;
    Module._load = function loadWithHomeyStub(request, parent, isMain) {
        if (request === 'homey') return { Device: class Device {} };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require('../drivers/pet_waterer_xiaomi/device.js');
    } finally {
        Module._load = originalLoad;
    }
}

test('IV02 profile keeps legacy 2.7 and revision-2 2.11 interval identifiers', () => {
    assert.deepEqual(getPropertyDefinition(IV02_PROFILE, 'out_water_interval_15'), { did: 'out_water_interval_15', siid: 2, piid: 7 });
    assert.deepEqual(getPropertyDefinition(IV02_PROFILE, 'out_water_interval'), { did: 'out_water_interval', siid: 2, piid: 11 });
    assert.deepEqual(IV02_PROFILE.set_properties.out_water_interval, { siid: 2, piid: 11 });
    assert.deepEqual(getPropertyDefinition(IV02_PROFILE, 'child_lock'), { did: 'child_lock', siid: 4, piid: 1 });
    assert.deepEqual(getPropertyDefinition(IV02_PROFILE, 'no_disturb'), { did: 'no_disturb', siid: 6, piid: 1 });
    assert.deepEqual(getPropertyDefinition(IV02_PROFILE, 'pump_block_flag'), { did: 'pump_block_flag', siid: 9, piid: 12 });
});

test('MIoT property payloads use the connected physical DID', () => {
    const definitions = [getPropertyDefinition(IV02_PROFILE, 'onoff'), getPropertyDefinition(IV02_PROFILE, 'mode')];
    assert.deepEqual(buildPropertyPayload(definitions, 'connected-miot-id'), [
        { did: 'connected-miot-id', siid: 2, piid: 1 },
        { did: 'connected-miot-id', siid: 2, piid: 4 }
    ]);
    assert.deepEqual(buildSetPropertyPayload(definitions[1], 42, 2), { did: '42', siid: 2, piid: 4, value: 2 });
});

test('connected DID is used by device get/set calls and reset action uses call-3-1', async () => {
    const DeviceClass = loadDeviceClass();
    const calls = [];
    const device = Object.create(DeviceClass.prototype);
    device.deviceProperties = IV02_PROFILE;
    device.homey = {
        setTimeout: (callback) => {
            callback();
            return undefined;
        }
    };
    device.miio = {
        handle: { api: { id: 'physical-did' } },
        call: async (...args) => {
            calls.push(args);
            return [];
        }
    };

    await device.setMiotProperty('mode', 2);
    await device.getMiotProperties();
    await device.resetFilterLife();

    assert.deepEqual(calls[0], ['set_properties', [{ did: 'physical-did', siid: 2, piid: 4, value: 2 }], { retries: 1 }]);
    const getCalls = calls.filter((call) => call[0] === 'get_properties');
    assert.equal(getCalls.length, 2, '15 revision-2 properties should be split into two bounded requests');
    assert.ok(getCalls.every((call) => call[1].length <= 8));
    assert.ok(getCalls.every((call) => call[1].every((property) => property.did === 'physical-did')));
    assert.ok(getCalls.every((call) => call[1].every((property) => !(property.siid === 2 && property.piid === 7))));
    assert.deepEqual(calls.at(-1), ['action', { did: 'call-3-1', siid: 3, aiid: 1, in: [] }, { retries: 1 }]);
    assert.notEqual(calls.at(-1)[1].in, IV02_PROFILE.actions.reset_filter_life.in, 'action inputs must be mutable per call');
});

test('battery capability migration is conditional and idempotent', async () => {
    const DeviceClass = loadDeviceClass();
    const logs = [];
    const errors = [];
    const device = Object.create(DeviceClass.prototype);
    device.log = (message) => logs.push(message);
    device.error = (message) => errors.push(message);
    const capabilities = new Set(['measure_battery', 'alarm_battery']);
    const added = [];
    device.hasCapability = (capability) => capabilities.has(capability);
    device.addCapability = async (capability) => {
        added.push(capability);
        capabilities.add(capability);
    };

    await device.migrateBatteryCapabilities();
    assert.deepEqual(added, []);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /skipped/);

    capabilities.delete('alarm_battery');
    logs.length = 0;
    await device.migrateBatteryCapabilities();
    assert.deepEqual(added, ['alarm_battery']);
    assert.match(logs[0], /Starting/);
    assert.match(logs.at(-1), /Completed/);
    assert.deepEqual(errors, []);
});

test('battery capability migration logs failures without blocking initialization', async () => {
    const DeviceClass = loadDeviceClass();
    const errors = [];
    const device = Object.create(DeviceClass.prototype);
    device.log = () => {};
    device.error = (message) => errors.push(message);
    device.hasCapability = () => false;
    device.addCapability = async () => { throw new Error('capability add failed'); };

    await assert.doesNotReject(device.migrateBatteryCapabilities());
    assert.equal(errors.length, 1);
    assert.match(errors[0], /capability add failed/);
});

test('invalid polling results preserve the last-valid diagnostic cache', async () => {
    const DeviceClass = loadDeviceClass();
    const device = Object.create(DeviceClass.prototype);
    device.deviceProperties = IV02_PROFILE;
    device._lastPropertyValues = {};
    device.getAvailable = () => false;
    device.setAvailable = async () => {};
    device.getCapabilityValue = () => '0';
    device.setCapabilityValue = async () => {};
    device.updateCapabilityValue = async () => {};
    device.updateSettingValue = async () => {};
    device.log = () => {};
    device.error = () => {};
    device.homey = {
        clearInterval: () => {},
        setTimeout: () => undefined,
        __: (key) => key,
        flow: { getDeviceTriggerCard: () => ({ trigger: async () => {} }) }
    };
    const polls = [
        [{ siid: 2, piid: 1, code: 0, value: true }],
        [{ siid: 2, piid: 1, code: 1, value: false }]
    ];
    device.getMiotProperties = async () => polls.shift();

    await device.retrieveDeviceData();
    assert.equal(device._lastPropertyValues.onoff, true);
    await device.retrieveDeviceData();
    assert.equal(device._lastPropertyValues.onoff, true);
});

test('valid MIoT result filtering preserves false and zero and rejects failures/nulls', () => {
    assert.equal(isValidMiotResult({ code: 0, value: false }), true);
    assert.equal(isValidMiotResult({ code: 0, value: 0 }), true);
    assert.equal(isValidMiotResult({ code: 0, value: null }), false);
    assert.equal(isValidMiotResult({ code: 1, value: true }), false);

    const definition = getPropertyDefinition(IV02_PROFILE, 'water_shortage_status');
    assert.deepEqual(findValidPropertyResult([
        { siid: 2, piid: 10, code: 2, value: true },
        { siid: 2, piid: 10, code: 0, value: false }
    ], definition), { siid: 2, piid: 10, code: 0, value: false });
    assert.equal(findValidPropertyResult([{ siid: 2, piid: 10, code: 0, value: null }], definition), undefined);
});

test('shortage drives both water alarms and pump block drives pump-supply alarm', () => {
    assert.deepEqual(mapAlarmCapabilities([
        { siid: 2, piid: 10, code: 0, value: true },
        { siid: 9, piid: 12, code: 0, value: false }
    ]), {
        alarm_tank_empty: true,
        alarm_water_shortage: true,
        alarm_pump_supply: false
    });
});

test('interval validation accepts only the released 10..120 step-5 range', () => {
    assert.equal(validateInterval(10), 10);
    assert.equal(validateInterval('120'), 120);
    for (const value of [9, 11, 119, 121, 10.5, 'invalid']) {
        assert.throws(() => validateInterval(value), RangeError);
    }
});

test('IV02 mode Flow action is registered once at app scope, not by each device', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const deviceSource = fs.readFileSync(path.join(__dirname, '..', 'drivers', 'pet_waterer_xiaomi', 'device.js'), 'utf8');
    assert.equal((appSource.match(/getActionCard\('petwaterdispenserMmggMode_Xiaomi'\)/g) || []).length, 1);
    assert.equal((deviceSource.match(/getActionCard\('petwaterdispenserMmggMode_Xiaomi'\)/g) || []).length, 0);
    assert.ok(appSource.includes("triggerCapabilityListener('petwaterdispenser_mmgg_mode_3'"));
    assert.deepEqual(MODES, { 0: 'Auto', 1: 'Interval', 2: 'Constant' });
});
