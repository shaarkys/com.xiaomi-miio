'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { parseMapId, propertyValue, parseMapCatalog } = require('../lib/saved-vacuum-maps.js');

const originalLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {} };
    return originalLoad.call(this, request, parent, isMain);
};
const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
Module._load = originalLoad;

function createDevice({ model = 'xiaomi.vacuum.d102gl', current = 0, markedCurrent = current, maps = [{ map_id: 0, map_name: 'Downstairs', is_current: true }, { map_id: 123, map_name: 'Upstairs' }], store = new Map(), actionHandler } = {}) {
    const calls = [];
    const logs = [];
    const device = Object.create(VacuumDevice.prototype);
    device._model = model;
    device.deviceProperties = { supports: { rooms: true }, set_properties: { room_clean_action: { siid: 2, aiid: 16, piid: 15 } } };
    device.homey = { setTimeout: (callback) => { queueMicrotask(callback); return 1; } };
    device.getStoreValue = (key) => store.get(key);
    device.setStoreValue = async (key, value) => { store.set(key, structuredClone(value)); };
    device.getSetting = (key) => key === 'enable_saved_map_switch_diagnostic' ? true : '[]';
    device.setSettings = async () => {};
    device.log = (message) => logs.push(String(message));
    device.error = (message) => logs.push(String(message));
    device._refreshRoomsBeforeCleaning = async ({ mapId } = {}) => {
        const rooms = [{ id: 7, name: mapId === 123 ? 'Office' : 'Kitchen' }];
        if (mapId !== null && mapId !== undefined) await device._cacheSavedMapRooms(mapId, rooms);
        return rooms;
    };
    device.miio = { call: async (method, payload, options) => {
        calls.push({ method, payload: structuredClone(payload), options });
        if (method === 'get_properties') {
            const { did, siid, piid } = payload[0];
            let value;
            if (siid === 10 && piid === 5) value = JSON.stringify({ map_array: maps.map((entry) => ({ ...entry, is_current: entry.map_id === markedCurrent })) });
            else if (siid === 10 && piid === 6) value = current;
            else if (siid === 10 && piid === 10) value = 0;
            else if (siid === 2 && piid === 2) value = 9;
            else throw new Error('Unexpected property');
            return [{ did, siid, piid, code: 0, value }];
        }
        if (method === 'action' && payload.siid === 10) {
            if (actionHandler) return actionHandler({ payload, setCurrent: (id) => { current = id; markedCurrent = id; }, device });
            current = payload.in[0].value;
            markedCurrent = current;
            return { code: 0 };
        }
        return { code: 0 };
    } };
    device._getDeviceModel = () => model;
    return { device, calls, logs, store, current: () => current };
}

test('map catalog keeps uint32 zero and names while discarding object URLs', () => {
    const raw = JSON.stringify({ map_array: [{ map_id: 0, map_name: '', is_current: true, obj_name: 'secret/url' }, { map_id: 4294967295, map_name: ' Upstairs ' }] });
    assert.deepEqual(parseMapCatalog(raw, 0), { currentId: 0, currentInCatalog: true, markedCurrentId: 0, maps: [{ id: 0, name: 'Map 0', isCurrent: true }, { id: 4294967295, name: 'Upstairs', isCurrent: false }] });
    assert.deepEqual(parseMapCatalog({ map_array: [{ map_id: 7, is_current: true }] }, 7).maps, [{ id: 7, name: 'Map 7', isCurrent: true }]);
    assert.deepEqual(parseMapCatalog({ map_array: [] }, 0), { currentId: 0, currentInCatalog: false, markedCurrentId: null, maps: [] });
    assert.equal(parseMapId('0'), 0);
    assert.equal(parseMapId('4294967295'), 4294967295);
    for (const bad of ['01', '-1', '4294967296', 1.5, null]) assert.equal(parseMapId(bad), null);
});

