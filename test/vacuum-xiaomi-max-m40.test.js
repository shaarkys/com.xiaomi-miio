'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const M40 = require('../lib/vacuum-xiaomi-m40.js');

const originalLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {}, Driver: class Driver {} };
    return originalLoad.call(this, request, parent, isMain);
};
const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
const VacuumDriver = require('../drivers/vacuum_xiaomi_vacuum_max/driver.js');
Module._load = originalLoad;

async function createDevice() {
    const device = Object.create(VacuumDevice.prototype);
    const driver = Object.create(VacuumDriver.prototype);
    driver.manifest = require('../drivers/vacuum_xiaomi_vacuum_max/driver.compose.json');
    const capabilities = new Set(driver.getPairingCapabilities(M40.MODEL));
    const values = {};
    const settings = {};
    const listeners = {};
    const actions = {};
    const events = [];
    const calls = [];
    const errors = [];
    const logs = [];
    const card = (id) => ({
        registerRunListener: (listener) => { actions[id] = listener; },
        registerArgumentAutocompleteListener: () => {},
        trigger: async (_, tokens, state) => { events.push({ id, tokens, state }); }
    });
    device.homey = { flow: { getDeviceTriggerCard: card, getActionCard: card, getConditionCard: card } };
    device.util = {};
    device.bootSequence = () => {};
    device.getStoreValue = (key) => key === 'model' ? M40.MODEL : undefined;
    device.setStoreValue = async () => {};
    device.getData = () => ({ id: 'test-m40' });
    device.getName = () => 'Test M40';
    device.getOrCreateToken = async () => ({ setValue: async () => {} });
    device.log = (...args) => logs.push(args);
    device.error = (...args) => errors.push(args);
    device.hasCapability = (id) => capabilities.has(id);
    device.addCapability = async (id) => capabilities.add(id);
    device.removeCapability = async (id) => capabilities.delete(id);
    device.getCapabilityValue = (id) => values[id];
    device.updateCapabilityValue = device.setCapabilityValue = async (id, value) => { values[id] = value; };
    device.registerCapabilityListener = (id, listener) => { listeners[id] = listener; };
    device.triggerCapabilityListener = (id, value) => listeners[id](value);
    device.getSetting = (id) => settings[id];
    device.setSettings = async (patch) => Object.assign(settings, patch);
    device.getAvailable = () => true;
    device.miio = { call: async (...args) => { calls.push(args); return []; } };
    await device.onInit();
    assert.deepEqual(errors, []);
    device._syncModelFromDevice = () => true;
    device._discoverSavedMapsAfterFirstPoll = () => {};
    device.vacuumTotals = device.vacuumConsumables = device._addLiveDelta = device._accumulateJobTotals = async () => {};
    const poll = async ({ fault = 0, faults = '', status = 2, primaryCode = 0, extraCode = 0, omitPrimary = false, mode = 3, power = 0, water = 1 } = {}) => {
        device.callMiotGetProperties = async (requested, options) => {
            assert.equal(requested, device.deviceProperties.get_properties);
            assert.equal(options.chunkSize, 1);
            const readings = { device_status: status, device_fault: fault, fault_ids: faults, mode, cleaning_mode: power, water_level: water, battery: 70 };
            return requested.filter((property) => !omitPrimary || property.did !== 'device_fault').map((property) => ({
                ...property,
                code: property.did === 'device_fault' ? primaryCode : property.did === 'fault_ids' ? extraCode : 0,
                value: Object.prototype.hasOwnProperty.call(readings, property.did) ? readings[property.did] : 90
            }));
        };
        device.vacuumCleanerState = (value) => { values.vacuumcleaner_state = value; };
        await device.retrieveDeviceData();
        assert.deepEqual(errors, []);
    };
    return { device, capabilities, values, settings, actions, events, calls, logs, poll };
}

test('M40 initialization exposes supported controls without borrowing X20-only properties', async () => {
    const { device, capabilities } = await createDevice();
    assert.equal(device.deviceProperties.supports.rooms, false);
    assert.equal(device.deviceProperties.supports.clean_times, false);
    assert.equal(device.deviceProperties.supports.path_mode, false);
    assert.equal(capabilities.has('vacuum_xiaomi_path_mode_max'), false);
    assert.equal(capabilities.has('vacuum_xiaomi_carpet_mode_max'), false);
    assert.equal(capabilities.has('vacuum_xiaomi_mop_life_level'), false);
    assert.equal(capabilities.has('vacuum_xiaomi_base_station_status'), true);
    assert.equal(device._isSupportedX20Device(), false);
    assert.deepEqual(device.deviceProperties.get_properties.map(({ siid, piid }) => [siid, piid]), [
        [2, 1], [2, 2], [2, 3], [2, 6], [2, 8], [3, 1], [9, 2], [10, 2], [11, 1], [12, 2], [12, 3], [12, 4], [4, 18]
    ]);
    assert.equal(device._areaDivisor, 1);
    assert.equal(device._timeDivisor, 60);
});

