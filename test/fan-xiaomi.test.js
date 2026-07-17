'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const engine = require('../lib/fans-xiaomi/engine.js');
const { MODELS, DEFAULT } = require('../lib/fans-xiaomi/models.js');
const { WRITERS, READERS, fanLevelOptions } = require('../lib/fans-xiaomi/features.js');

const fanlevelWriter = WRITERS.find((w) => w.cap === 'fan_xiaomi_fanlevel');
const fanlevelReader = READERS.find((r) => r.cap === 'fan_xiaomi_fanlevel');

/**
 * Minimal in-memory stand-in for a Homey device, enough to exercise the engine
 * without the Homey runtime. Records capability values, options, settings and
 * fired triggers so tests can assert on them.
 */
function createMockDevice({ capabilities = [], miioCall } = {}) {
    const caps = new Set(capabilities);
    const capabilityValues = {};
    const capabilityOptions = {};
    const settingValues = {};
    const triggered = [];

    return {
        _capabilityValues: capabilityValues,
        _capabilityOptions: capabilityOptions,
        _settingValues: settingValues,
        _triggered: triggered,
        hasCapability: (cap) => caps.has(cap),
        getCapabilityValue: (cap) => (cap in capabilityValues ? capabilityValues[cap] : null),
        updateCapabilityValue: async (cap, value) => { capabilityValues[cap] = value; },
        getCapabilityOptions: (cap) => {
            if (!(cap in capabilityOptions)) throw new Error(`no options for ${cap}`);
            return capabilityOptions[cap];
        },
        setCapabilityOptions: async (cap, options) => { capabilityOptions[cap] = options; },
        addCapability: async (cap) => { caps.add(cap); },
        removeCapability: async (cap) => { caps.delete(cap); },
        updateSettingValue: async (setting, value) => { settingValues[setting] = value; },
        error: () => {},
        log: () => {},
        homey: {
            flow: {
                getDeviceTriggerCard: (card) => ({
                    trigger: async (_device, tokens) => { triggered.push({ card, tokens }); }
                })
            }
        },
        miio: miioCall ? { call: miioCall } : undefined
    };
}

test('every model descriptor is structurally consistent', () => {
    const descriptors = [...Object.entries(MODELS), ['DEFAULT', DEFAULT]];
    for (const [id, desc] of descriptors) {
        assert.ok(desc.props && typeof desc.props === 'object', `${id} declares props`);

        // A property and its enum/range list must appear together.
        assert.equal('fan_level' in desc.props, Array.isArray(desc.fanLevels), `${id}: fan_level ⇔ fanLevels`);
        assert.equal('mode' in desc.props, Array.isArray(desc.modes), `${id}: mode ⇔ modes`);
        assert.equal('swing_h_angle' in desc.props, Array.isArray(desc.horizontalAngles), `${id}: swing_h_angle ⇔ horizontalAngles`);
        assert.equal('swing_v_angle' in desc.props, Array.isArray(desc.verticalAngles), `${id}: swing_v_angle ⇔ verticalAngles`);

        if (desc.fanLevels) {
            assert.ok(desc.fanLevels.length > 0, `${id}: fanLevels not empty`);
            assert.ok(desc.fanLevels.every(Number.isFinite), `${id}: fanLevels are numbers`);
        }
        for (const list of ['modes', 'horizontalAngles', 'verticalAngles']) {
            if (desc[list]) assert.ok(desc[list].every(Number.isFinite), `${id}: ${list} are numbers`);
        }
        // Every MIOT prop entry carries a numeric siid/piid.
        for (const [key, prop] of Object.entries(desc.props)) {
            assert.equal(typeof prop.siid, 'number', `${id}.${key}.siid`);
            assert.equal(typeof prop.piid, 'number', `${id}.${key}.piid`);
        }
    }
});

test('unknown models resolve to the generic fallback descriptor', () => {
    const desc = engine.resolve('xiaomi.fan.does-not-exist');
    assert.equal(desc.fallback, true);
    assert.ok(desc.props, 'fallback descriptor is usable');
});

