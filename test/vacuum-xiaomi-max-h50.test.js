'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const H50_MODEL = 'xiaomi.vacuum.ov43gb';
const BASE_STATION_STATUS_CAPABILITY = 'vacuum_xiaomi_base_station_status';
const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {}, Driver: class Driver {} };
    return originalModuleLoad.call(this, request, parent, isMain);
};

const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
const VacuumDriver = require('../drivers/vacuum_xiaomi_vacuum_max/driver.js');
Module._load = originalModuleLoad;

function createVacuumDevice(model = H50_MODEL) {
    const device = Object.create(VacuumDevice.prototype);
    device._resetX20StatusTracking = () => {};
    device._applyModelProperties(model);
    return device;
}

test('H50 uses the exact d109gl MIoT layout with the complete 24-code status mapping', () => {
    const h50 = createVacuumDevice();
    const d109 = createVacuumDevice('xiaomi.vacuum.d109gl');

    assert.deepEqual(h50.deviceProperties.get_rooms, [{ did: 'rooms', siid: 2, piid: 16 }]);
    assert.deepEqual(h50.deviceProperties.get_properties, [
        { did: 'device_status', siid: 2, piid: 2 },
        { did: 'device_fault', siid: 2, piid: 3 },
        { did: 'mode', siid: 2, piid: 4 },
        { did: 'battery', siid: 3, piid: 1 },
        { did: 'main_brush_life_level', siid: 12, piid: 1 },
        { did: 'side_brush_life_level', siid: 13, piid: 1 },
        { did: 'filter_life_level', siid: 14, piid: 1 },
        { did: 'total_clean_time', siid: 2, piid: 7 },
        { did: 'total_clean_count', siid: 2, piid: 8 },
        { did: 'total_clean_area', siid: 2, piid: 6 },
        { did: 'cleaning_mode', siid: 2, piid: 9 },
        { did: 'water_level', siid: 2, piid: 10 },
        { did: 'path_mode', siid: 2, piid: 74 },
        { did: 'detergent_left_level', siid: 18, piid: 1 },
        { did: 'detergent_self_delivery', siid: 18, piid: 2 },
        { did: 'detergent_self_delivery_lvl', siid: 18, piid: 3 },
        { did: 'dust_bag_life_level', siid: 19, piid: 1 },
        { did: 'dust_bag_left_time', siid: 19, piid: 2 },
        { did: 'detergent_depletion_reminder', siid: 2, piid: 71 },
        { did: 'carpet_avoidance', siid: 2, piid: 73 },
        { did: 'base_station_working_status', siid: 2, piid: 18 }
    ]);
    assert.deepEqual(h50.deviceProperties.set_properties, d109.deviceProperties.set_properties);
    assert.deepEqual(h50.deviceProperties.status_mapping, {
        cleaning: [4, 7, 8, 10, 12, 16, 17, 19, 22],
        spot_cleaning: [],
        docked: [9, 11, 14, 23],
        charging: [2, 3, 6, 13, 21, 24],
        stopped: [1, 5, 18, 20],
        stopped_error: [15]
    });
    assert.deepEqual(
        [...h50.deviceProperties.status_mapping.cleaning, ...h50.deviceProperties.status_mapping.docked, ...h50.deviceProperties.status_mapping.charging, ...h50.deviceProperties.status_mapping.stopped, ...h50.deviceProperties.status_mapping.stopped_error].sort((a, b) => a - b),
        Array.from({ length: 24 }, (_, index) => index + 1)
    );
});

test('H50 pairing, base-station controls, and PIID 18 polling remain model-scoped', async () => {
    const driver = Object.create(VacuumDriver.prototype);
    driver.manifest = { capabilities: ['onoff', BASE_STATION_STATUS_CAPABILITY, 'measure_battery'] };
    assert.deepEqual(driver.getPairingCapabilities(H50_MODEL), driver.manifest.capabilities);

    const h50 = createVacuumDevice();
    const d109 = createVacuumDevice('xiaomi.vacuum.d109gl');
    const d101 = createVacuumDevice('xiaomi.vacuum.d101');
    assert.equal(h50._isSupportedBaseStationStatusDevice(), true);
    assert.equal(h50._isSupportedX20Device(), false, 'H50 must not use X20-only raw status Flow cards');
    assert.equal(h50.deviceProperties.get_properties.filter((property) => property.siid === 2 && property.piid === 18).length, 1);
    assert.notEqual(h50.deviceProperties.get_properties, d109.deviceProperties.get_properties);
    assert.ok(!d101.deviceProperties.get_properties.some((property) => property.siid === 2 && property.piid === 18));

    let listener;
    h50.homey = {
        flow: {
            getActionCard: () => ({ registerRunListener: (registeredListener) => { listener = registeredListener; } })
        }
    };
    h50._registerBaseStationControlFlowListener();
    const commands = {
        start_dust_collection: 18,
        start_mop_washing: 19,
        stop_mop_washing: 31,
        start_drying: 20,
        stop_drying: 32
    };
    for (const [command, aiid] of Object.entries(commands)) {
        const calls = [];
        const target = { getModelIdentifier: () => H50_MODEL, miio: { call: async (...args) => { calls.push(args); return 'ok'; } } };
        assert.equal(await listener({ device: target, command }), 'ok');
        assert.deepEqual(calls, [['action', { siid: 2, aiid, did: `call-2-${aiid}`, in: [] }, { retries: 1 }]]);
    }
});

test('H50 accepts published Clean Times values and serializes room IDs without a single-room duplicate', () => {
    const h50 = createVacuumDevice();

    assert.deepEqual(h50._buildCleanTimesProperty(1), { siid: 2, piid: 8, value: 1 });
    assert.deepEqual(h50._buildCleanTimesProperty('2'), { siid: 2, piid: 8, value: 2 });
    assert.throws(() => h50._buildCleanTimesProperty(3), /Once \(1\) or Twice \(2\)/);
    assert.equal(h50._serializeRoomList([27]), '27');
    assert.equal(h50._serializeRoomList([27, 28]), '27,28');
    assert.equal(createVacuumDevice('xiaomi.vacuum.d109gl')._serializeRoomList([27]), '27,27');
});

test('H50 does not use d109gl-only DID enrichment for property writes', async () => {
    const h50 = createVacuumDevice();
    const properties = [{ siid: 2, piid: 10, value: 1 }];
    const calls = [];
    h50.miio = { handle: { api: { id: 12345 } }, call: async (...args) => { calls.push(args); return 'ok'; } };

    assert.equal(await h50.callVacuumSetProperties(properties, { retries: 2 }), 'ok');
    assert.deepEqual(calls, [['set_properties', properties, { retries: 2 }]]);
    assert.ok(!Object.prototype.hasOwnProperty.call(properties[0], 'did'));
});
