'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');

const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') {
        return { Device: class Device {} };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
};

require('../drivers/wifi_device.js');
const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
Module._load = originalModuleLoad;

async function flushMicrotasks(count = 4) {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
}

function createTimerHomey() {
    const timers = {
        clearIntervals: [],
        clearTimeouts: [],
        timeouts: []
    };

    return {
        timers,
        homey: {
            __: (key) => key,
            clearInterval: (handle) => timers.clearIntervals.push(handle),
            clearTimeout: (handle) => timers.clearTimeouts.push(handle),
            setTimeout: (callback, delay) => {
                const handle = { callback, delay };
                timers.timeouts.push(handle);
                return handle;
            }
        }
    };
}

function createPollingDevice(miio, { rooms = false } = {}) {
    const { homey, timers } = createTimerHomey();
    const logs = [];
    const errors = [];
    const unavailableCalls = [];
    const availableCalls = [];
    let available = true;
    let createDeviceCalls = 0;

    const device = Object.create(VacuumDevice.prototype);
    device._model = 'xiaomi.vacuum.d102gl';
    device.miio = miio;
    device.homey = homey;
    device.pollingInterval = 'polling-interval';
    device.deviceProperties = {
        get_properties: [],
        get_rooms: [{ did: 'rooms', siid: 2, piid: 16 }],
        supports: {
            rooms,
            consumables: false,
            mopmode: false,
            cleaning_mode: false,
            water_level: false,
            path_mode: false,
            carpet_avoidance: false,
            detergent: false
        },
        status_mapping: {},
        error_codes: {}
    };
    device._syncModelFromDevice = () => true;
    device.getAvailable = () => available;
    device.setAvailable = async () => {
        available = true;
        availableCalls.push(true);
    };
    device.setUnavailable = async (reason) => {
        available = false;
        unavailableCalls.push(reason);
    };
    device.getSetting = () => undefined;
    device.setSettings = async () => {};
    device.setStoreValue = async () => {};
    device.hasCapability = () => false;
    device.getCapabilityValue = () => undefined;
    device.updateCapabilityValue = async () => {};
    device.vacuumCleanerState = () => {};
    device.vacuumTotals = async () => {};
    device.vacuumConsumables = async () => {};
    device.createDevice = () => {
        createDeviceCalls += 1;
    };
    device.log = (...args) => logs.push(args);
    device.error = (...args) => errors.push(args);

    return {
        availableCalls,
        createDeviceCalls: () => createDeviceCalls,
        device,
        errors,
        logs,
        timers,
        unavailableCalls
    };
}

test('property operations are serialized after rejection for d109gl and DID-free models', async () => {
    for (const model of ['xiaomi.vacuum.d109gl', 'xiaomi.vacuum.d102gl']) {
        const calls = [];
        let activeCalls = 0;
        let maximumActiveCalls = 0;
        let rejectFirstCall;
        const miio = {
            handle: { api: { id: 24680 } },
            call: (method, properties, options) => {
                calls.push({ method, properties, options });
                activeCalls += 1;
                maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
                if (calls.length === 1) {
                    return new Promise((resolve, reject) => {
                        rejectFirstCall = () => {
                            activeCalls -= 1;
                            reject(new Error('first property operation failed'));
                        };
                    });
                }
                activeCalls -= 1;
                return Promise.resolve('second operation result');
            }
        };
        const device = Object.create(VacuumDevice.prototype);
        device._model = model;
        device.miio = miio;

        const first = device.callVacuumSetProperties([{ siid: 2, piid: 9, value: 1 }], { retries: 2 });
        const second = device.callVacuumGetProperties([{ siid: 2, piid: 2 }], { retries: 2 });

        await flushMicrotasks();
        assert.equal(calls.length, 1, `${model} must not start a second property operation early`);
        assert.equal(calls[0].method, 'set_properties');
        assert.equal(calls[0].options.retries, 2);

        rejectFirstCall();
        await assert.rejects(first, /first property operation failed/);
        assert.equal(await second, 'second operation result');

        assert.equal(calls.length, 2);
        assert.equal(calls[1].method, 'get_properties');
        assert.equal(calls[1].options.retries, 2);
        assert.equal(maximumActiveCalls, 1, `${model} must serialize property network operations`);
        if (model === 'xiaomi.vacuum.d109gl') {
            assert.deepEqual(calls[0].properties, [{ did: '24680', siid: 2, piid: 9, value: 1 }]);
        } else {
            assert.deepEqual(calls[0].properties, [{ siid: 2, piid: 9, value: 1 }]);
        }
    }
});

test('retrieveDeviceData skips an overlapping full poll and clears its guard afterwards', async () => {
    const calls = [];
    let resolveMainPoll;
    const miio = {
        call: (method, properties, options) => {
            calls.push({ method, properties, options });
            return new Promise((resolve) => {
                resolveMainPoll = resolve;
            });
        }
    };
    const { device } = createPollingDevice(miio);

    const firstPoll = device.retrieveDeviceData();
    await flushMicrotasks();
    assert.equal(calls.length, 1);

    await device.retrieveDeviceData();
    assert.equal(calls.length, 1, 'the second poll must be skipped instead of queued');

    resolveMainPoll([]);
    await firstPoll;
    assert.equal(device._retrieveDeviceDataInProgress, false);
});

