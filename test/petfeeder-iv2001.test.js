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

test('IV2001 gram action converts requested grams to 10 g portions for MIoT 2/1 input 2/8', async () => {
    const { calls, device, logs, timeline } = createDevice();

    const result = await device.dispenseGrams(20);

    assert.deepEqual(calls, [[
        'action',
        {
            did: 'call-2-1',
            siid: 2,
            aiid: 1,
            in: [{ piid: 8, value: 2 }]
        },
        { retries: 1 },
        12000
    ]]);
    assert.deepEqual(result, { code: 0 });
    assert.deepEqual(logs, [['[FEED] manual feed by weight', { grams: 20, portions: 2 }]]);
    assert.deepEqual(timeline, ['Manual feed: 20 g']);
});

test('gram action rejects invalid values before sending any command', async () => {
    for (const value of [undefined, null, 0, 1, 2, 9, 11, 151, 1.5, 'invalid']) {
        const { calls, device } = createDevice();
        await assert.rejects(device.dispenseGrams(value), /multiple of 10 from 10 to 150 grams/);
        assert.deepEqual(calls, [], String(value));
    }
});

test('gram action rejects non-IV2001 presets before sending any command', async () => {
    const { calls, device } = createDevice('default');

    await assert.rejects(device.dispenseGrams(10), /not supported by this device/);
    assert.deepEqual(calls, []);
});

test('IV2001 servings action sends the requested portion count instead of multiplying it into grams', async () => {
    const { calls, device, logs, timeline } = createDevice();
    device._state = { targetFeedingMeasure: 5 };

    const result = await device.servePortions(2);

    assert.deepEqual(calls, [[
        'action',
        {
            did: 'call-2-1',
            siid: 2,
            aiid: 1,
            in: [{ piid: 8, value: 2 }]
        },
        { retries: 1 },
        12000
    ]]);
    assert.deepEqual(result, { code: 0 });
    assert.deepEqual(logs, [['[FEED] manual feed', { portions: 2, grams: 20, grams_per_portion: 10 }]]);
    assert.deepEqual(timeline, ['Manual feed: 2x (20 g)']);
});

test('IV2001 scale calibration sends the complete MIoT 2/2 action payload', async () => {
    const { calls, device } = createDevice();

    const result = await device.calibrateScale();

    assert.deepEqual(calls, [[
        'action',
        { did: 'call-2-2', siid: 2, aiid: 2, in: [] },
        { retries: 1 },
        12000
    ]]);
    assert.deepEqual(result, { code: 0 });
});

test('IV2001 desiccant reset invokes MIoT service 6 action 1 without inputs', async () => {
    const { calls, device, logs, timeline } = createDevice();

    const result = await device.resetDesiccantLife();

    assert.deepEqual(calls, [[
        'action',
        {
            did: 'call-6-1',
            siid: 6,
            aiid: 1,
            in: []
        },
        { retries: 1 },
        12000
    ]]);
    assert.deepEqual(result, { code: 0 });
    assert.deepEqual(logs, [['[DESICCANT] replacement status reset requested']]);
    assert.deepEqual(timeline, ['Desiccant replacement status reset requested']);
});

test('desiccant reset rejects non-IV2001 presets before sending any command', async () => {
    const { calls, device } = createDevice('default');

    await assert.rejects(device.resetDesiccantLife(), /not supported by this device/);
    assert.deepEqual(calls, []);
});

test('feeder fault transition triggers the dedicated error card once with useful details', async () => {
    const { device } = createDevice();
    const capabilityUpdates = [];
    const statusTriggers = [];
    const errorTriggers = [];
    device._state = { lastMode: 'idle' };
    device._flow = {
        feederStatusChanged: { trigger: async (...args) => statusTriggers.push(args) },
        feederError: { trigger: async (...args) => errorTriggers.push(args) }
    };
    device.hasCapability = (capability) => capability === 'petfeeder_status_mode';
    device.getCapabilityValue = () => false;
    device._setCap = async (...args) => capabilityUpdates.push(args);

    const foodStuck = {
        error: { code: 0, value: 0 },
        food_stuck_status: { code: 0, value: 1 },
        food_out_status: { code: 0, value: 0 }
    };
    await device._updateStatusMode(foodStuck);
    await device._updateStatusMode(foodStuck);

    assert.deepEqual(capabilityUpdates, [
        ['petfeeder_status_mode', 'fault'],
        ['petfeeder_status_mode', 'fault']
    ]);
    assert.equal(errorTriggers.length, 1);
    assert.deepEqual(errorTriggers[0].slice(1), [
        { error: 'Food stuck', error_code: 'food_stuck' },
        {}
    ]);
    assert.equal(statusTriggers.length, 1);
    assert.deepEqual(statusTriggers[0].slice(1), [
        { new_status: 'fault', previous_status: 'idle' },
        {}
    ]);
});

