'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

function createVacuumDevice(model) {
    const device = Object.create(VacuumDevice.prototype);
    device._resetX20StatusTracking = () => {};
    device._applyModelProperties(model);
    return device;
}

function createAdvancedCleaningDevice(model, events) {
    const device = createVacuumDevice(model);
    device._resolveAdvancedRoomCleaningSelection = async () => ({
        rooms: [
            { id: 5, name: 'Kitchen' },
            { id: 7, name: 'Living room' }
        ],
        selectedIds: [5, 7]
    });
    device.buildCarpetModeSetPayload = () => [];
    device.log = () => {};
    device.callVacuumSetProperties = async (properties, options) => {
        events.push({ type: 'set', properties, options });
        return true;
    };
    device.miio = {
        call: async (method, action, options) => {
            events.push({ type: method, action, options });
            return { code: 0 };
        }
    };
    return device;
}

function registerAdvancedCleaningListeners() {
    const listeners = new Map();
    const registeringDevice = Object.create(VacuumDevice.prototype);
    registeringDevice.homey = {
        flow: {
            getActionCard: (cardId) => ({
                registerRunListener: (listener) => listeners.set(cardId, listener)
            })
        }
    };
    registeringDevice._registerAdvancedRoomCleaningFlowListeners();
    return listeners;
}

function createFlowArgs(device, overrides = {}) {
    return {
        device,
        mode: '1',
        accuracy: '2',
        mode_sweep: '3',
        mode_mop: '1',
        room: 'Kitchen,Living room',
        times: '2',
        ...overrides
    };
}

test('builds the model-specific Clean Times property for compatible vacuums', () => {
    const compatibleModels = [
        ['xiaomi.vacuum.d109gl', 8],
        ['xiaomi.vacuum.d102gl', 8],
        ['xiaomi.vacuum.d101', 8],
        ['xiaomi.vacuum.d101gl', 8],
        ['xiaomi.vacuum.ov51gl', 8],
        ['xiaomi.vacuum.ov71gl', 8],
        ['xiaomi.vacuum.b108gl', 7]
    ];

    for (const [model, piid] of compatibleModels) {
        const device = createVacuumDevice(model);

        assert.deepEqual(device._buildCleanTimesProperty('1'), { siid: 2, piid, value: 1 }, model);
        assert.deepEqual(device._buildCleanTimesProperty(2), { siid: 2, piid, value: 2 }, model);
    }
});

test('rejects Clean Times on models without the MIoT property', () => {
    for (const model of ['xiaomi.vacuum.c102gl', 'xiaomi.vacuum.c108']) {
        const device = createVacuumDevice(model);

        assert.throws(() => device._buildCleanTimesProperty(1), /not supported/, model);
    }
});

test('accepts only the Once and Twice values exposed by the Flow card', () => {
    const device = createVacuumDevice('xiaomi.vacuum.d109gl');

    for (const value of [undefined, null, 0, 1.5, 3, 'invalid']) {
        assert.throws(() => device._buildCleanTimesProperty(value), /Once \(1\) or Twice \(2\)/, String(value));
    }
});

test('keeps the published Flow card intact and adds a replacement with Times', () => {
    const root = path.join(__dirname, '..');
    const driverFlow = JSON.parse(fs.readFileSync(path.join(root, 'drivers/vacuum_xiaomi_vacuum_max/driver.flow.compose.json'), 'utf8'));
    const replacement = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/drivers/flow/actions/advanced_room_cleaning_times.json'), 'utf8'));
    const legacy = driverFlow.actions.find((action) => action.id === 'advanced_room_cleaning');

    assert.ok(legacy);
    assert.equal(legacy.deprecated, true);
    assert.deepEqual(legacy.args.map((argument) => argument.name), [
        'mode',
        'accuracy',
        'mode_sweep',
        'mode_mop',
        'carpet_avoidance',
        'room'
    ]);

    assert.equal(replacement.id, 'advanced_room_cleaning_times');
    assert.deepEqual(replacement.args.map((argument) => argument.name), [
        'mode',
        'accuracy',
        'mode_sweep',
        'mode_mop',
        'carpet_avoidance',
        'times',
        'room'
    ]);
    assert.deepEqual(
        replacement.args.find((argument) => argument.name === 'times').values.map((value) => [value.id, value.label.en]),
        [
            ['1', 'Once'],
            ['2', 'Twice']
        ]
    );
    assert.ok(driverFlow.actions.some((action) => Array.isArray(action.$extends) && action.$extends.includes('advanced_room_cleaning_times')));
});

test('legacy listener preserves its property writes without Clean Times', async () => {
    const events = [];
    const device = createAdvancedCleaningDevice('xiaomi.vacuum.d109gl', events);
    const listener = registerAdvancedCleaningListeners().get('advanced_room_cleaning');

    await listener(createFlowArgs(device));

    assert.deepEqual(events.map((event) => event.type), ['set', 'action']);
    assert.ok(!events[0].properties.some((property) => property.siid === 2 && property.piid === 8));
    assert.deepEqual(events[1].action, {
        siid: 2,
        aiid: 16,
        in: [{ siid: 2, piid: 15, code: 0, value: '5,7' }]
    });
});

test('Times-aware listener uses only the selected device mapping and writes before the action', async () => {
    const events = [];
    const selectedDevice = createAdvancedCleaningDevice('xiaomi.vacuum.b108gl', events);
    const listener = registerAdvancedCleaningListeners().get('advanced_room_cleaning_times');

    await listener(createFlowArgs(selectedDevice));

    assert.deepEqual(events.map((event) => event.type), ['set', 'action']);
    assert.deepEqual(events[0].properties[0], { siid: 2, piid: 7, value: 2 });
    assert.deepEqual(events[0].options, { retries: 2 });
    assert.deepEqual(events[1], {
        type: 'action',
        action: {
            siid: 2,
            aiid: 13,
            in: [{ siid: 2, piid: 13, code: 0, value: '5,7' }]
        },
        options: { retries: 3 }
    });
});

test('Times-aware listener rejects unsupported and unknown models before room resolution or I/O', async () => {
    const listener = registerAdvancedCleaningListeners().get('advanced_room_cleaning_times');

    for (const model of ['xiaomi.vacuum.c102gl', 'unknown.vacuum.model']) {
        const events = [];
        const device = createAdvancedCleaningDevice(model, events);
        let roomResolutionCalls = 0;
        device._resolveAdvancedRoomCleaningSelection = async () => {
            roomResolutionCalls += 1;
            return { rooms: [], selectedIds: [] };
        };

        await assert.rejects(listener(createFlowArgs(device)), /not supported/, model);
        assert.equal(roomResolutionCalls, 0, model);
        assert.deepEqual(events, [], model);
    }
});
