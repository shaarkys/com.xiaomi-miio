'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') {
        return { Device: class Device {} };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
};

const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
Module._load = originalModuleLoad;

function createFlow() {
    const events = [];
    const triggerListeners = {};
    const conditionListeners = {};
    const triggerCards = new Map();
    const conditionCards = new Map();
    const getTriggerCard = (id) => {
        if (!triggerCards.has(id)) {
            triggerCards.set(id, {
                registerRunListener: (listener) => {
                    triggerListeners[id] = listener;
                },
                trigger: async (device, tokens, state) => {
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
    return {
        conditionListeners,
        events,
        flow: { getConditionCard, getDeviceTriggerCard: getTriggerCard },
        triggerListeners
    };
}

function createVacuumDevice(model, { flow = createFlow() } = {}) {
    const errors = [];
    const device = Object.create(VacuumDevice.prototype);
    device._model = model;
    device.homey = { flow: flow.flow };
    device.error = (...args) => errors.push(args);
    device.log = () => {};
    device._applyModelProperties(model);
    return { device, errors, flow };
}

function rawResult(code) {
    return [{ siid: 2, piid: 2, value: code }];
}

function baseResult(value) {
    return [{ siid: 2, piid: 18, value }];
}

test('adds the PIID 18 base-station property only to isolated supported per-device clones', () => {
    const pro = createVacuumDevice('xiaomi.vacuum.d102gl').device;
    const max = createVacuumDevice('xiaomi.vacuum.d109gl').device;
    const h40 = createVacuumDevice('xiaomi.vacuum.ov51gl').device;
    const c102 = createVacuumDevice('xiaomi.vacuum.c102gl').device;
    const d101 = createVacuumDevice('xiaomi.vacuum.d101').device;
    const d101gl = createVacuumDevice('xiaomi.vacuum.d101gl').device;
    const ov71 = createVacuumDevice('xiaomi.vacuum.ov71gl').device;

    for (const device of [pro, max, h40]) {
        assert.equal(device.deviceProperties.get_properties.filter((property) => property.did === 'base_station_working_status').length, 1);
    }
    assert.notEqual(pro.deviceProperties.get_properties, max.deviceProperties.get_properties);
    assert.notEqual(max.deviceProperties.get_properties, h40.deviceProperties.get_properties);
    assert.notEqual(h40.deviceProperties.get_properties, d101.deviceProperties.get_properties);
    assert.ok(pro.deviceProperties.get_properties.some((property) => property.did === 'water_check_status'));
    assert.ok(pro.deviceProperties.get_properties.some((property) => property.did === 'fault_ids'));
    assert.ok(max.deviceProperties.get_properties.some((property) => property.did === 'water_check_status' && property.siid === 2 && property.piid === 54));
    assert.ok(max.deviceProperties.get_properties.some((property) => property.did === 'fault_ids' && property.siid === 2 && property.piid === 66));
    assert.ok(!h40.deviceProperties.get_properties.some((property) => property.did === 'water_check_status'));
    assert.ok(!h40.deviceProperties.get_properties.some((property) => property.did === 'fault_ids'));
    for (const device of [c102, d101, d101gl, ov71]) {
        assert.ok(!device.deviceProperties.get_properties.some((property) => property.did === 'base_station_working_status'));
        assert.ok(!device.deviceProperties.get_properties.some((property) => property.did === 'water_check_status'));
        assert.ok(!device.deviceProperties.get_properties.some((property) => property.did === 'fault_ids'));
    }
});

test('raw X20 status initializes without a trigger, then emits one transition with code/name tokens', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.d102gl');

    await device._observeX20StatusPoll(rawResult(1));
    assert.equal(flow.events.length, 0);
    assert.equal(device._x20RawStatusCode, 1);
    assert.equal(device._x20RawStatusName, 'Standby');

    await device._observeX20StatusPoll(rawResult(4));
    assert.equal(flow.events.length, 1);
    assert.deepEqual(flow.events[0].state, { status: 4 });
    assert.deepEqual(flow.events[0].tokens, {
        status_code: 4,
        status_name: 'Working',
        previous_status_code: 1,
        previous_status_name: 'Standby'
    });

    await device._observeX20StatusPoll(rawResult(4));
    assert.equal(flow.events.length, 1, 'unchanged raw status must not retrigger');

    await device._observeX20StatusPoll(rawResult(99));
    assert.equal(flow.events.length, 2);
    assert.equal(flow.events[1].tokens.status_name, 'Status 99');
    assert.equal(flow.events[1].tokens.previous_status_name, 'Working');
});

test('raw X20 Max status uses the same first-observation and transition behavior', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.d109gl');

    await device._observeX20StatusPoll(rawResult(1));
    assert.equal(flow.events.length, 0);
    assert.equal(device._x20RawStatusCode, 1);

    await device._observeX20StatusPoll(rawResult(4));
    assert.equal(flow.events.length, 1);
    assert.deepEqual(flow.events[0].state, { status: 4 });
    assert.equal(flow.events[0].tokens.status_name, 'Working');
    assert.equal(flow.events[0].tokens.previous_status_code, 1);
});

test('raw X20 status conditions reject guards and match current finite state', async () => {
    const { device } = createVacuumDevice('xiaomi.vacuum.d102gl');

    assert.equal(device._x20RawStatusIs(null), false);
    assert.equal(device._x20RawStatusIs('not-a-number'), false);
    assert.equal(device._x20RawStatusIs('1'), false, 'uninitialized current status must not match');
    await device._observeX20StatusPoll(rawResult(1));
    assert.equal(device._x20RawStatusIs('1'), true);
    assert.equal(device._x20RawStatusIs(2), false);
    assert.equal(device._x20RawStatusIs(Infinity), false);

    const max = createVacuumDevice('xiaomi.vacuum.d109gl').device;
    max._x20RawStatusCode = 1;
    assert.equal(max._x20RawStatusIs(1), true);
    const sibling = createVacuumDevice('xiaomi.vacuum.c102gl').device;
    sibling._x20RawStatusCode = 1;
    assert.equal(sibling._x20RawStatusIs(1), false);
    assert.equal(VacuumDevice.prototype._x20RawStatusIs.call({}, 1), false);
});

test('base-station mode parses object, JSON string, and double-encoded JSON string transitions', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.d102gl');

    await device._observeX20StatusPoll(baseResult({ mode: 0 }));
    assert.equal(flow.events.length, 0);
    assert.equal(device._x20BaseStationMode, 0);
    assert.equal(device._x20BaseStationModeName, 'Idle');

    await device._observeX20StatusPoll(baseResult('{"mode":1}'));
    assert.equal(flow.events.length, 1);
    assert.deepEqual(flow.events[0].state, { mode: 1 });
    assert.deepEqual(flow.events[0].tokens, {
        base_status_code: 1,
        base_status_name: 'Drying',
        previous_base_status_code: 0,
        previous_base_status_name: 'Idle'
    });

    await device._observeX20StatusPoll(baseResult(JSON.stringify(JSON.stringify({ mode: 2 }))));
    assert.equal(flow.events.length, 2);
    assert.equal(flow.events[1].tokens.base_status_name, 'Dust collection');
    assert.equal(flow.events[1].tokens.previous_base_status_name, 'Drying');

    await device._observeX20StatusPoll(baseResult({ mode: 99 }));
    assert.equal(flow.events.length, 3);
    assert.equal(flow.events[2].tokens.base_status_name, 'Mode 99');
});

test('X20 Max base-station mode observes PIID 18 and emits transitions', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.d109gl');

    await device._observeX20StatusPoll(baseResult({ mode: 0 }));
    assert.equal(flow.events.length, 0);
    assert.equal(device._x20BaseStationMode, 0);

    await device._observeX20StatusPoll(baseResult({ mode: 1 }));
    assert.equal(flow.events.length, 1);
    assert.deepEqual(flow.events[0].state, { mode: 1 });
    assert.equal(flow.events[0].tokens.base_status_name, 'Drying');
    assert.equal(flow.events[0].tokens.previous_base_status_code, 0);
});

test('malformed base-station values preserve the last valid mode and do not trigger', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.d102gl');

    await device._observeX20StatusPoll(baseResult({ mode: 2 }));
    await device._observeX20StatusPoll(baseResult('{"mode":null}'));
    await device._observeX20StatusPoll(baseResult('not-json'));
    await device._observeX20StatusPoll(baseResult(JSON.stringify({ mode: Infinity })));
    assert.equal(device._x20BaseStationMode, 2);
    assert.equal(device._x20BaseStationModeName, 'Dust collection');
    assert.equal(flow.events.length, 0);

    await device._observeX20StatusPoll(baseResult({ mode: 2 }));
    assert.equal(flow.events.length, 0, 'same valid mode after malformed data must not retrigger');
});