test('resolve maps the p69/p76 aliases onto the same descriptor as p70', () => {
    const p70 = engine.resolve('xiaomi.fan.p70');
    assert.deepEqual(engine.resolve('xiaomi.fan.p69').fanLevels, p70.fanLevels);
    assert.deepEqual(engine.resolve('xiaomi.fan.p76').fanLevels, p70.fanLevels);
});

test('fan levels normalize to a 1-based UI regardless of the device base', () => {
    const zeroBased = { fanLevels: [0, 1, 2, 3] };
    const oneBased = { fanLevels: [1, 2, 3, 4] };

    // A zero-based device is shifted up so the UI still starts at 1...
    assert.deepEqual(fanLevelOptions(zeroBased).map((o) => o.id), ['1', '2', '3', '4']);
    // ...and a one-based device is left as-is — it must NOT drift to [2,3,4,5].
    assert.deepEqual(fanLevelOptions(oneBased).map((o) => o.id), ['1', '2', '3', '4']);

    // Zero-based: UI 1 ↔ device 0.
    assert.equal(fanlevelWriter.encode('1', zeroBased), 0);
    assert.equal(fanlevelReader.decode(0, zeroBased), '1');
    // One-based: UI 1 ↔ device 1 (no offset).
    assert.equal(fanlevelWriter.encode('1', oneBased), 1);
    assert.equal(fanlevelReader.decode(1, oneBased), '1');

    // encode/decode round-trips for both conventions.
    for (const desc of [zeroBased, oneBased]) {
        for (const opt of fanLevelOptions(desc)) {
            assert.equal(fanlevelReader.decode(fanlevelWriter.encode(opt.id, desc), desc), opt.id);
        }
    }
});

test('desiredCapabilities is derived from the declared props', () => {
    // A prop switches its capability on; an absent prop leaves it off.
    const withVertical = engine.desiredCapabilities({
        props: { power: { siid: 2, piid: 1 }, swing_v: { siid: 2, piid: 8 }, swing_v_angle: { siid: 2, piid: 9 } }
    });
    assert.ok(withVertical.includes('onoff'));
    assert.ok(withVertical.includes('fan_xiaomi_vertical_swing'));
    assert.ok(withVertical.includes('fan_xiaomi_vertical_angle'));

    const withoutVertical = engine.desiredCapabilities({ props: { power: { siid: 2, piid: 1 } } });
    assert.ok(withoutVertical.includes('onoff'));
    assert.ok(!withoutVertical.includes('fan_xiaomi_vertical_swing'));
    assert.ok(!withoutVertical.includes('fan_xiaomi_vertical_angle'));
});

test('buildGetProperties only requests declared props', () => {
    const desc = { props: { power: { siid: 2, piid: 1 }, mode: { siid: 2, piid: 3 } } };
    const entries = engine.buildGetProperties(desc);
    const dids = entries.map((e) => e.did).sort();

    assert.deepEqual(dids, ['mode', 'power'], 'only declared props are requested');
    for (const entry of entries) {
        assert.equal(entry.siid, desc.props[entry.did].siid);
        assert.equal(entry.piid, desc.props[entry.did].piid);
    }
});

test('the first observation seeds the cache without firing a trigger', async () => {
    const device = createMockDevice({ capabilities: ['fan_xiaomi_mode'] });
    const desc = engine.resolve('xiaomi.fan.p70');

    await engine.pollAndUpdate(device, desc, [{ did: 'mode', value: 0, code: 0 }]);
    assert.equal(device._capabilityValues['fan_xiaomi_mode'], '0');
    assert.equal(device._triggered.length, 0, 'no trigger on first observation');

    // Same value again: still no trigger.
    await engine.pollAndUpdate(device, desc, [{ did: 'mode', value: 0, code: 0 }]);
    assert.equal(device._triggered.length, 0);
});

test('a physical change between polls fires exactly one trigger', async () => {
    const device = createMockDevice({ capabilities: ['fan_xiaomi_horizontal_angle'] });
    const desc = engine.resolve('xiaomi.fan.p70');

    await engine.pollAndUpdate(device, desc, [{ did: 'swing_h_angle', value: 30, code: 0 }]); // seed
    await engine.pollAndUpdate(device, desc, [{ did: 'swing_h_angle', value: 60, code: 0 }]); // change

    assert.equal(device._triggered.length, 1);
    const fired = device._triggered[0];
    assert.equal(fired.card, 'xiaomiHorizontalAngleChanged');
    // [5]: angle tokens are numeric, not "60°" strings.
    assert.equal(typeof fired.tokens.new_angle, 'number');
    assert.equal(fired.tokens.new_angle, 60);
    assert.equal(fired.tokens.previous_angle, 30);
});