test('main-poll failures tolerate two failures, reset on success, and reconnect once after the third', async () => {
    let failMainPoll = true;
    const udpTimeout = Object.assign(new Error('UDP timeout'), { code: 'ETIMEDOUT' });
    const miio = {
        call: async () => {
            if (failMainPoll) throw udpTimeout;
            return [];
        }
    };
    const {
        device,
        errors,
        logs,
        timers,
        unavailableCalls
    } = createPollingDevice(miio);

    await device.retrieveDeviceData();
    await device.retrieveDeviceData();

    assert.equal(device._mainPollFailures, 2);
    assert.equal(unavailableCalls.length, 0);
    assert.equal(timers.clearIntervals.length, 0);
    assert.equal(timers.timeouts.length, 0);
    assert.ok(errors.some(([message]) => String(message).includes('UDP timeout') && String(message).includes('ETIMEDOUT')));

    failMainPoll = false;
    await device.retrieveDeviceData();
    assert.equal(device._mainPollFailures, 0, 'a successful combined main poll resets the failure counter immediately');
    assert.ok(logs.some(([message]) => String(message).includes('recovered after 2 consecutive failures')));

    failMainPoll = true;
    device.recreateTimeout = 'previous-reconnect-timer';
    await device.retrieveDeviceData();
    await device.retrieveDeviceData();
    await device.retrieveDeviceData();

    assert.equal(device._mainPollFailures, 0, 'the reconnect begins a fresh failure cycle');
    assert.deepEqual(timers.clearIntervals, ['polling-interval']);
    assert.deepEqual(timers.clearTimeouts, ['previous-reconnect-timer']);
    assert.deepEqual(unavailableCalls, ['device.unreachable']);
    assert.equal(timers.timeouts.length, 1);
    assert.equal(timers.timeouts[0].delay, 60000);
    assert.equal(device.recreateTimeout, timers.timeouts[0]);

    await device.retrieveDeviceData();
    assert.equal(device._mainPollFailures, 1, 'the next direct poll starts at failure one, not four');
    assert.equal(timers.timeouts.length, 1, 'a fresh failure cycle must not duplicate the stored reconnect timer');
});

test('optional room reads and local processing failures do not trigger transport recovery', async () => {
    const roomCalls = [];
    const roomMiio = {
        call: async (method, properties, options) => {
            roomCalls.push({ method, properties, options });
            if (roomCalls.length === 1) return [];
            throw new Error('optional room read failed');
        }
    };
    const roomCase = createPollingDevice(roomMiio, { rooms: true });

    await roomCase.device.retrieveDeviceData();

    assert.equal(roomCase.device._mainPollFailures, 0);
    assert.equal(roomCase.unavailableCalls.length, 0);
    assert.equal(roomCase.timers.timeouts.length, 0);
    assert.equal(roomCase.createDeviceCalls(), 0);
    assert.ok(roomCase.errors.some(([message]) => {
        const text = String(message);
        return text.startsWith('[ROOMS] Optional property read failed') && text.includes('optional room read failed');
    }));
    assert.ok(roomCase.errors.some(([message]) => {
        const text = String(message);
        return text.startsWith('[ROOMS] Optional candidate property read failed') && text.includes('optional room read failed');
    }));
    assert.ok(roomCalls.every((call) => call.options.retries === 2));

    const localMiio = {
        call: async () => []
    };
    const localCase = createPollingDevice(localMiio);
    localCase.device.updateCapabilityValue = async () => {
        throw new Error('capability update failed');
    };

    await localCase.device.retrieveDeviceData();

    assert.equal(localCase.device._mainPollFailures, 0);
    assert.equal(localCase.unavailableCalls.length, 0);
    assert.equal(localCase.timers.timeouts.length, 0);
    assert.equal(localCase.createDeviceCalls(), 0);
    assert.ok(localCase.errors.some(([message]) => String(message).startsWith('[POLL] Local processing failed')));
    assert.ok(localCase.errors.some(([message]) => String(message).includes('capability update failed')));
});

test('a failed unavailable update logs its safe cause without blocking the reconnect timer', async () => {
    const miio = {
        call: async () => {
            throw new Error('UDP timeout');
        }
    };
    const { device, errors, timers } = createPollingDevice(miio);
    const unavailableError = Object.assign(new Error('Homey unavailable update failed'), { code: 'EHOMEY' });
    device.setUnavailable = async () => {
        throw unavailableError;
    };

    await device.retrieveDeviceData();
    await device.retrieveDeviceData();
    await device.retrieveDeviceData();

    assert.equal(device._mainPollFailures, 0);
    assert.equal(timers.timeouts.length, 1);
    assert.equal(timers.timeouts[0].delay, 60000);
    assert.ok(errors.some(([message]) => String(message).includes('Homey unavailable update failed') && String(message).includes('EHOMEY')));
});

test('all property read/write call sites use retries two while action retries stay unchanged', () => {
    const source = fs.readFileSync(require.resolve('../drivers/vacuum_xiaomi_vacuum_max/device.js'), 'utf8');
    const lines = source.split(/\r?\n/);
    const propertyWriteLines = lines.filter((line) => /(?:args\.device|this)\.callVacuumSetProperties\(/.test(line));
    const propertyReadLines = lines.filter((line) => line.includes('this.callVacuumGetProperties('));
    const actionRetries = Array.from(
        source.matchAll(/\.miio\.call\('action',[^\n]*\{ retries: (\d+) \}\)/g),
        (match) => Number(match[1])
    );

    assert.equal(propertyWriteLines.length, 6);
    assert.ok(propertyWriteLines.every((line) => line.includes('{ retries: 2 }')));
    assert.equal(propertyReadLines.length, 5, 'main, room, candidate, diagnostic, and pre-clean refresh reads must use the queue');
    assert.ok(propertyReadLines.every((line) => line.includes('{ retries: 2 }')));
    assert.deepEqual(actionRetries, [3, 1, 1, 1]);
});