test('malformed and duplicate map data fail closed', () => {
    for (const value of ['oops', {}, { map_array: [{ map_id: 1 }, { map_id: 1 }] }, { map_array: [{ map_id: 1, is_current: true }, { map_id: 2, is_current: true }] }]) {
        assert.throws(() => parseMapCatalog(value, 2));
    }
    assert.throws(() => propertyValue([{ siid: 10, piid: 5, code: -1 }], 10, 5));
});

test('read-only catalog discovery reports current-map disagreements without exposing object URLs', async () => {
    const run = createDevice({ current: 0, markedCurrent: 123, maps: [{ map_id: 123, map_name: 'Upstairs', obj_name: 'secret/url' }] });
    const catalog = await run.device.discoverSavedVacuumMaps();
    assert.equal(catalog.currentId, 0);
    assert.equal(catalog.currentInCatalog, false);
    assert.equal(catalog.markedCurrentId, 123);
    assert.equal(run.logs.some((line) => line.includes('reported current 0; catalog current 123; current in catalog false')), true);
    assert.equal(run.logs.some((line) => line.includes('secret/url')), false);
    await assert.rejects(run.device.selectSavedVacuumMap('123'), /no map command was sent/);
    assert.equal(run.calls.some(({ method }) => method === 'action'), false);
    const conflicting = createDevice({ current: 0, markedCurrent: 123 });
    const conflictCatalog = await conflicting.device.discoverSavedVacuumMaps();
    assert.equal(conflictCatalog.currentInCatalog, true);
    assert.equal(conflictCatalog.markedCurrentId, 123);
    await assert.rejects(conflicting.device.selectSavedVacuumMap('123'), /no map command was sent/);
    assert.equal(conflicting.calls.some(({ method }) => method === 'action'), false);
});

test('read-only discovery uses individual properties and rejects unsupported models', async () => {
    const { device, calls, logs } = createDevice();
    const result = await device.discoverSavedVacuumMaps();
    assert.equal(result.currentId, 0);
    assert.deepEqual(calls.map(({ method, payload }) => [method, payload[0].siid, payload[0].piid]), [['get_properties', 10, 5], ['get_properties', 10, 6]]);
    assert.equal(logs.some((line) => line.includes('secret/url')), false);
    const max = createDevice({ model: 'xiaomi.vacuum.d109gl' });
    assert.equal((await max.device.discoverSavedVacuumMaps()).maps.length, 2);
    const x20 = createDevice({ model: 'xiaomi.vacuum.c102gl' });
    await assert.rejects(x20.device.discoverSavedVacuumMaps(), /not supported/);
    assert.equal(x20.calls.length, 0);
});

test('switch uses exactly one set-map action, confirms map and refreshes active rooms', async () => {
    const { device, calls, store } = createDevice();
    assert.equal(await device.selectSavedVacuumMap('123'), true);
    const actions = calls.filter(({ method }) => method === 'action');
    assert.deepEqual(actions, [{ method: 'action', payload: { did: 'call-10-3', siid: 10, aiid: 3, in: [{ piid: 6, value: 123 }] }, options: { retries: 1 } }]);
    assert.deepEqual(store.get('saved_map_room_safety'), {
        version: 1, originalMapId: 0, roomCaches: { '0': [{ id: 7, name: 'Kitchen' }], '123': [{ id: 7, name: 'Office' }] }, pendingTargetMapId: null
    });
    assert.equal(await device.selectSavedVacuumMap('123'), true);
    assert.equal(calls.filter(({ method }) => method === 'action').length, 1);
});

