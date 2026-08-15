'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const BASE_STATION_STATUS_CAPABILITY = 'vacuum_xiaomi_base_station_status';
const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') {
        return { Device: class Device {}, Driver: class Driver {} };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
};

const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
const VacuumDriver = require('../drivers/vacuum_xiaomi_vacuum_max/driver.js');
Module._load = originalModuleLoad;

function createFlow(order) {
    const actionListeners = {};
    const conditionListeners = {};
    const events = [];
    const triggerListeners = {};
    const triggerCards = new Map();
    const conditionCards = new Map();
    const actionCards = new Map();

    const getDeviceTriggerCard = (id) => {
        if (!triggerCards.has(id)) {
            triggerCards.set(id, {
                registerRunListener: (listener) => {
                    triggerListeners[id] = listener;
                },
                trigger: async (device, tokens, state) => {
                    if (order) order.push(`trigger:${id}`);
                    events.push({ device, id, state, tokens });
                }
            });
        }
        return triggerCards.get(id);
    };
    const getConditionCard = (id) => {
        if (!conditionCards.has(id)) {
            conditionCards.set(id, {
                registerRunListener: (listener) => {
                    conditionListeners[id] = listener;
                }
            });
        }
        return conditionCards.get(id);
    };
    const getActionCard = (id) => {
        if (!actionCards.has(id)) {
            actionCards.set(id, {
                registerRunListener: (listener) => {
                    actionListeners[id] = listener;
                }
            });
        }
        return actionCards.get(id);
    };

    return {
        actionListeners,
        conditionListeners,
        events,
        flow: { getActionCard, getConditionCard, getDeviceTriggerCard },
        triggerListeners
    };
}

function createVacuumDevice(model, { flow = createFlow() } = {}) {
    const errors = [];
    const logs = [];
    const device = Object.create(VacuumDevice.prototype);
    device._model = model;
    device.homey = { flow: flow.flow };
    device.error = (...args) => errors.push(args);
    device.log = (...args) => logs.push(args);
    device._applyModelProperties(model);
    return { device, errors, flow, logs };
}

function c102Result(value) {
    return [{ siid: 2, piid: 1, value }];
}

function baseStatusResult(value) {
    return [{ siid: 2, piid: 18, value }];
}

function enableBaseStationCapability(device, updates, order) {
    device.hasCapability = (capability) => capability === BASE_STATION_STATUS_CAPABILITY;
    device.setCapabilityValue = async (capability, value) => {
        assert.equal(capability, BASE_STATION_STATUS_CAPABILITY);
        updates.push(value);
        if (order) order.push(`capability:${value}`);
    };
}

function createOnInitDevice(model, { existingBaseStationCapability = false, failBaseStationMigration = false } = {}) {
    const flow = createFlow();
    const capabilities = new Set([
        'vacuum_xiaomi_mop_mode_max',
        'vacuum_xiaomi_cleaning_mode_max',
        'vacuum_xiaomi_water_level_max',
        'vacuum_xiaomi_path_mode_max',
        'vacuum_xiaomi_carpet_mode_max',
        'alarm_main_brush_work_time',
        'alarm_side_brush_work_time',
        'alarm_filter_work_time',
        'alarm_water_shortage'
    ]);
    if (existingBaseStationCapability) capabilities.add(BASE_STATION_STATUS_CAPABILITY);

    const added = [];
    const errors = [];
    const logs = [];
    const removed = [];
    const device = Object.create(VacuumDevice.prototype);
    device._model = model;
    device.homey = { flow: flow.flow };
    device.util = {};
    device.bootSequence = async () => {};
    device.getStoreValue = (key) => {
        if (key === 'model') return model;
        if (key === 'carpetModeState') return '0';
        return undefined;
    };
    device.setStoreValue = async () => {};
    device.hasCapability = (capability) => capabilities.has(capability);
    device.addCapability = async (capability) => {
        added.push(capability);
        if (failBaseStationMigration && capability === BASE_STATION_STATUS_CAPABILITY) throw new Error('base station migration failed');
        capabilities.add(capability);
    };
    device.removeCapability = async (capability) => removed.push(capability);
    device.updateCapabilityValue = async () => {};
    device.getData = () => ({ id: 'test-vacuum' });
    device.getName = () => 'Test vacuum';
    device.getOrCreateToken = async () => ({ setValue: async () => {} });
    device.registerCapabilityListener = () => {};
    device.error = (...args) => errors.push(args);
    device.log = (...args) => logs.push(args);

    return { added, capabilities, device, errors, flow, logs, removed };
}

