'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithHomeyAndWifiDeviceStubs(request, parent, isMain) {
    if (request === 'homey') {
        return { Device: class Device {} };
    }
    if (request === '../wifi_device.js') {
        return class WifiDevice {};
    }
    return originalLoad.call(this, request, parent, isMain);
};

const AdvancedDmakerFanMiotDevice = require('../drivers/fan_dmaker_advanced/device.js');
Module._load = originalLoad;

function createDevice() {
    const capabilityOptions = {};
    const listeners = {};
    const calls = [];
    const errors = [];
    const device = Object.create(AdvancedDmakerFanMiotDevice.prototype);

    device.homey = {
        __: (key) => key,
        flow: {
            getDeviceTriggerCard: () => ({ trigger: async () => {} })
        }
    };
    device.util = {
        clamp: (value, min, max) => Math.min(Math.max(value, min), max)
    };
    device.bootSequence = async () => {};
    device.getStoreValue = (key) => key === 'model' ? 'dmaker.fan.p8' : undefined;
    device.hasCapability = (capability) => capability === 'dim';
    device.setCapabilityOptions = async (capability, options) => {
        capabilityOptions[capability] = options;
    };
    device.registerCapabilityListener = (capability, listener) => {
        listeners[capability] = listener;
    };
    device.miio = {
        call: async (...args) => {
            calls.push(args);
            return true;
        }
    };
    device.error = (error) => errors.push(error);
    device.removeCapability = async () => {};

    return { calls, capabilityOptions, device, errors, listeners };
}

test('dmaker.fan.p8 advertises and writes only three fan levels', async () => {
    const fixture = createDevice();

    await fixture.device.onInit();

    assert.deepEqual(fixture.capabilityOptions.dim, { max: 3 });
    assert.deepEqual(fixture.errors, []);

    await fixture.listeners.dim(4);
    assert.deepEqual(fixture.calls.at(-1), [
        'set_properties',
        [{ did: 'fan_level', siid: 2, piid: 2, value: 3 }],
        { retries: 1 }
    ]);

    await fixture.listeners.dim(2);
    assert.deepEqual(fixture.calls.at(-1), [
        'set_properties',
        [{ did: 'fan_level', siid: 2, piid: 2, value: 2 }],
        { retries: 1 }
    ]);
});