test('switch rejects stale IDs, Max writes, disabled setting and unsafe state before action', async () => {
    for (const [setup, id, error] of [
        [{}, '999', /no longer available/],
        [{ model: 'xiaomi.vacuum.d109gl' }, '123', /X20 Pro/],
        [{}, 'bad', /valid saved map/]
    ]) {
        const run = createDevice(setup);
        await assert.rejects(run.device.selectSavedVacuumMap(id), error);
        assert.equal(run.calls.some(({ method }) => method === 'action'), false);
    }
    const disabled = createDevice();
    disabled.device.getSetting = () => false;
    await assert.rejects(disabled.device.selectSavedVacuumMap('123'), /Enable/);
    assert.equal(disabled.calls.length, 0);
    const busy = createDevice();
    const originalCall = busy.device.miio.call;
    busy.device.miio.call = async (method, payload, options) => method === 'get_properties' && payload[0].siid === 2
        ? [{ siid: 2, piid: 2, code: 0, value: 5 }]
        : originalCall(method, payload, options);
    await assert.rejects(busy.device.selectSavedVacuumMap('123'), /idle/);
    assert.equal(busy.calls.some(({ method }) => method === 'action'), false);
    const automatic = createDevice();
    const call = automatic.device.miio.call;
    automatic.device.miio.call = (method, payload, options) => method === 'get_properties' && payload[0].piid === 10
        ? Promise.resolve([{ siid: 10, piid: 10, code: 0, value: 1 }])
        : call(method, payload, options);
    await assert.rejects(automatic.device.selectSavedVacuumMap('123'), /Manual/);
    assert.equal(automatic.calls.some(({ method }) => method === 'action'), false);
});

test('a timeout after transmission can succeed only after live map and room confirmation', async () => {
    const after = createDevice({ actionHandler: ({ payload, setCurrent }) => { setCurrent(payload.in[0].value); throw Object.assign(new Error('timeout'), { code: 'timeout' }); } });
    assert.equal(await after.device.selectSavedVacuumMap('123'), true);
    assert.equal(after.calls.filter(({ method }) => method === 'action').length, 1);
    const before = createDevice({ actionHandler: () => { throw Object.assign(new Error('timeout'), { code: 'timeout' }); } });
    await assert.rejects(before.device.selectSavedVacuumMap('123'), /may have succeeded/);
    assert.equal(before.store.get('saved_map_room_safety').pendingTargetMapId, 123);
    assert.equal(before.calls.filter(({ method }) => method === 'action').length, 1);
    await assert.rejects(before.device.selectSavedVacuumMap('123'), /previous map switch is uncertain/);
    assert.equal(before.calls.filter(({ method }) => method === 'action').length, 1);
    assert.equal(await before.device.selectSavedVacuumMap('0'), true);
    assert.equal(before.store.get('saved_map_room_safety').pendingTargetMapId, null);
});

test('acknowledgment without map change does not count as success', async () => {
    const run = createDevice({ actionHandler: () => ({ code: 0 }) });
    await assert.rejects(run.device.selectSavedVacuumMap('123'), /could not be verified/);
    assert.equal(run.store.get('saved_map_room_safety').pendingTargetMapId, 123);
});

test('persistence and room refresh failures prevent or leave a switch safely uncertain', async () => {
    const failedStore = createDevice();
    failedStore.device.setStoreValue = async () => { throw new Error('disk unavailable'); };
    await assert.rejects(failedStore.device.selectSavedVacuumMap('123'), /persist/);
    assert.equal(failedStore.calls.some(({ method }) => method === 'action'), false);

    const failedRooms = createDevice();
    let refreshCount = 0;
    failedRooms.device._refreshRoomsBeforeCleaning = async () => {
        refreshCount += 1;
        if (refreshCount > 1) throw new Error('room read failed');
        return [{ id: 7, name: 'Kitchen' }];
    };
    await assert.rejects(failedRooms.device.selectSavedVacuumMap('123'), /rooms could not be verified/);
    assert.equal(failedRooms.store.get('saved_map_room_safety').pendingTargetMapId, 123);
    await assert.rejects(failedRooms.device._runAdvancedRoomCleaning({ room: '7', mode: '1' }, false), /uncertain/);
});

test('concurrent map operations reject and a replaced connection cannot receive action', async () => {
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    const run = createDevice({ actionHandler: async ({ payload, setCurrent }) => { await wait; setCurrent(payload.in[0].value); return { code: 0 }; } });
    const switching = run.device.selectSavedVacuumMap('123');
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(run.device.discoverSavedVacuumMaps(), /in progress/);
    await assert.rejects(run.device.selectSavedVacuumMap('123'), /in progress/);
    release();
    await switching;

    const changed = createDevice();
    const originalCall = changed.device.miio.call;
    changed.device.miio.call = async (method, payload, options) => {
        const result = await originalCall(method, payload, options);
        if (method === 'get_properties' && payload[0].piid === 5) changed.device.miio = { call: async () => { throw new Error('replacement called'); } };
        return result;
    };
    await assert.rejects(changed.device.selectSavedVacuumMap('123'), /connection changed/);
    assert.equal(changed.calls.some(({ method }) => method === 'action'), false);
});

