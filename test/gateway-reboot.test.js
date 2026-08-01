'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') {
        return { Device: class Device {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const GatewayDevice = require('../drivers/gateway/device.js');
Module._load = originalLoad;

function createDevice({ model = 'lumi.gateway.v3', rebootError } = {}) {
    const calls = [];
    const state = {
        clearIntervalCalls: [],
        clearTimeoutCalls: [],
        createDeviceCalls: 0,
        destroyCalls: 0,
        logs: [],
        pollDeviceCalls: 0,
        setUnavailableCalls: [],
        timeout: null
    };

    const device = Object.create(GatewayDevice.prototype);
    device.pollingInterval = { type: 'polling' };
    device.recreateTimeout = { type: 'recreate' };
    device.getStoreValue = (key) => key === 'model' ? model : undefined;
    device.miio = {
        call: async (method, params, options) => {
            calls.push({ method, params, options });
            if (method === 'miIO.reboot' && rebootError) throw rebootError;
            return ['ok'];
        },
        destroy: () => { state.destroyCalls += 1; }
    };
    device.homey = {
        __: (key) => key === 'device.restarting' ? 'Gateway is restarting' : key,
        clearInterval: (handle) => { state.clearIntervalCalls.push(handle); },
        clearTimeout: (handle) => { state.clearTimeoutCalls.push(handle); },
        setTimeout: (callback, delay) => {
            state.timeout = { callback, delay };
            return state.timeout;
        }
    };
    device.setUnavailable = async (message) => { state.setUnavailableCalls.push(message); };
    device.createDevice = async () => { state.createDeviceCalls += 1; };
    device.pollDevice = async () => { state.pollDeviceCalls += 1; };
    device.log = (...args) => { state.logs.push(args); };
    device.error = () => {};

    return { calls, device, state };
}

test('supported gateway sends one preflight followed by one reboot command', async () => {
    const { calls, device } = createDevice();

    await device.rebootGateway();

    assert.deepEqual(calls, [
        { method: 'miIO.info', params: [], options: { retries: 1 } },
        { method: 'miIO.reboot', params: [], options: { retries: 1 } }
    ]);
});

test('timeout after a successful preflight is accepted', async () => {
    const timeout = Object.assign(new Error('No response'), { code: 'timeout' });
    const { device, state } = createDevice({ rebootError: timeout });

    await assert.doesNotReject(device.rebootGateway());

    assert.equal(state.logs.length, 1);
    assert.equal(state.destroyCalls, 1);
    assert.equal(device.miio, null);
});

test('method-not-found and other non-timeout reboot errors are propagated', async (t) => {
    for (const error of [
        Object.assign(new Error('Method not found'), { code: -32601 }),
        Object.assign(new Error('Connection failed'), { code: 'network' })
    ]) {
        await t.test(String(error.code), async () => {
            const { calls, device, state } = createDevice({ rebootError: error });

            await assert.rejects(device.rebootGateway(), (caught) => caught === error);

            assert.equal(calls.length, 2);
            assert.equal(state.pollDeviceCalls, 1);
            assert.equal(state.destroyCalls, 0);
            assert.notEqual(device.miio, null);
        });
    }
});

test('unsupported models do not send any miIO command', async () => {
    const { calls, device, state } = createDevice({ model: 'lumi.gateway.mgl03' });

    await assert.rejects(device.rebootGateway(), /only supported for lumi\.gateway\.v3/);

    assert.deepEqual(calls, []);
    assert.equal(state.destroyCalls, 0);
});

test('a preflight failure is not mistaken for a successful reboot', async () => {
    const { calls, device, state } = createDevice();
    const preflightTimeout = Object.assign(new Error('No response'), { code: 'timeout' });
    device.miio.call = async (method, params, options) => {
        calls.push({ method, params, options });
        throw preflightTimeout;
    };

    await assert.rejects(device.rebootGateway(), (caught) => caught === preflightTimeout);

    assert.deepEqual(calls, [
        { method: 'miIO.info', params: [], options: { retries: 1 } }
    ]);
    assert.equal(state.destroyCalls, 0);
    assert.equal(state.setUnavailableCalls.length, 0);
});

test('an accepted reboot destroys the old instance and schedules createDevice', async () => {
    const { device, state } = createDevice();
    const oldPollingInterval = device.pollingInterval;
    const oldRecreateTimeout = device.recreateTimeout;

    const result = await device.rebootGateway();

    assert.equal(result, true);
    assert.deepEqual(state.clearIntervalCalls, [oldPollingInterval]);
    assert.deepEqual(state.setUnavailableCalls, ['Gateway is restarting']);
    assert.equal(state.destroyCalls, 1);
    assert.deepEqual(state.clearTimeoutCalls, [oldRecreateTimeout]);
    assert.equal(state.timeout.delay, 15000);
    assert.equal(state.createDeviceCalls, 0);

    state.timeout.callback();
    assert.equal(state.createDeviceCalls, 1);
});
