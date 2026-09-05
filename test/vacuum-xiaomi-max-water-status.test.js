'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {} };
    return originalLoad.call(this, request, parent, isMain);
};
const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
Module._load = originalLoad;

function createDevice(model = 'xiaomi.vacuum.d109gl') {
    const device = Object.create(VacuumDevice.prototype);
    const capabilities = {};
    const settings = {};
    const errors = [];
    const events = [];
    device.homey = { flow: { getDeviceTriggerCard: (id) => ({ trigger: async (_, tokens) => events.push({ id, tokens }) }) } };
    device.log = () => {};
    device.error = (...args) => errors.push(args);
    device._applyModelProperties(model);
    device._syncModelFromDevice = () => true;
    device._roomsDiscovered = true;
    device.miio = { call: async () => [] };
    device.getAvailable = () => true;
    device.hasCapability = (id) => ['alarm_water_shortage', 'vacuum_xiaomi_status', 'vacuum_xiaomi_base_station_status'].includes(id);
    device.getCapabilityValue = (id) => capabilities[id];
    device.updateCapabilityValue = device.setCapabilityValue = async (id, value) => { capabilities[id] = value; };
    device.vacuumCleanerState = (value) => { capabilities.vacuumcleaner_state = value; };
    device.getSetting = (key) => settings[key];
    device.setSettings = async (values) => Object.assign(settings, values);
    device.vacuumConsumables = device.vacuumTotals = device._addLiveDelta = device._accumulateJobTotals = async () => {};
    const poll = async ({ status = 4, fault = 210030, base = 0, water, ids, detergent = false } = {}) => {
        device.callVacuumGetProperties = async () => [
            { siid: 2, piid: 2, code: 0, value: status },
            { siid: 2, piid: 3, code: 0, value: fault },
            { siid: 2, piid: 4, code: 0, value: 3 },
            { siid: 3, piid: 1, code: 0, value: 75 },
            { siid: 2, piid: 6, code: 0, value: 2500 },
            { siid: 2, piid: 7, code: 0, value: 2040 },
            { siid: 2, piid: 71, code: 0, value: detergent },
            { siid: 2, piid: 18, code: 0, value: JSON.stringify({ mode: base, runtime: 0, total_time: 0 }) },
            ...(water ? [{ siid: 2, piid: 54, ...water }] : []),
            ...(ids ? [{ siid: 2, piid: 66, ...ids }] : [])
        ];
        await device.retrieveDeviceData();
        assert.deepEqual(errors, []);
    };
    return { capabilities, settings, events, poll };
}

test('replays Living Room refill: paused, washing, then cleaning with retained 210030', async () => {
    const { capabilities, settings, events, poll } = createDevice();
    await poll({ status: 5 });
    assert.equal(capabilities.alarm_water_shortage, true);
    assert.equal(capabilities.vacuum_xiaomi_status, 'Water tank empty');
    await poll({ status: 7, base: 3 });
    assert.equal(capabilities.vacuum_xiaomi_base_station_status, 'Mop washing');
    assert.equal(capabilities.alarm_water_shortage, true);
    await poll();
    assert.equal(capabilities.vacuumcleaner_state, 'cleaning');
    assert.equal(capabilities.vacuum_xiaomi_base_station_status, 'Idle');
    assert.equal(capabilities.vacuum_xiaomi_status, 'OK - Working');
    assert.equal(capabilities.alarm_water_shortage, false);
    assert.equal(settings.error, 'Everything-is-ok');
    await poll();
    assert.equal(events.filter(({ id }) => id === 'statusVacuum').length, 1);
});

test('replays restart log: charging with retained 210030 but fault object reports no active fault', async () => {
    const { capabilities, settings, poll } = createDevice();
    await poll({ status: 2, water: { code: 0, value: 0 }, ids: { code: 0, value: '{"ts":1788622805,"fault":[0]}' } });
    assert.equal(capabilities.vacuumcleaner_state, 'charging');
    assert.equal(capabilities.vacuum_xiaomi_base_station_status, 'Idle');
    assert.equal(capabilities.alarm_water_shortage, false);
    assert.equal(capabilities.vacuum_xiaomi_status, 'Everything-is-ok');
    assert.equal(settings.error, 'Everything-is-ok');
});

