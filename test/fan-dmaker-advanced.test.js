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
    const addedCapabilities = [];
    const removedCapabilities = [];
    const capabilities = new Set(['dim']);
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
    device.hasCapability = (capability) => capabilities.has(capability);
    device.addCapability = async (capability) => {
        addedCapabilities.push(capability);
        capabilities.add(capability);
    };
    device.removeCapability = async (capability) => {
        removedCapabilities.push(capability);
        capabilities.delete(capability);
    };
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
    device.log = () => {};
    device.error = (error) => errors.push(error);

    return { addedCapabilities, calls, capabilityOptions, device, errors, listeners, removedCapabilities };
}

test('dmaker.fan.p8 advertises and writes only three fan levels via fan_dmaker_fanlevel', async () => {
    const fixture = createDevice();

    await fixture.device.onInit();

    assert.deepEqual(fixture.capabilityOptions.fan_dmaker_fanlevel, {
        values: [
            { id: '1', title: '1' },
            { id: '2', title: '2' },
            { id: '3', title: '3' }
        ]
    });
    assert.deepEqual(fixture.errors, []);
    assert.equal(typeof fixture.listeners.fan_dmaker_fanlevel, 'function');
    assert.equal(fixture.listeners.dim, undefined);

    await fixture.listeners.fan_dmaker_fanlevel(3);
    assert.deepEqual(fixture.calls.at(-1), [
        'set_properties',
        [{ did: 'fan_level', siid: 2, piid: 2, value: 3 }],
        { retries: 1 }
    ]);

    await fixture.listeners.fan_dmaker_fanlevel(2);
    assert.deepEqual(fixture.calls.at(-1), [
        'set_properties',
        [{ did: 'fan_level', siid: 2, piid: 2, value: 2 }],
        { retries: 1 }
    ]);
});
