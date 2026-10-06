'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const MODEL = 'xiaomi.vacuum.ov21gl';
const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {}, Driver: class Driver {} };
    return originalModuleLoad.call(this, request, parent, isMain);
};

const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
const VacuumDriver = require('../drivers/vacuum_xiaomi_vacuum_max/driver.js');
const Util = require('../lib/util.js');
Module._load = originalModuleLoad;

function createDevice(model = MODEL) {
    const device = Object.create(VacuumDevice.prototype);
    device._resetX20StatusTracking = () => {};
    device._applyModelProperties(model);
    return device;
}

test('Robot Vacuum 5 Pro pairs by name and uses its published MIoT controls', () => {
    assert.equal(new Util({}).getFriendlyNameWiFi(MODEL), 'Xiaomi Robot Vacuum 5 Pro');

    const driver = Object.create(VacuumDriver.prototype);
    driver.manifest = { capabilities: ['onoff', 'vacuum_xiaomi_base_station_status'] };
    assert.deepEqual(driver.getPairingCapabilities(MODEL), driver.manifest.capabilities);

    const device = createDevice();
    assert.deepEqual(device.deviceProperties.status_mapping, createDevice('xiaomi.vacuum.ov43gb').deviceProperties.status_mapping);
    assert.deepEqual(device.deviceProperties.get_rooms, [{ did: 'rooms', siid: 2, piid: 16 }]);
    assert.deepEqual(device.deviceProperties.get_properties.find((property) => property.did === 'device_status'), { did: 'device_status', siid: 2, piid: 2 });
    assert.deepEqual(device.deviceProperties.get_properties.find((property) => property.did === 'carpet_avoidance'), { did: 'carpet_avoidance', siid: 2, piid: 73 });
    assert.deepEqual(device.buildCarpetModeSetPayload('1').payload, [{ siid: 2, piid: 73, value: 1 }]);
    assert.deepEqual(device.deviceProperties.get_properties.filter((property) => property.did === 'base_station_working_status'), [{ did: 'base_station_working_status', siid: 2, piid: 18 }]);
    assert.deepEqual(device._buildCleanTimesProperty(2), { siid: 2, piid: 8, value: 2 });
    assert.equal(device._isSupportedBaseStationStatusDevice(), true);
    assert.equal(device._isSupportedX20Device(), false);
});

test('Robot Vacuum 5 Pro base station actions use the published action IDs', async () => {
    const device = createDevice();
    let listener;
    device.homey = { flow: { getActionCard: () => ({ registerRunListener: (run) => { listener = run; } }) } };
    device._registerBaseStationControlFlowListener();

    for (const [command, aiid] of Object.entries({
        start_dust_collection: 18,
        start_mop_washing: 19,
        stop_mop_washing: 31,
        start_drying: 20,
        stop_drying: 32
    })) {
        const calls = [];
        const target = { getModelIdentifier: () => MODEL, miio: { call: async (...args) => { calls.push(args); return 'ok'; } } };
        assert.equal(await listener({ device: target, command }), 'ok');
        assert.deepEqual(calls, [['action', { siid: 2, aiid, did: `call-2-${aiid}`, in: [] }, { retries: 1 }]]);
    }
});
