'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') {
        return { Device: class Device {} };
    }
    if (request === '../wifi_device.js' && /vacuum_xiaomi_vacuum_max[\\/]device\.js$/.test(parent.filename)) {
        return class Device {};
    }
    return originalModuleLoad.call(this, request, parent, isMain);
};

const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
Module._load = originalModuleLoad;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function roomPayload(rooms) {
    return [{ value: JSON.stringify({ rooms }) }];
}

function createRoomDevice({
    model = 'xiaomi.vacuum.d102gl',
    responses = [],
    settings = {},
    store = {},
    setSettingsFailure = null,
    setStoreFailure = null
} = {}) {
    const calls = [];
    const errors = [];
    const logs = [];
    const settingsWrites = [];
    const storeWrites = [];
    const device = Object.create(VacuumDevice.prototype);

    device._model = model;
    device.getSetting = (key) => settings[key];
    device.setSettings = async (updates) => {
        settingsWrites.push(clone(updates));
        if (setSettingsFailure) throw setSettingsFailure;
        Object.assign(settings, clone(updates));
    };
    device.getStoreValue = (key) => clone(store[key]);
    device.setStoreValue = async (key, value) => {
        storeWrites.push({ key, value: clone(value) });
        if (setStoreFailure) throw setStoreFailure;
        store[key] = clone(value);
    };
    device.callVacuumGetProperties = async (definitions, options) => {
        calls.push({ definitions: clone(definitions), options: clone(options) });
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return clone(response);
    };
    device.error = (...args) => errors.push(args);
    device.log = (...args) => logs.push(args);
    device._applyModelProperties(model);

    return {
        calls,
        device,
        errors,
        logs,
        settings,
        settingsWrites,
        store,
        storeWrites
    };
}

test('refreshes each room-capable model through its configured room property first', async () => {
    const cases = [
        { model: 'xiaomi.vacuum.d102gl', expected: [{ did: 'rooms', siid: 2, piid: 16 }] },
        { model: 'xiaomi.vacuum.d109gl', expected: [{ did: 'rooms', siid: 2, piid: 16 }] },
        { model: 'xiaomi.vacuum.b108gl', expected: [{ did: 'rooms', siid: 2, piid: 13 }] }
    ];

    for (const { model, expected } of cases) {
        const subject = createRoomDevice({
            model,
            responses: [roomPayload([{ id: 11, name: 'Kitchen' }])]
        });

        const rooms = await subject.device._refreshRoomsBeforeCleaning();

        assert.deepEqual(rooms, [{ id: 11, name: 'Kitchen' }], model);
        assert.equal(subject.calls.length, 1, model);
        assert.deepEqual(subject.calls[0].definitions, expected, model);
    }

    const unsupported = createRoomDevice({ model: 'xiaomi.vacuum.c108' });
    assert.deepEqual(await unsupported.device._refreshRoomsBeforeCleaning(), []);
    assert.equal(unsupported.calls.length, 0);
});

test('keeps stale numeric room IDs resolvable across refreshes and a device restart', async () => {
    const settings = {
        rooms: JSON.stringify([{ id: 1, name: 'Kitchen' }]),
        rooms_display: 'Kitchen'
    };
    const store = {};
    const first = createRoomDevice({
        responses: [roomPayload([{ id: 2, name: 'Kitchen' }])],
        settings,
        store
    });
    const cachedBeforeFirstRefresh = first.device._getCachedRoomsForCleaning();
    const roomsAfterFirstRefresh = await first.device._refreshRoomsBeforeCleaning();

    assert.deepEqual(
        first.device._resolveRoomIdsForCleaning('1', roomsAfterFirstRefresh, cachedBeforeFirstRefresh),
        [2]
    );
    assert.deepEqual(store.room_id_name_aliases, {
        version: 1,
        aliases: [
            { id: 1, name: 'Kitchen' },
            { id: 2, name: 'Kitchen' }
        ]
    });

    first.device.callVacuumGetProperties = async () => roomPayload([{ id: 3, name: 'Kitchen' }]);
    const cachedBeforeSecondRefresh = first.device._getCachedRoomsForCleaning();
    const roomsAfterSecondRefresh = await first.device._refreshRoomsBeforeCleaning();

    assert.deepEqual(
        first.device._resolveRoomIdsForCleaning('1,2', roomsAfterSecondRefresh, cachedBeforeSecondRefresh),
        [3]
    );

    const restarted = createRoomDevice({
        responses: [roomPayload([{ id: 4, name: 'Kitchen' }])],
        settings,
        store
    });
    const cachedBeforeRestartRefresh = restarted.device._getCachedRoomsForCleaning();
    const roomsAfterRestartRefresh = await restarted.device._refreshRoomsBeforeCleaning();

    assert.deepEqual(
        restarted.device._resolveRoomIdsForCleaning(
            '1,2,3',
            roomsAfterRestartRefresh,
            cachedBeforeRestartRefresh
        ),
        [4]
    );
    assert.deepEqual(store.room_id_name_aliases.aliases, [
        { id: 1, name: 'Kitchen' },
        { id: 2, name: 'Kitchen' },
        { id: 3, name: 'Kitchen' },
        { id: 4, name: 'Kitchen' }
    ]);
});