test('room safety persists across restart and rejects old numeric IDs on another map', async () => {
    const initial = createDevice();
    await initial.device.selectSavedVacuumMap('123');
    const restarted = createDevice({ current: 123, store: initial.store });
    await assert.rejects(restarted.device._runAdvancedRoomCleaning({ room: '7', mode: '1' }, false), /Numeric room IDs/);
    assert.equal(restarted.calls.some(({ method }) => method === 'action'), false);
    assert.deepEqual(restarted.device._resolveMapSafeRoomIds('Office', [{ id: 7, name: 'Office' }]), [7]);
    assert.deepEqual(restarted.device._resolveMapSafeRoomIds('all', [{ id: 7, name: 'Office' }]), [7]);
    restarted.device.getSetting = () => false;
    await assert.rejects(restarted.device._runAdvancedRoomCleaning({ room: '7', mode: '1' }, false), /Numeric room IDs/);
    restarted.device.miio.call = async () => { throw new Error('room read failed'); };
    await assert.rejects(restarted.device._runAdvancedRoomCleaning({ room: 'all', mode: '1' }, false), /room read failed/);
});

test('room cleaning waits behind a map switch and preserves the existing action payload', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const run = createDevice({ actionHandler: async ({ payload, setCurrent }) => { await gate; setCurrent(payload.in[0].value); return { code: 0 }; } });
    const switching = run.device.selectSavedVacuumMap('123');
    await new Promise((resolve) => setImmediate(resolve));
    const cleaning = run.device._runAdvancedRoomCleaning({ room: 'Office', mode: '1' }, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(run.calls.filter(({ method, payload }) => method === 'action' && payload.siid === 2).length, 0);
    release();
    await switching;
    await cleaning;
    const cleaningActions = run.calls.filter(({ method, payload }) => method === 'action' && payload.siid === 2);
    assert.deepEqual(cleaningActions.map(({ payload }) => payload.in[0].value), ['7']);
    assert.equal(run.calls.filter(({ method }) => method === 'set_properties').length, 0);
});

test('Flow autocomplete and run route through selected device with decimal-string IDs', async () => {
    const compose = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'drivers', 'vacuum_xiaomi_vacuum_max', 'driver.flow.compose.json'), 'utf8'));
    const flow = compose.actions.find(({ id }) => id === 'select_saved_vacuum_map');
    assert.deepEqual(flow.args.map(({ name, type }) => ({ name, type })), [{ name: 'map', type: 'autocomplete' }]);
    const cards = new Map();
    const owner = createDevice().device;
    owner.homey.flow = { getActionCard: (id) => {
        if (!cards.has(id)) cards.set(id, {
            registerRunListener(listener) { this.run = listener; },
            registerArgumentAutocompleteListener(name, listener) { this.autocompleteName = name; this.autocomplete = listener; }
        });
        return cards.get(id);
    } };
    owner._registerSavedMapFlowListeners();
    const target = createDevice().device;
    assert.deepEqual(await cards.get('select_saved_vacuum_map').autocomplete('Up', { device: target }), [{ id: '123', name: 'Upstairs', description: 'Map ID 123' }]);
    const max = createDevice({ model: 'xiaomi.vacuum.d109gl' });
    await assert.rejects(cards.get('select_saved_vacuum_map').autocomplete('Up', { device: max.device }), /only for X20 Pro/);
    assert.equal(max.calls.length, 0);
    assert.equal(await cards.get('select_saved_vacuum_map').run({ device: target, map: { id: '123' } }), true);
    assert.equal(await cards.get('discover_saved_vacuum_maps').run({ device: target }), true);
});