test('pairing adds the base-station capability only for the exact supported model set', () => {
    const driverCompose = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'drivers', 'vacuum_xiaomi_vacuum_max', 'driver.compose.json'), 'utf8'));
    const capabilityCompose = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.homeycompose', 'capabilities', 'vacuum_xiaomi_base_station_status.json'), 'utf8'));
    const manifest = {
        capabilities: ['onoff', 'vacuum_xiaomi_status', BASE_STATION_STATUS_CAPABILITY, 'measure_battery']
    };
    const driver = Object.create(VacuumDriver.prototype);
    driver.manifest = manifest;

    for (const model of ['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl', 'xiaomi.vacuum.ov51gl', 'xiaomi.vacuum.c102gl']) {
        assert.deepEqual(driver.getPairingCapabilities(model), manifest.capabilities);
    }
    for (const model of ['xiaomi.vacuum.d101', 'xiaomi.vacuum.d101gl', 'xiaomi.vacuum.ov71gl', 'xiaomi.vacuum.b108gl', 'xiaomi.vacuum.c108', 'unknown.model']) {
        assert.deepEqual(driver.getPairingCapabilities(model), ['onoff', 'vacuum_xiaomi_status', 'measure_battery']);
    }
    const unavailableManifestDriver = Object.create(VacuumDriver.prototype);
    assert.equal(unavailableManifestDriver.getPairingCapabilities('xiaomi.vacuum.d102gl'), undefined);
    unavailableManifestDriver.manifest = {};
    assert.equal(unavailableManifestDriver.getPairingCapabilities('xiaomi.vacuum.d101'), undefined);
    assert.deepEqual(manifest.capabilities, ['onoff', 'vacuum_xiaomi_status', BASE_STATION_STATUS_CAPABILITY, 'measure_battery']);
    assert.ok(driverCompose.capabilities.includes(BASE_STATION_STATUS_CAPABILITY));
    assert.deepEqual(capabilityCompose, {
        type: 'string',
        title: { en: 'Base station status' },
        getable: true,
        setable: false,
        insights: false,
        uiComponent: 'sensor',
        icon: '/assets/icons/vacuum-mop.svg'
    });
});

test('onInit migrates the base-station capability idempotently and preserves initialization after a migration failure', async () => {
    const migrated = createOnInitDevice('xiaomi.vacuum.d102gl');
    await migrated.device.onInit();
    await migrated.device.onInit();
    assert.deepEqual(migrated.added, [BASE_STATION_STATUS_CAPABILITY]);
    assert.ok(migrated.capabilities.has(BASE_STATION_STATUS_CAPABILITY));
    assert.ok(migrated.logs.some((args) => args.join(' ').includes('Adding base-station status capability')));
    assert.ok(migrated.logs.some((args) => args.join(' ').includes('Added base-station status capability')));

    const failed = createOnInitDevice('xiaomi.vacuum.ov51gl', { failBaseStationMigration: true });
    await failed.device.onInit();
    assert.deepEqual(failed.added, [BASE_STATION_STATUS_CAPABILITY]);
    assert.ok(failed.errors.some((args) => args.join(' ').includes('base station migration failed')));
    assert.equal(typeof failed.flow.actionListeners.base_station_control, 'function', 'the failed migration must not stop later initialization');

    const legacy = createOnInitDevice('xiaomi.vacuum.d101', { existingBaseStationCapability: true });
    await legacy.device.onInit();
    assert.deepEqual(legacy.removed, [], 'the migration must not remove the capability from existing devices');
    assert.ok(legacy.capabilities.has(BASE_STATION_STATUS_CAPABILITY));
});

