'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function loadDeviceClass() {
    const originalLoad = Module._load;
    Module._load = function loadWithHomeyStub(request, parent, isMain) {
        if (request === 'homey') return { Device: class Device {} };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require('../drivers/petfeeder_mmgg_miot/device.js');
    } finally {
        Module._load = originalLoad;
    }
}

function createDevice(presetId = 'iv2001') {
    const DeviceClass = loadDeviceClass();
    const calls = [];
    const logs = [];
    const timeline = [];
    const device = Object.create(DeviceClass.prototype);
    device._presetId = presetId;
    device.miio = {};
    device._callMiio = async (...args) => {
        calls.push(args);
        return { code: 0 };
    };
    device.log = (...args) => logs.push(args);
    device._timeline = async (message) => timeline.push(message);
    return { calls, device, logs, timeline };
}

test('IV2001 gram action sends the requested grams directly to MIoT 2/1 input 2/8', async () => {
    const { calls, device, logs, timeline } = createDevice();

    const result = await device.dispenseGrams(10);

    assert.deepEqual(calls, [[
        'action',
        {
            did: 'call-2-1',
            siid: 2,
            aiid: 1,
            in: [{ piid: 8, value: 10 }]
        },
        { retries: 1 },
        12000
    ]]);
    assert.deepEqual(result, { code: 0 });
    assert.deepEqual(logs, [['[FEED] manual feed by weight', { grams: 10 }]]);
    assert.deepEqual(timeline, ['Manual feed: 10 g']);
});

test('gram action rejects invalid values before sending any command', async () => {
    for (const value of [undefined, null, 0, 151, 1.5, 'invalid']) {
        const { calls, device } = createDevice();
        await assert.rejects(device.dispenseGrams(value), /whole number from 1 to 150 grams/);
        assert.deepEqual(calls, [], String(value));
    }
});

test('gram action rejects non-IV2001 presets before sending any command', async () => {
    const { calls, device } = createDevice('default');

    await assert.rejects(device.dispenseGrams(10), /not supported by this device/);
    assert.deepEqual(calls, []);
});

test('new Flow card is IV2001-scoped and leaves the published servings card intact', () => {
    const root = path.join(__dirname, '..');
    const gramsCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/actions/petfeederDispenseGrams.json'), 'utf8'));
    const servingsCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/actions/petfeederServeFood.json'), 'utf8'));
    const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    assert.equal(gramsCard.titleFormatted.en, 'Dispense [[grams]] g');
    assert.deepEqual(gramsCard.args[0], {
        name: 'grams',
        title: { en: 'Grams' },
        type: 'number',
        placeholder: { en: 'Grams' },
        min: 1,
        max: 150,
        step: 1
    });
    assert.equal(
        gramsCard.args[1].filter,
        'driver_id=petfeeder_mmgg_miot&capabilities=petfeeder_screen_display_mode'
    );
    assert.equal(servingsCard.args[0].name, 'servings');
    assert.equal(servingsCard.args[0].max, 30);
    assert.equal((appSource.match(/getActionCard\('petfeederDispenseGrams'\)/g) || []).length, 1);
    assert.ok(appSource.includes('args.device.dispenseGrams(args.grams)'));
});