test('a Homey-initiated change is still detected (cache, not capability value)', async () => {
    const device = createMockDevice({ capabilities: ['fan_xiaomi_mode'] });
    const desc = engine.resolve('xiaomi.fan.p70');

    await engine.pollAndUpdate(device, desc, [{ did: 'mode', value: 0, code: 0 }]); // seed at 0
    assert.equal(device._triggered.length, 0);

    // Homey optimistically set the capability when the user/Flow changed it.
    device._capabilityValues['fan_xiaomi_mode'] = '1';

    // The confirming poll must still fire, because the comparison is against the
    // last observed device value (0), not the already-updated capability value.
    await engine.pollAndUpdate(device, desc, [{ did: 'mode', value: 1, code: 0 }]);
    assert.equal(device._triggered.length, 1);
    assert.equal(device._triggered[0].card, 'xiaomiModeChanged');
});

test('invalid MIoT entries are skipped and never update state or fire', async () => {
    const caps = ['fan_xiaomi_mode', 'fan_xiaomi_fanlevel', 'fan_xiaomi_horizontal_angle', 'fan_speed'];
    const device = createMockDevice({ capabilities: caps });
    const desc = engine.resolve('xiaomi.fan.p70');

    // Seed with valid values.
    await engine.pollAndUpdate(device, desc, [
        { did: 'mode', value: 0, code: 0 },
        { did: 'fan_level', value: 0, code: 0 },
        { did: 'swing_h_angle', value: 30, code: 0 },
        { did: 'fan_speed', value: 50, code: 0 }
    ]);
    const seeded = { ...device._capabilityValues };
    assert.equal(device._triggered.length, 0);

    // A batch of invalid observations: out-of-descriptor, null, error code, non-finite.
    await engine.pollAndUpdate(device, desc, [
        { did: 'mode', value: 99, code: 0 },            // 99 ∉ modes
        { did: 'fan_level', value: null, code: 0 },     // null value
        { did: 'swing_h_angle', value: 60, code: -4004 }, // device error code
        { did: 'fan_speed', value: 'nope', code: 0 }    // non-finite
    ]);

    assert.deepEqual(device._capabilityValues, seeded, 'no capability changed by invalid reads');
    assert.equal(device._triggered.length, 0, 'no trigger from invalid reads');
});

test('applyCapabilityOptions does not re-set unchanged options', async () => {
    const caps = ['fan_xiaomi_mode', 'fan_xiaomi_fanlevel', 'fan_xiaomi_horizontal_angle', 'fan_xiaomi_vertical_angle'];
    const device = createMockDevice({ capabilities: caps });
    const desc = engine.resolve('xiaomi.fan.p70');

    let setCount = 0;
    const realSet = device.setCapabilityOptions;
    device.setCapabilityOptions = async (cap, options) => { setCount += 1; return realSet(cap, options); };

    await engine.applyCapabilityOptions(device, desc);
    const firstPass = setCount;
    assert.ok(firstPass > 0, 'options written on first apply');

    await engine.applyCapabilityOptions(device, desc);
    assert.equal(setCount, firstPass, 'second apply is a no-op (options unchanged)');
});

test('regular and immediate polls run serialized on one queue', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order = [];
    let calls = 0;

    const miioCall = async () => {
        const id = ++calls;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`start${id}`);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        order.push(`end${id}`);
        inFlight -= 1;
        return [{ did: 'power', value: true, code: 0 }];
    };

    const device = createMockDevice({ capabilities: ['onoff'], miioCall });
    const desc = engine.resolve('xiaomi.fan.p70');

    // Kick off a regular poll and an immediate poll "at the same time".
    await Promise.all([engine.poll(device, desc), engine.immediatePollAndUpdate(device, desc)]);

    assert.equal(maxInFlight, 1, 'polls must never overlap');
    assert.deepEqual(order, ['start1', 'end1', 'start2', 'end2'], 'polls complete in order');
});