test('base-station Flow Compose preserves legacy contracts while adding the scoped control action', () => {
    const compose = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'drivers', 'vacuum_xiaomi_vacuum_max', 'driver.flow.compose.json'), 'utf8'));
    const findById = (items, id) => items.find((item) => item.id === id);
    const rawTrigger = findById(compose.triggers, 'x20_raw_status_changed');
    const baseTrigger = findById(compose.triggers, 'x20_base_station_status_changed');
    const rawCondition = findById(compose.conditions, 'x20_raw_status_is');
    const baseCondition = findById(compose.conditions, 'x20_base_station_status_is');
    const action = findById(compose.actions, 'base_station_control');

    assert.equal(rawTrigger.title.en, 'X20 Pro/Max raw status changed');
    assert.equal(rawCondition.title.en, 'X20 Pro/Max raw status is');
    assert.equal(baseTrigger.title.en, 'Base station status changed');
    assert.equal(baseCondition.title.en, 'Base station status is');
    assert.deepEqual(baseTrigger.tokens.map((token) => token.name), ['base_status_code', 'base_status_name', 'previous_base_status_code', 'previous_base_status_name']);
    assert.deepEqual(baseTrigger.args.map((arg) => arg.name), ['mode']);
    assert.deepEqual(baseCondition.args.map((arg) => arg.name), ['mode']);
    assert.deepEqual(action.args.map((arg) => arg.name), ['command']);
    assert.deepEqual(action.args[0].values.map((value) => value.id), [
        'start_dust_collection',
        'start_mop_washing',
        'stop_mop_washing',
        'start_drying',
        'stop_drying'
    ]);
});

test('base-station control routes every supported command through the target device only', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.d102gl');
    device._registerBaseStationControlFlowListener();
    const listener = flow.actionListeners.base_station_control;
    const commands = ['start_dust_collection', 'start_mop_washing', 'stop_mop_washing', 'start_drying', 'stop_drying'];
    const descriptors = {
        'xiaomi.vacuum.d102gl': {
            start_dust_collection: { siid: 2, aiid: 18, did: 'call-2-18', in: [] },
            start_mop_washing: { siid: 2, aiid: 19, did: 'call-2-19', in: [] },
            stop_mop_washing: { siid: 2, aiid: 31, did: 'call-2-31', in: [] },
            start_drying: { siid: 2, aiid: 20, did: 'call-2-20', in: [] },
            stop_drying: { siid: 2, aiid: 32, did: 'call-2-32', in: [] }
        },
        'xiaomi.vacuum.d109gl': {
            start_dust_collection: { siid: 2, aiid: 18, did: 'call-2-18', in: [] },
            start_mop_washing: { siid: 2, aiid: 19, did: 'call-2-19', in: [] },
            stop_mop_washing: { siid: 2, aiid: 31, did: 'call-2-31', in: [] },
            start_drying: { siid: 2, aiid: 20, did: 'call-2-20', in: [] },
            stop_drying: { siid: 2, aiid: 32, did: 'call-2-32', in: [] }
        },
        'xiaomi.vacuum.c102gl': {
            start_dust_collection: { siid: 2, aiid: 4, did: 'call-2-4', in: [] },
            start_mop_washing: { siid: 2, aiid: 6, did: 'call-2-6', in: [] },
            start_drying: { siid: 2, aiid: 8, did: 'call-2-8', in: [] },
            stop_drying: { siid: 2, aiid: 9, did: 'call-2-9', in: [] }
        },
        'xiaomi.vacuum.ov51gl': {
            start_dust_collection: { siid: 2, aiid: 18, did: 'call-2-18', in: [] }
        }
    };

    for (const [model, supportedCommands] of Object.entries(descriptors)) {
        for (const command of commands) {
            const calls = [];
            const target = {
                getModelIdentifier: () => model,
                miio: {
                    call: async (...args) => {
                        calls.push(args);
                        return 'called';
                    }
                }
            };

            if (supportedCommands[command]) {
                assert.equal(await listener({ device: target, command }), 'called');
                assert.deepEqual(calls, [['action', supportedCommands[command], { retries: 1 }]]);
            } else {
                await assert.rejects(listener({ device: target, command }), /not supported/);
                assert.deepEqual(calls, []);
            }
        }
    }

    for (const command of commands) {
        const unsupportedCalls = [];
        const unsupportedTarget = {
            getModelIdentifier: () => 'xiaomi.vacuum.d101gl',
            miio: { call: async (...args) => unsupportedCalls.push(args) }
        };
        await assert.rejects(listener({ device: unsupportedTarget, command }), /not supported/);
        assert.deepEqual(unsupportedCalls, []);
    }
    await assert.rejects(listener({ command: 'start_dust_collection' }), /target vacuum/);
    const malformedCalls = [];
    await assert.rejects(
        listener({
            device: {
                getModelIdentifier: () => 'xiaomi.vacuum.d102gl',
                miio: { call: async (...args) => malformedCalls.push(args) }
            },
            command: {}
        }),
        /not supported/
    );
    assert.deepEqual(malformedCalls, []);
    await assert.rejects(listener({ device: { getModelIdentifier: () => 'xiaomi.vacuum.d102gl' }, command: 'start_drying' }), /not connected/);
});