test('rejects reused IDs and duplicate names while retaining explicit unique names', () => {
    const subject = createRoomDevice({
        store: {
            room_id_name_aliases: {
                version: 1,
                aliases: [{ id: 7, name: 'Kitchen' }]
            }
        }
    });
    const reusedCurrentRooms = subject.device._parseRoomsPayload(
        JSON.stringify({
            rooms: [
                { id: 7, name: 'Office' },
                { id: 8, name: 'Kitchen' }
            ]
        })
    );

    assert.deepEqual(
        subject.device._resolveRoomIdsForCleaning('7', reusedCurrentRooms, []),
        []
    );
    assert.deepEqual(
        subject.device._resolveRoomIdsForCleaning('Kitchen,8,Kitchen', reusedCurrentRooms, []),
        [8]
    );

    const duplicateNameRooms = subject.device._parseRoomsPayload(
        JSON.stringify({
            rooms: [
                { id: 9, name: 'Kitchen' },
                { id: 10, name: 'Kitchen' }
            ]
        })
    );
    assert.deepEqual(
        subject.device._resolveRoomIdsForCleaning('7,Kitchen', duplicateNameRooms, []),
        []
    );
});

test('retains cached rooms after alias persistence fails while the current action uses fresh rooms', async () => {
    const secretStoreError = new Error('token=not-for-logs');
    const settings = {
        rooms: JSON.stringify([{ id: 21, name: 'Kitchen' }]),
        rooms_display: 'Kitchen'
    };
    const store = {};
    const subject = createRoomDevice({
        responses: [
            roomPayload([{ id: 22, name: 'Kitchen' }]),
            roomPayload([{ id: 22, name: 'Kitchen' }])
        ],
        settings,
        store,
        setStoreFailure: secretStoreError
    });
    const firstSelection = await subject.device._resolveAdvancedRoomCleaningSelection('21');
    const secondSelection = await subject.device._resolveAdvancedRoomCleaningSelection('21');

    assert.deepEqual(firstSelection.rooms, [{ id: 22, name: 'Kitchen' }]);
    assert.deepEqual(firstSelection.selectedIds, [22]);
    assert.deepEqual(secondSelection.rooms, [{ id: 22, name: 'Kitchen' }]);
    assert.deepEqual(secondSelection.selectedIds, [22]);
    assert.equal(subject.calls.length, 2);
    assert.equal(settings.rooms, JSON.stringify([{ id: 21, name: 'Kitchen' }]));
    assert.equal(settings.rooms_display, 'Kitchen');
    assert.equal(subject.settingsWrites.length, 0);
    assert.equal(subject.storeWrites.length, 2);
    assert.equal(store.room_id_name_aliases, undefined);
    const errorText = subject.errors.flat().join(' ');
    assert.match(errorText, /Failed to persist room-name aliases/);
    assert.match(errorText, /Skipped persisting refreshed room map/);
    assert.doesNotMatch(errorText, /not-for-logs/);

    const restarted = createRoomDevice({
        responses: [roomPayload([{ id: 22, name: 'Kitchen' }])],
        settings,
        store
    });
    const restartedSelection = await restarted.device._resolveAdvancedRoomCleaningSelection('21');

    assert.deepEqual(restartedSelection.rooms, [{ id: 22, name: 'Kitchen' }]);
    assert.deepEqual(restartedSelection.selectedIds, [22]);
    assert.deepEqual(store.room_id_name_aliases, {
        version: 1,
        aliases: [
            { id: 21, name: 'Kitchen' },
            { id: 22, name: 'Kitchen' }
        ]
    });
});