test('structured fault lists use only fault codes and retain real failures', async () => {
    const { capabilities, poll } = createDevice();
    for (const encode of [JSON.stringify, (value) => value]) {
        await poll({ status: 2, ids: { code: 0, value: encode({ ts: 210030, fault: [0] }) } });
        assert.equal(capabilities.alarm_water_shortage, false, 'timestamp is not a fault code');
        await poll({ water: { code: 0, value: 2 }, ids: { code: 0, value: encode({ ts: 1788622805, fault: [0, 210030] }) } });
        assert.equal(capabilities.alarm_water_shortage, true, 'active fault wins over water check success');
        await poll({ water: { code: 0, value: 3 }, ids: { code: 0, value: encode({ fault: [0] }) } });
        assert.equal(capabilities.alarm_water_shortage, true, 'water check failure wins over clear fault list');
    }
});

for (const model of ['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl']) {
    test(`${model} uses successful water diagnostics and an empty fault list`, async () => {
        const { capabilities, poll } = createDevice(model);
        for (const diagnostics of [
            { water: { code: 0, value: 2 } },
            { ids: { code: 0, value: '[]' } },
            { ids: { code: 0, value: '' } },
            { ids: { code: 0, value: '100031, 210004' } }
        ]) {
            await poll({ status: 5, ...diagnostics });
            assert.equal(capabilities.alarm_water_shortage, false);
        }
    });

    test(`${model} keeps explicit water failures even with contradictory recovery evidence`, async () => {
        const { capabilities, poll } = createDevice(model);
        for (const diagnostics of [
            { water: { code: 0, value: 3 } },
            { water: { code: 0, value: 3 }, ids: { code: 0, value: '[]' } },
            { water: { code: 0, value: 2 }, ids: { code: 0, value: '[210030]' } },
            { ids: { code: 0, value: '100031,210030' } }
        ]) {
            await poll(diagnostics);
            assert.equal(capabilities.alarm_water_shortage, true);
            assert.equal(capabilities.vacuum_xiaomi_status, 'Water tank empty');
        }
    });
}

test('malformed diagnostic values are not interpreted as an empty fault list', async () => {
    const { capabilities, poll } = createDevice();
    for (const value of ['invalid', '[', '[210030', 'null', 'false', '{}', '[0,]', '[-210030]',
        '{"ts":1788622805}', '{"fault":null}', '{"fault":"[0]"}', '{"fault":[false]}', '{"fault":[-1]}', '{"fault":[0,{}]}']) {
        await poll({ ids: { code: 0, value } });
        assert.equal(capabilities.alarm_water_shortage, true, value);
    }
    await poll({ water: { code: 0, value: false } });
    assert.equal(capabilities.alarm_water_shortage, true);
});

test('failed diagnostic reads cannot clear a paused alarm or contribute stale failure values', async () => {
    const { capabilities, poll } = createDevice();
    await poll({ status: 5, water: { code: -1, value: 2 }, ids: { code: -1, value: '[]' } });
    assert.equal(capabilities.alarm_water_shortage, true);
    await poll({ water: { code: -1, value: 3 }, ids: { code: -1, value: '[210030]' } });
    assert.equal(capabilities.alarm_water_shortage, false);
});

test('only floor-cleaning states imply recovery when diagnostics are unavailable', async () => {
    const { capabilities, poll } = createDevice();
    for (const status of [1, 5, 7, 8, 10, 12, 15, 19]) {
        await poll({ status });
        assert.equal(capabilities.alarm_water_shortage, true, `status ${status}`);
    }
    for (const status of [4, 16, 17]) {
        await poll({ status });
        assert.equal(capabilities.alarm_water_shortage, false, `status ${status}`);
    }
});

test('retains other errors, detergent reminders, and unrelated model behavior', async () => {
    const { capabilities, poll } = createDevice();
    await poll({ fault: 210004 });
    assert.equal(capabilities.vacuum_xiaomi_status, 'Stuck-error');
    await poll({ fault: 210050 });
    assert.equal(capabilities.alarm_water_shortage, true);
    await poll({ detergent: true });
    assert.equal(capabilities.alarm_water_shortage, true);
    assert.equal(capabilities.vacuum_xiaomi_status, 'OK - Working');
    for (const model of ['xiaomi.vacuum.ov51gl', 'xiaomi.vacuum.ov43gb']) {
        const other = createDevice(model);
        await other.poll();
        assert.equal(other.capabilities.vacuum_xiaomi_status, 'Water tank empty');
    }
});