test('M40 capability and Flow controls send exact model addresses and enum values', async () => {
    const { device, actions, calls } = await createDevice();
    for (let mode = 1; mode <= 4; mode++) {
        await actions.set_sweep_mop_type({ device, mode: String(mode) });
        assert.deepEqual(calls.pop(), ['set_properties', [{ siid: 2, piid: 6, value: mode }], { retries: 2 }]);
        await actions.set_cleaning_mode({ device, power: String(mode) });
        assert.deepEqual(calls.pop(), ['set_properties', [{ siid: 2, piid: 3, value: mode - 1 }], { retries: 2 }]);
    }
    for (let level = 1; level <= 3; level++) {
        await actions.set_water_level({ device, level: String(level) });
        assert.deepEqual(calls.pop(), ['set_properties', [{ siid: 2, piid: 8, value: level }], { retries: 2 }]);
    }
    for (const [command, aiid] of Object.entries({ start_dust_collection: 4, start_mop_washing: 6, stop_mop_washing: 17, start_drying: 8, stop_drying: 9 })) {
        await actions.base_station_control({ device, command });
        assert.deepEqual(calls.pop(), ['action', { siid: 2, aiid, did: `call-2-${aiid}`, in: [] }, { retries: 1 }]);
    }
    await device.triggerCapabilityListener('onoff', true);
    assert.deepEqual(calls.pop()[1], { siid: 2, aiid: 1, did: 'call-2-1', in: [] });
    await device.triggerCapabilityListener('onoff', false);
    assert.deepEqual(calls.pop()[1], { siid: 2, aiid: 2, did: 'call-2-2', in: [] });
    await device.triggerCapabilityListener('vacuumcleaner_state', 'docked');
    assert.deepEqual(calls.pop()[1], { siid: 3, aiid: 1, did: 'call-3-1', in: [] });
});

test('M40 polls mop/power/water correctly and reports cleaning and dock operations', async () => {
    const { values, poll } = await createDevice();
    for (let mode = 1; mode <= 4; mode++) {
        await poll({ mode, power: mode - 1, status: 12, water: 3 });
        assert.equal(values.vacuum_xiaomi_mop_mode_max, String(mode));
        assert.equal(values.vacuum_xiaomi_cleaning_mode_max, String(mode));
        assert.equal(values.vacuum_xiaomi_water_level_max, '3');
        assert.equal(values.vacuumcleaner_state, 'cleaning');
    }
    for (const [status, name] of [[8, 'Drying'], [9, 'Mop washing'], [22, 'Dust collection'], [30, 'Self-cleaning'], [13, 'Idle']]) {
        await poll({ status });
        assert.equal(values.vacuum_xiaomi_base_station_status, name);
        assert.equal(values.vacuumcleaner_state, 'docked');
    }
    await poll({ status: 4, fault: 17 });
    assert.equal(values.vacuumcleaner_state, 'stopped_error');
    const otherModel = Object.create(VacuumDevice.prototype);
    otherModel._applyModelProperties('xiaomi.vacuum.d109gl');
    assert.equal(otherModel._getX20BaseStationModeName(4), 'Mode 4', 'M40 state names must not reinterpret another model');
});

test('M40 merges robot and station faults, deduplicates notifications, and clears on recovery', async () => {
    const { values, events, poll } = await createDevice();
    await poll({ fault: 17, faults: '107,108,17' });
    assert.equal(values.vacuum_xiaomi_status, 'Robot stuck while turning; Clean water tank empty; Dirty water tank full');
    assert.equal(values.alarm_water_shortage, true);
    assert.equal(events.filter(({ id }) => id === 'statusVacuum').length, 1);
    await poll({ fault: 17, faults: '108,17,107' });
    assert.equal(events.filter(({ id }) => id === 'statusVacuum').length, 1);
    await poll({ faults: '108' });
    assert.equal(values.vacuum_xiaomi_status, 'Dirty water tank full');
    assert.equal(values.alarm_water_shortage, false);
    await poll({ faults: '116' });
    assert.equal(values.alarm_water_shortage, true);
    await poll();
    assert.equal(values.vacuum_xiaomi_status, 'Everything-is-ok');
    assert.equal(values.alarm_water_shortage, false);
});

test('M40 does not falsely clear a water alarm on failed or malformed fault reads', async () => {
    const { values, events, poll } = await createDevice();
    await poll({ faults: '107' });
    for (const readings of [{ extraCode: -4001 }, { primaryCode: -4001 }, { faults: 'bad' }, { faults: '[107]' }, { faults: '256' }, { faults: null }]) {
        await poll(readings);
        assert.equal(values.vacuum_xiaomi_status, 'Clean water tank empty');
        assert.equal(values.alarm_water_shortage, true);
    }
    await poll({ fault: 18, extraCode: -4001 });
    assert.equal(values.vacuum_xiaomi_status, 'Robot stuck while moving forward');
    assert.equal(values.alarm_water_shortage, true);
    await poll({ fault: 250 });
    assert.equal(values.vacuum_xiaomi_status, 'M40 fault 250');
    assert.equal(values.alarm_water_shortage, false);
    await poll({ omitPrimary: true, faults: '107' });
    assert.equal(values.alarm_water_shortage, true);
    assert.equal(events.filter(({ id }) => id === 'statusVacuum').at(-1).tokens.status, 'Clean water tank empty');
});