test('c102 station status normalizes known values, updates the capability before transitions, and preserves malformed state', async () => {
    const order = [];
    const flow = createFlow(order);
    const { device, errors } = createVacuumDevice('xiaomi.vacuum.c102gl', { flow });
    const updates = [];
    enableBaseStationCapability(device, updates, order);

    await device._observeX20StatusPoll(c102Result(8));
    assert.equal(device._x20BaseStationMode, 1);
    assert.equal(device._x20BaseStationModeName, 'Drying');
    assert.deepEqual(updates, ['Drying']);
    assert.deepEqual(flow.events, []);

    await device._observeX20StatusPoll(c102Result(9));
    assert.equal(device._x20BaseStationMode, 3);
    assert.equal(device._x20BaseStationModeName, 'Mop washing');
    assert.equal(flow.events.length, 1);
    assert.deepEqual(flow.events[0].state, { mode: 3 });
    assert.deepEqual(order.slice(-2), ['capability:Mop washing', 'trigger:x20_base_station_status_changed']);

    await device._observeX20StatusPoll(c102Result(9));
    assert.equal(flow.events.length, 1, 'an unchanged station mode must not trigger or overwrite the capability');
    assert.deepEqual(updates, ['Drying', 'Mop washing']);

    await device._observeX20StatusPoll(c102Result(22));
    assert.equal(device._x20BaseStationMode, 2);
    assert.equal(device._x20BaseStationModeName, 'Dust collection');
    assert.equal(flow.events.length, 2);

    const stableMode = device._x20BaseStationMode;
    const stableUpdates = updates.length;
    for (const value of [99, 8.5, 'not-a-number', null, undefined, true, {}]) {
        await device._observeX20StatusPoll(c102Result(value));
    }
    assert.equal(device._x20BaseStationMode, stableMode);
    assert.equal(updates.length, stableUpdates);
    assert.equal(flow.events.length, 2);
    assert.deepEqual(errors, []);

    const failing = createVacuumDevice('xiaomi.vacuum.c102gl');
    failing.device.hasCapability = (capability) => capability === BASE_STATION_STATUS_CAPABILITY;
    failing.device.setCapabilityValue = async () => {
        throw new Error('capability write failed');
    };
    await failing.device._observeX20StatusPoll(c102Result(8));
    await failing.device._observeX20StatusPoll(c102Result(9));
    assert.equal(failing.flow.events.length, 1, 'a capability failure must not suppress a real Flow transition');
    assert.ok(failing.errors.some((args) => args.join(' ').includes('capability write failed')));
});

test('c102 maps only explicitly known non-station device statuses to Idle', async () => {
    for (const statusCode of [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 19, 21, 23]) {
        const { device, flow } = createVacuumDevice('xiaomi.vacuum.c102gl');
        await device._observeX20StatusPoll(c102Result(statusCode));
        assert.equal(device._x20BaseStationMode, 0, `status ${statusCode} must normalize to Idle`);
        assert.equal(device._x20BaseStationModeName, 'Idle');
        assert.deepEqual(flow.events, []);
    }
});

test('PIID 18 status retains bounded legacy parsing and finite unknown-mode labels', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.ov51gl');
    await device._observeX20StatusPoll(baseStatusResult('{"mode":0}'));
    await device._observeX20StatusPoll(baseStatusResult(JSON.stringify(JSON.stringify({ mode: 99 }))));
    assert.equal(device._x20BaseStationMode, 99);
    assert.equal(device._x20BaseStationModeName, 'Mode 99');
    assert.equal(flow.events.length, 1);
    assert.equal(flow.events[0].tokens.base_status_name, 'Mode 99');

    await device._observeX20StatusPoll(baseStatusResult('{"mode":'));
    await device._observeX20StatusPoll(baseStatusResult('x'.repeat(4097)));
    assert.equal(device._x20BaseStationMode, 99);
    assert.equal(flow.events.length, 1);
});