test('uses fresh rooms when settings persistence fails after aliases persist', async () => {
    const secretSettingsError = new Error('cookie=not-for-logs');
    const settings = {
        rooms: JSON.stringify([{ id: 21, name: 'Kitchen' }]),
        rooms_display: 'Kitchen'
    };
    const store = {};
    const subject = createRoomDevice({
        responses: [roomPayload([{ id: 22, name: 'Kitchen' }])],
        settings,
        store,
        setSettingsFailure: secretSettingsError
    });
    const selection = await subject.device._resolveAdvancedRoomCleaningSelection('21');

    assert.deepEqual(selection.rooms, [{ id: 22, name: 'Kitchen' }]);
    assert.equal(subject.calls.length, 1);
    assert.deepEqual(selection.selectedIds, [22]);
    assert.equal(subject.settingsWrites.length, 1);
    assert.deepEqual(store.room_id_name_aliases, {
        version: 1,
        aliases: [
            { id: 21, name: 'Kitchen' },
            { id: 22, name: 'Kitchen' }
        ]
    });
    const errorText = subject.errors.flat().join(' ');
    assert.match(errorText, /Failed to persist refreshed room map/);
    assert.doesNotMatch(errorText, /not-for-logs/);
});

test('falls back through known room properties and never resolves unknown numeric IDs', async () => {
    const subject = createRoomDevice({
        responses: [
            [{ value: '[]' }],
            roomPayload([{ id: 31, name: 'Hall' }])
        ]
    });

    const rooms = await subject.device._refreshRoomsBeforeCleaning();

    assert.deepEqual(rooms, [{ id: 31, name: 'Hall' }]);
    assert.equal(subject.calls.length, 2);
    assert.deepEqual(subject.calls[0].definitions, [{ did: 'rooms', siid: 2, piid: 16 }]);
    assert.deepEqual(subject.calls[1].definitions, [{ did: 'rooms', siid: 4, piid: 20 }]);

    const cachedRooms = subject.device._parseRoomsSetting(
        JSON.stringify([{ id: 31, name: 'Hall' }])
    );
    assert.deepEqual(subject.device._resolveRoomIdsForCleaning('31,999,0', cachedRooms, cachedRooms), [31]);
});

test('selection falls back to cached rooms when every live room read fails or cannot parse', async () => {
    const subject = createRoomDevice({
        settings: {
            rooms: JSON.stringify([{ id: 41, name: 'Hall' }]),
            rooms_display: 'Hall'
        },
        responses: [
            new Error('network read failed'),
            [{ value: 'not-json' }],
            [{ value: '[]' }],
            new Error('token=not-for-logs')
        ]
    });

    const selection = await subject.device._resolveAdvancedRoomCleaningSelection('41,999');

    assert.deepEqual(selection.rooms, [{ id: 41, name: 'Hall' }]);
    assert.deepEqual(selection.selectedIds, [41]);
    assert.equal(subject.calls.length, 4);
    assert.deepEqual(subject.calls.map((call) => call.definitions), [
        [{ did: 'rooms', siid: 2, piid: 16 }],
        [{ did: 'rooms', siid: 4, piid: 20 }],
        [{ did: 'rooms', siid: 6, piid: 15 }],
        [{ did: 'rooms', siid: 7, piid: 3 }]
    ]);
    const errorText = subject.errors.flat().join(' ');
    assert.match(errorText, /Refresh before room clean failed/);
    assert.doesNotMatch(errorText, /not-for-logs/);
});

test('bounds semantic aliases and excludes malformed room data', async () => {
    const subject = createRoomDevice();
    const rooms = Array.from({ length: 65 }, (_, index) => ({
        id: index + 1,
        name: 'Room-' + (index + 1)
    }));

    await subject.device._persistRoomAliases(rooms, [
        { id: 66 },
        { id: 0, name: 'Invalid' },
        { id: 67.5, name: 'Invalid' }
    ]);

    assert.equal(subject.store.room_id_name_aliases.version, 1);
    assert.equal(subject.store.room_id_name_aliases.aliases.length, 64);
    assert.deepEqual(subject.store.room_id_name_aliases.aliases[0], { id: 2, name: 'Room-2' });
    assert.deepEqual(subject.store.room_id_name_aliases.aliases.at(-1), { id: 65, name: 'Room-65' });
    assert.equal(
        subject.store.room_id_name_aliases.aliases.some((alias) => alias.id === 66),
        false
    );
});
