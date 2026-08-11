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

function createVacuumDevice(model) {
    const device = Object.create(VacuumDevice.prototype);
    device._model = model;
    return device;
}

test('serializes one selected room once for xiaomi.vacuum.d102gl', () => {
    const device = createVacuumDevice('xiaomi.vacuum.d102gl');

    assert.equal(device._serializeRoomList([27]), '27');
});

test('retains the single-room duplication workaround for other supported models', () => {
    const device = createVacuumDevice('xiaomi.vacuum.d109gl');

    assert.equal(device._serializeRoomList([27]), '27,27');
});

test('serializes multiple selected rooms without duplication for every model', () => {
    for (const model of ['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl', 'xiaomi.vacuum.c102gl']) {
        const device = createVacuumDevice(model);

        assert.equal(device._serializeRoomList([27, 28]), '27,28');
    }
});