test('IV2001 reports 2/11 as a food bowl error while preserving the published error code', async () => {
    const { device } = createDevice();
    const statusTriggers = [];
    const errorTriggers = [];
    device._state = { lastMode: 'idle', activeFaultCodes: new Set() };
    device._flow = {
        feederStatusChanged: { trigger: async (...args) => statusTriggers.push(args) },
        feederError: { trigger: async (...args) => errorTriggers.push(args) }
    };
    device.hasCapability = (capability) => capability === 'petfeeder_status_mode';
    device.getCapabilityValue = () => false;
    device._setCap = async () => {};

    const bowlError = {
        error: { code: 0, value: 0 },
        food_stuck_status: { code: 0, value: 0 },
        food_out_status: { code: 0, value: 1 }
    };
    await device._updateStatusMode(bowlError);
    await device._updateStatusMode(bowlError);

    assert.equal(errorTriggers.length, 1);
    assert.deepEqual(errorTriggers[0].slice(1), [
        { error: 'Food bowl error', error_code: 'food_out' },
        {}
    ]);
    assert.equal(statusTriggers.length, 1);
});

test('feeder error card triggers for a newly activated fault while status remains fault', async () => {
    const { device } = createDevice();
    const statusTriggers = [];
    const errorTriggers = [];
    device._state = { lastMode: 'fault', activeFaultCodes: new Set(['food_out']) };
    device._flow = {
        feederStatusChanged: { trigger: async (...args) => statusTriggers.push(args) },
        feederError: { trigger: async (...args) => errorTriggers.push(args) }
    };
    device.hasCapability = (capability) => capability === 'petfeeder_status_mode';
    device.getCapabilityValue = () => false;
    device._setCap = async () => {};

    await device._updateStatusMode({
        error: { code: 0, value: 0 },
        food_stuck_status: { code: 0, value: 1 },
        food_out_status: { code: 0, value: 1 }
    });

    assert.equal(errorTriggers.length, 1);
    assert.deepEqual(errorTriggers[0].slice(1), [
        { error: 'Food stuck', error_code: 'food_stuck' },
        {}
    ]);
    assert.equal(statusTriggers.length, 0);
});

test('legacy feeders retain the Food out error wording', async () => {
    const { device } = createDevice('default');
    const errorTriggers = [];
    device._state = { lastMode: 'idle', activeFaultCodes: new Set() };
    device._flow = {
        feederStatusChanged: { trigger: async () => {} },
        feederError: { trigger: async (...args) => errorTriggers.push(args) }
    };
    device.hasCapability = (capability) => capability === 'petfeeder_status_mode';
    device.getCapabilityValue = () => false;
    device._setCap = async () => {};

    await device._updateStatusMode({
        error: { code: 0, value: 0 },
        food_stuck_status: { code: 0, value: 0 },
        food_out_status: { code: 0, value: 1 }
    });

    assert.deepEqual(errorTriggers[0].slice(1), [
        { error: 'Food out', error_code: 'food_out' },
        {}
    ]);
});

test('IV2001 diagnostics include every raw device fault status', () => {
    const { device, logs } = createDevice();
    device._state = { lastDiagnosticSignature: undefined, lastDiagnosticLogAt: 0 };
    device.getSetting = () => 10;
    const entry = (siid, piid, value) => ({ code: 0, value, siid, piid });

    device._logIv2001Diagnostics({
        error: entry(2, 1, 0),
        foodlevel: entry(2, 6, 0),
        food_stuck_status: entry(2, 10, 0),
        food_out_status: entry(2, 11, 1),
        heap_status: entry(2, 15, 0),
        bowl_weight_sample: entry(2, 22, 0),
        bowl_level_status: entry(2, 31, 0)
    });

    const summary = logs[0][1];
    assert.match(summary, /device_fault@2\/1\{code=0,value=0\}/);
    assert.match(summary, /food_stuck_status@2\/10\{code=0,value=0\}/);
    assert.match(summary, /food_bowl_error_status@2\/11\{code=0,value=1\}/);
    assert.match(summary, /food_heap_status@2\/15\{code=0,value=0\}/);
});

