'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {} };
    return originalModuleLoad.call(this, request, parent, isMain);
};
const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
Module._load = originalModuleLoad;

function createRoomDevice({
    model = 'xiaomi.vacuum.d102gl',
    settingsRooms = [],
    storedAliases = {},
    liveRooms = [],
    readError = null,
    settingsError = null,
    storeError = null
} = {}) {
    const settings = {
        rooms: JSON.stringify(settingsRooms),
        rooms_display: settingsRooms.map((room) => room.name).join(', ')
    };
    let aliases = JSON.parse(JSON.stringify(storedAliases));
    const calls = [];
    const errors = [];
    const logs = [];

    const device = Object.create(VacuumDevice.prototype);
    device.log = (...args) => logs.push(args);
    device.error = (...args) => errors.push(args);
    device._model = model;
    device._applyModelProperties(model);
    device.getSetting = (key) => settings[key];
    device.getStoreValue = (key) => (key === 'roomIdAliases' ? aliases : undefined);
    device.setStoreValue = async (key, value) => {
        if (storeError) throw storeError;
        if (key === 'roomIdAliases') aliases = JSON.parse(JSON.stringify(value));
    };
    device.setSettings = async (update) => {
        if (settingsError) throw settingsError;
        Object.assign(settings, update);
    };
    device.callVacuumGetProperties = async (definition, options) => {
        calls.push({ definition, options });
        if (readError) throw readError;
        return [{
            ...definition[0],
            value: JSON.stringify({ rooms: liveRooms })
        }];
    };

    return {
        aliases: () => JSON.parse(JSON.stringify(aliases)),
        calls,
        device,
        errors,
        logs,
        settings
    };
}

test('persists stale numeric room semantics across repeated runs and app restarts', async () => {
    const first = createRoomDevice({
        settingsRooms: [{ id: 48, name: 'Hall' }],
        liveRooms: [{ id: 61, name: 'Hall' }]
    });
    const firstState = await first.device._getRoomCleaningState();
    assert.equal(first.device._resolveNumericRoomId(48, firstState.rooms, firstState.cachedRooms, firstState.aliases).id, 61);
    assert.deepEqual(first.aliases(), { 48: ['Hall'] });

    const second = createRoomDevice({
        settingsRooms: [{ id: 61, name: 'Hall' }],
        storedAliases: first.aliases(),
        liveRooms: [{ id: 61, name: 'Hall' }]
    });
    const secondState = await second.device._getRoomCleaningState();
    const secondResolution = second.device._resolveNumericRoomId(48, secondState.rooms, secondState.cachedRooms, secondState.aliases);
    assert.equal(secondResolution.id, 61);
    assert.equal(secondResolution.remapped, true);
    assert.deepEqual(second.aliases(), { 48: ['Hall'] });
});

test('uses valid live room data when persisting refreshed settings fails', async () => {
    const fixture = createRoomDevice({
        settingsRooms: [{ id: 48, name: 'Hall' }],
        liveRooms: [{ id: 61, name: 'Hall' }],
        settingsError: new Error('settings unavailable')
    });
    const state = await fixture.device._getRoomCleaningState();

    assert.equal(state.refreshed, true);
    assert.deepEqual(state.rooms, [{ id: 61, name: 'Hall' }]);
    assert.equal(fixture.device._resolveNumericRoomId(48, state.rooms, state.cachedRooms, state.aliases).id, 61);
    assert.ok(fixture.errors.some(([message]) => String(message).includes('Failed to persist refreshed room settings')));
});

