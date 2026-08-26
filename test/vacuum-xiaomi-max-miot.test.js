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

const WifiDevice = require('../drivers/wifi_device.js');
const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
Module._load = originalModuleLoad;

function createMiio({ id = 123456, result = { ok: true } } = {}) {
    const calls = [];
    const miio = {
        handle: { api: { id } },
        call: (...args) => {
            calls.push(args);
            return result;
        }
    };
    return { calls, miio };
}

function createBaseDevice(miio) {
    const device = Object.create(WifiDevice.prototype);
    device.miio = miio;
    return device;
}

function createVacuumDevice(model, miio) {
    const device = Object.create(VacuumDevice.prototype);
    device._model = model;
    device.miio = miio;
    return device;
}

test('base MIoT set_properties helper enriches cloned entries with the connected DID', async () => {
    const result = { success: true };
    const { calls, miio } = createMiio({ id: 987654, result });
    const device = createBaseDevice(miio);
    const originalEntry = { did: 'caller-did', siid: 2, piid: 9, value: 3 };
    const properties = [originalEntry];
    const options = { retries: 4, marker: true };

    const returned = await device.callMiotSetProperties(properties, options);

    assert.equal(returned, result);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'set_properties');
    assert.deepEqual(calls[0][1], [{ did: '987654', siid: 2, piid: 9, value: 3 }]);
    assert.notEqual(calls[0][1][0], originalEntry);
    assert.deepEqual(properties, [{ did: 'caller-did', siid: 2, piid: 9, value: 3 }]);
    assert.equal(calls[0][2], options);
});

test('base MIoT set_properties helper preserves underlying errors and validates prerequisites', async () => {
    const underlyingError = new Error('transport failed');
    const { miio } = createMiio({ result: Promise.reject(underlyingError) });
    const device = createBaseDevice(miio);

    await assert.rejects(device.callMiotSetProperties([]), (error) => error === underlyingError);
    await assert.rejects(device.callMiotSetProperties('not-an-array'), /properties must be an array/);

    const noIdDevice = createBaseDevice({ handle: { api: {} }, call: () => null });
    await assert.rejects(noIdDevice.callMiotSetProperties([]), /connected device ID/);
    const noMiioDevice = createBaseDevice(null);
    await assert.rejects(noMiioDevice.callMiotSetProperties([]), /active miio device with callable call/);
});

test('vacuum wrapper adds the connected DID only for xiaomi.vacuum.d109gl', async () => {
    for (const model of ['xiaomi.vacuum.d109gl', 'xiaomi.vacuum.d102gl', 'xiaomi.vacuum.c102gl']) {
        const { calls, miio } = createMiio({ id: 24680, result: model });
        const device = createVacuumDevice(model, miio);
        const properties = [{ siid: 2, piid: 10, value: 1 }];
        const options = { retries: 2 };

        const returned = await device.callVacuumSetProperties(properties, options);

        assert.equal(returned, model);
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], 'set_properties');
        assert.equal(calls[0][2], options);
        if (model === 'xiaomi.vacuum.d109gl') {
            assert.deepEqual(calls[0][1], [{ did: '24680', siid: 2, piid: 10, value: 1 }]);
            assert.notEqual(calls[0][1], properties);
        } else {
            assert.equal(calls[0][1], properties);
            assert.deepEqual(calls[0][1], [{ siid: 2, piid: 10, value: 1 }]);
            assert.ok(!Object.prototype.hasOwnProperty.call(calls[0][1][0], 'did'));
        }
    }
});

test('all six vacuum property-write paths call the model-aware wrapper', () => {
    const source = fs.readFileSync(require.resolve('../drivers/vacuum_xiaomi_vacuum_max/device.js'), 'utf8');
    const wrapperCalls = source.match(/(?:args\.device|this)\.callVacuumSetProperties\(/g) || [];

    assert.equal(wrapperCalls.length, 6);
    assert.match(source, /if \(props\.length\) await this\.callVacuumSetProperties\(props, \{ retries: 2 \}\);/);
});