test('IV2001 applies bowl-error labels without changing published capability value IDs', async () => {
    const { device } = createDevice();
    const calls = [];
    device.hasCapability = () => true;
    device.setCapabilityOptions = async (...args) => calls.push(args);

    await device._applyIv2001CapabilityOptions();

    assert.deepEqual(calls, [
        ['petfeeder_food_out_status', {
            title: { en: 'Food bowl status' },
            values: [
                { id: 'ok', title: { en: 'OK' } },
                { id: 'food_out', title: { en: 'Food bowl error' } }
            ]
        }],
        ['alarm_petfeeder_food_out', { title: { en: 'Food bowl error' } }]
    ]);
});

test('legacy feeders keep shared food-out capability options', async () => {
    const { device } = createDevice('default');
    let called = false;
    device.hasCapability = () => true;
    device.setCapabilityOptions = async () => {
        called = true;
    };

    await device._applyIv2001CapabilityOptions();

    assert.equal(called, false);
});

test('feeder Flow triggers explain status and expose the existing fault alarm without the generic Mode card', () => {
    const root = path.join(__dirname, '..');
    const errorCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/triggers/feeder_error.json'), 'utf8'));
    const statusCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/triggers/feeder_status_changed.json'), 'utf8'));
    const genericModeCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/triggers/triggerModeChanged.json'), 'utf8'));
    const deviceSource = fs.readFileSync(path.join(root, 'drivers/petfeeder_mmgg_miot/device.js'), 'utf8');

    assert.equal(errorCard.title.en, 'Feeder error detected');
    assert.equal(errorCard.args[0].filter, 'driver_id=petfeeder_mmgg_miot&capabilities=alarm_petfeeder_fault');
    assert.deepEqual(errorCard.tokens.map((token) => token.name), ['error', 'error_code']);
    assert.match(errorCard.hint.en, /each newly reported feeder fault/);
    assert.match(errorCard.hint.en, /food bowl error/);
    assert.match(errorCard.hint.en, /error code food_out/);
    assert.match(statusCard.hint.en, /Idle, Feeding, and Fault/);
    assert.match(statusCard.hint.en, /food bowl error/);
    assert.doesNotMatch(genericModeCard.args[0].filter, /petfeeder_mmgg_miot/);
    assert.match(genericModeCard.hint.en, /separate Feeder status changed card/);
    assert.ok(deviceSource.includes("feederError: this.homey.flow.getDeviceTriggerCard('feeder_error')"));
});

test('new Flow cards are IV2001-scoped and leave the published servings card intact', () => {
    const root = path.join(__dirname, '..');
    const gramsCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/actions/petfeederDispenseGrams.json'), 'utf8'));
    const resetCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/actions/petfeederResetDesiccantLife.json'), 'utf8'));
    const servingsCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/actions/petfeederServeFood.json'), 'utf8'));
    const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    assert.equal(gramsCard.titleFormatted.en, 'Dispense [[grams]] g');
    assert.deepEqual(gramsCard.args[0], {
        name: 'grams',
        title: { en: 'Grams' },
        type: 'number',
        placeholder: { en: 'Grams' },
        min: 10,
        max: 150,
        step: 10
    });
    assert.match(gramsCard.hint.en, /10 g portions/);
    assert.equal(
        gramsCard.args[1].filter,
        'driver_id=petfeeder_mmgg_miot&capabilities=petfeeder_screen_display_mode'
    );
    assert.equal(resetCard.title.en, 'Reset desiccant replacement status');
    assert.equal(resetCard.args.length, 1);
    assert.equal(
        resetCard.args[0].filter,
        'driver_id=petfeeder_mmgg_miot&capabilities=petfeeder_screen_display_mode'
    );
    assert.equal(servingsCard.args[0].name, 'servings');
    assert.equal(servingsCard.args[0].max, 30);
    assert.equal((appSource.match(/getActionCard\('petfeederDispenseGrams'\)/g) || []).length, 1);
    assert.ok(appSource.includes('args.device.dispenseGrams(args.grams)'));
    assert.equal((appSource.match(/getActionCard\('petfeederResetDesiccantLife'\)/g) || []).length, 1);
    assert.ok(appSource.includes('args.device.resetDesiccantLife()'));
});

test('calibration Flow card is IV2001-scoped and explains the empty-bowl requirement', () => {
    const root = path.join(__dirname, '..');
    const calibrateCard = JSON.parse(fs.readFileSync(path.join(root, '.homeycompose/flow/actions/petfeederCalibrate.json'), 'utf8'));

    assert.equal(
        calibrateCard.args[0].filter,
        'driver_id=petfeeder_mmgg_miot&capabilities=petfeeder_screen_display_mode'
    );
    assert.match(calibrateCard.hint.en, /Empty the food bowl/);
});