test('preserves the old semantic cache if alias persistence fails', async () => {
    const fixture = createRoomDevice({
        settingsRooms: [{ id: 48, name: 'Hall' }],
        liveRooms: [{ id: 61, name: 'Hall' }],
        storeError: new Error('store unavailable')
    });
    const state = await fixture.device._getRoomCleaningState();

    assert.equal(state.refreshed, true);
    assert.deepEqual(state.rooms, [{ id: 61, name: 'Hall' }]);
    assert.equal(fixture.device._resolveNumericRoomId(48, state.rooms, state.cachedRooms, state.aliases).id, 61);
    assert.equal(fixture.settings.rooms, JSON.stringify([{ id: 48, name: 'Hall' }]));
    assert.ok(fixture.errors.some(([message]) => String(message).includes('Failed to persist room id aliases')));
    assert.ok(fixture.errors.some(([message]) => String(message).includes('Keeping previous room settings')));

    // Simulate an app restart with no alias store write having succeeded. The old
    // settings still retain 48 -> Hall, so the live map can safely remap it again.
    const restarted = createRoomDevice({
        settingsRooms: [{ id: 48, name: 'Hall' }],
        liveRooms: [{ id: 61, name: 'Hall' }],
        storeError: new Error('store unavailable')
    });
    const restartedState = await restarted.device._getRoomCleaningState();
    assert.equal(
        restarted.device._resolveNumericRoomId(48, restartedState.rooms, restartedState.cachedRooms, restartedState.aliases).id,
        61
    );
});

test('rejects a numeric room id once the same id has ambiguous historical meaning', async () => {
    const fixture = createRoomDevice({
        settingsRooms: [
            { id: 48, name: 'Kitchen' },
            { id: 61, name: 'Hall' }
        ],
        storedAliases: { 48: ['Hall'] },
        liveRooms: [
            { id: 48, name: 'Kitchen' },
            { id: 61, name: 'Hall' }
        ]
    });
    const state = await fixture.device._getRoomCleaningState();
    const resolution = fixture.device._resolveNumericRoomId(48, state.rooms, state.cachedRooms, state.aliases);

    assert.equal(resolution.id, null);
    assert.match(resolution.reason, /ambiguous/);
    assert.deepEqual(fixture.aliases(), { 48: ['Hall', 'Kitchen'] });
});

test('falls back to cached rooms and persisted aliases when live refresh fails', async () => {
    const fixture = createRoomDevice({
        settingsRooms: [{ id: 61, name: 'Hall' }],
        storedAliases: { 48: ['Hall'] },
        readError: new Error('room read timeout')
    });
    const state = await fixture.device._getRoomCleaningState();

    assert.equal(state.refreshed, false);
    assert.deepEqual(state.rooms, [{ id: 61, name: 'Hall' }]);
    assert.equal(fixture.device._resolveNumericRoomId(48, state.rooms, state.cachedRooms, state.aliases).id, 61);
    assert.ok(fixture.errors.some(([message]) => String(message).includes('room read timeout')));
});

test('pre-clean refresh routes through each model configured get_rooms descriptor', async () => {
    const cases = [
        ['xiaomi.vacuum.d109gl', 2, 16],
        ['xiaomi.vacuum.d102gl', 2, 16],
        ['xiaomi.vacuum.d101', 2, 16],
        ['xiaomi.vacuum.d101gl', 2, 16],
        ['xiaomi.vacuum.ov51gl', 2, 16],
        ['xiaomi.vacuum.ov71gl', 2, 16],
        ['xiaomi.vacuum.c102gl', 2, 16],
        ['xiaomi.vacuum.b108gl', 2, 13]
    ];

    for (const [model, siid, piid] of cases) {
        const fixture = createRoomDevice({
            model,
            settingsRooms: [{ id: 1, name: 'Room' }],
            liveRooms: [{ id: 1, name: 'Room' }]
        });
        await fixture.device._refreshRoomsBeforeCleaning();
        assert.equal(fixture.calls.length, 1, model);
        assert.deepEqual(fixture.calls[0].definition, [{ did: 'rooms', siid, piid }], model);
        assert.equal(fixture.calls[0].options.retries, 2, model);
    }

    const excluded = createRoomDevice({ model: 'xiaomi.vacuum.c108' });
    await assert.rejects(excluded.device._refreshRoomsBeforeCleaning(), /No configured room property/);
    assert.equal(excluded.calls.length, 0);
});