test('base-station condition does not coerce null to mode zero', async () => {
    const { device } = createVacuumDevice('xiaomi.vacuum.d102gl');

    assert.equal(device._x20BaseStationStatusIs(null), false);
    assert.equal(device._x20BaseStationStatusIs(0), false);
    await device._observeX20StatusPoll(baseResult({ mode: 0 }));
    assert.equal(device._x20BaseStationStatusIs(0), true);
    assert.equal(device._x20BaseStationStatusIs('0'), true);
    assert.equal(device._x20BaseStationStatusIs(NaN), false);

    const max = createVacuumDevice('xiaomi.vacuum.d109gl').device;
    await max._observeX20StatusPoll(baseResult({ mode: 0 }));
    assert.equal(max._x20BaseStationStatusIs('0'), true);
});

test('models outside the raw and base-station status sets do not track or trigger statuses', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.d101gl');

    await device._observeX20StatusPoll([...rawResult(1), ...baseResult({ mode: 1 })]);
    assert.equal(flow.events.length, 0);
    assert.equal(device._x20RawStatusCode, undefined);
    assert.equal(device._x20BaseStationMode, undefined);
});

test('X20 trigger listeners compare finite selected dropdown values to trigger state', async () => {
    const { device, flow } = createVacuumDevice('xiaomi.vacuum.d102gl');
    device._registerX20FlowListeners();

    assert.equal(await flow.triggerListeners.x20_raw_status_changed({ device, status: '4' }, { status: 4 }), true);
    assert.equal(await flow.triggerListeners.x20_raw_status_changed({}, { status: 4 }), false);
    assert.equal(await flow.triggerListeners.x20_raw_status_changed({ status: null }, { status: 0 }), false);
    assert.equal(await flow.triggerListeners.x20_base_station_status_changed({ device, mode: '0' }, { mode: 0 }), true);
    assert.equal(await flow.triggerListeners.x20_base_station_status_changed({}, { mode: 0 }), false);
    assert.equal(await flow.triggerListeners.x20_base_station_status_changed({ mode: 'not-finite' }, { mode: 0 }), false);

    const max = createVacuumDevice('xiaomi.vacuum.d109gl');
    max.device._x20RawStatusCode = 4;
    max.device._x20BaseStationMode = 0;
    max.device._registerX20FlowListeners();
    assert.equal(await max.flow.triggerListeners.x20_raw_status_changed({ device: max.device, status: '4' }, { status: 4 }), true);
    assert.equal(await max.flow.triggerListeners.x20_base_station_status_changed({ device: max.device, mode: '0' }, { mode: 0 }), true);
    assert.equal(await max.flow.conditionListeners.x20_raw_status_is({ device: max.device, status: '4' }), true);
    assert.equal(await max.flow.conditionListeners.x20_base_station_status_is({ device: max.device, mode: '0' }), true);

    const sibling = createVacuumDevice('xiaomi.vacuum.c102gl');
    sibling.device._registerX20FlowListeners();
    assert.equal(await sibling.flow.triggerListeners.x20_raw_status_changed({ device: sibling.device, status: '4' }, { status: 4 }), false);
    assert.equal(await sibling.flow.conditionListeners.x20_raw_status_is({ device: sibling.device, status: '4' }), false);
    sibling.device._x20BaseStationMode = 0;
    assert.equal(await sibling.flow.triggerListeners.x20_base_station_status_changed({ device: sibling.device, mode: '0' }, { mode: 0 }), true);
    assert.equal(await sibling.flow.conditionListeners.x20_base_station_status_is({ device: sibling.device, mode: '0' }), true);

    const h40 = createVacuumDevice('xiaomi.vacuum.ov51gl');
    h40.device._registerX20FlowListeners();
    assert.equal(await h40.flow.triggerListeners.x20_raw_status_changed({ device: h40.device, status: '4' }, { status: 4 }), false);
    h40.device._x20BaseStationMode = 0;
    assert.equal(await h40.flow.triggerListeners.x20_base_station_status_changed({ device: h40.device, mode: '0' }, { mode: 0 }), true);

    const unknown = createVacuumDevice(undefined);
    unknown.device._registerX20FlowListeners();
    assert.equal(typeof unknown.flow.triggerListeners.x20_raw_status_changed, 'function');
    assert.equal(typeof unknown.flow.triggerListeners.x20_base_station_status_changed, 'function');
    assert.equal(typeof unknown.flow.conditionListeners.x20_raw_status_is, 'function');
    assert.equal(typeof unknown.flow.conditionListeners.x20_base_station_status_is, 'function');
    assert.equal(await unknown.flow.triggerListeners.x20_raw_status_changed({ device: unknown.device, status: '4' }, { status: 4 }), false);
});
