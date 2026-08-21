'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const originalModuleLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {} };
    return originalModuleLoad.call(this, request, parent, isMain);
};

require('../drivers/wifi_device.js');
const VacuumDevice = require('../drivers/vacuum_xiaomi_vacuum_max/device.js');
Module._load = originalModuleLoad;

const SUPPORTED_MODELS = ['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl', 'xiaomi.vacuum.ov51gl'];
const CATALOG_PROPERTY = [{ did: 'user_define_sweep_cfg', siid: 2, piid: 42 }];
const OBSERVED_IDS = [2070144007, 916380672];

function catalogResult(value, overrides = {}) {
    return [{ siid: 2, piid: 42, code: 0, value, ...overrides }];
}

function createStartDevice({
    actualModel = 'xiaomi.vacuum.d109gl',
    actionHandler = async () => ({ code: 0 }),
    connected = true,
    propertyHandler = async () => catalogResult([{ id: OBSERVED_IDS[0], name: 'Kitchen' }, { id: OBSERVED_IDS[1] }])
} = {}) {
    const actionCalls = [];
    const errors = [];
    const logs = [];
    const propertyCalls = [];
    let queueCalls = 0;
    const card = {
        registerArgumentAutocompleteListener: (name, listener) => {
            card.autocompleteName = name;
            card.autocomplete = listener;
        },
        registerRunListener: (listener) => {
            card.run = listener;
        }
    };
    const device = Object.create(VacuumDevice.prototype);
    device.homey = {
        flow: {
            getActionCard: (id) => {
                assert.equal(id, 'start_custom_cleanup_plan');
                return card;
            }
        }
    };
    device._getDeviceModel = () => actualModel;
    device._queuePropertyOperation = async (operation) => {
        queueCalls += 1;
        return operation();
    };
    device.callMiotGetProperties = async (definitions, options) => {
        propertyCalls.push({ definitions, options });
        return propertyHandler(definitions, options);
    };
    device.miio = connected ? {
        call: async (method, action, options) => {
            actionCalls.push({ method, action, options });
            return actionHandler(method, action, options);
        }
    } : null;
    device.error = (message) => errors.push(String(message));
    device.log = (message) => logs.push(String(message));
    device._registerCustomCleanupStartFlowListener();
    return {
        actionCalls,
        card,
        device,
        errors,
        logs,
        propertyCalls,
        queueCalls: () => queueCalls
    };
}

test('Custom cleanup start Compose action has the exact autocomplete-only contract', () => {
    const compose = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'drivers', 'vacuum_xiaomi_vacuum_max', 'driver.flow.compose.json'), 'utf8'));
    const action = compose.actions.find((item) => item.id === 'start_custom_cleanup_plan');

    assert.deepEqual(action, {
        id: 'start_custom_cleanup_plan',
        title: { en: 'Start Xiaomi Home Custom cleanup plan' },
        titleFormatted: { en: 'Start Xiaomi Home Custom cleanup plan [[plan]]' },
        args: [{ name: 'plan', title: { en: 'Custom cleanup plan' }, type: 'autocomplete' }]
    });
    assert.equal(action.args.some((argument) => argument.name === 'device'), false);
});

test('Custom cleanup start registers both listeners and safely reports setup failures', () => {
    const registered = createStartDevice();
    assert.equal(registered.card.autocompleteName, 'plan');
    assert.equal(typeof registered.card.autocomplete, 'function');
    assert.equal(typeof registered.card.run, 'function');

    for (const failureStage of ['getActionCard', 'registerArgumentAutocompleteListener', 'registerRunListener']) {
        const errors = [];
        const setupError = Object.assign(new Error('Private Kitchen plan'), { code: 'ESETUP' });
        const device = Object.create(VacuumDevice.prototype);
        device.error = (message) => errors.push(String(message));
        device.homey = {
            flow: {
                getActionCard: () => {
                    if (failureStage === 'getActionCard') throw setupError;
                    return {
                        registerArgumentAutocompleteListener: () => {
                            if (failureStage === 'registerArgumentAutocompleteListener') throw setupError;
                        },
                        registerRunListener: () => {
                            if (failureStage === 'registerRunListener') throw setupError;
                        }
                    };
                }
            }
        };
        device._registerCustomCleanupStartFlowListener();
        assert.deepEqual(errors, ['[CUSTOM_CLEANUP_START] Failed to register start_custom_cleanup_plan: request failed (code: ESETUP)']);
        assert.doesNotMatch(errors.join('\n'), /Private Kitchen/i);
    }
});

test('autocomplete uses only the selected supported target and returns bounded, distinguishable plans', async () => {
    for (const model of SUPPORTED_MODELS) {
        const registering = createStartDevice({ actualModel: model });
        const target = createStartDevice({
            actualModel: model,
            propertyHandler: async () => catalogResult([
                { id: OBSERVED_IDS[0], name: '  Kitchen\u0001\n plan  ' },
                { id: OBSERVED_IDS[1], title: 'Kitchen plan' },
                { id: 20, label: 'x'.repeat(100) },
                { id: 21 }
            ])
        });

        const result = await registering.card.autocomplete('', { device: target.device });
        assert.deepEqual(result, [
            { id: '2070144007', name: 'Kitchen plan', description: 'Plan ID 2070144007' },
            { id: '916380672', name: 'Kitchen plan', description: 'Plan ID 916380672' },
            { id: '20', name: 'x'.repeat(80), description: 'Plan ID 20' },
            { id: '21', name: 'Custom cleanup 4', description: 'Plan ID 21' }
        ]);
        assert.equal(target.queueCalls(), 1);
        assert.deepEqual(target.propertyCalls, [{
            definitions: CATALOG_PROPERTY,
            options: {
                retries: 2,
                chunkSize: model === 'xiaomi.vacuum.d102gl' ? 1 : 5,
                delayMs: 100
            }
        }]);
        assert.deepEqual(target.actionCalls, []);
        assert.equal(registering.propertyCalls.length, 0, 'the registering device must not receive target I/O');
        assert.equal(registering.actionCalls.length, 0, 'the registering device must not receive target I/O');
        assert.doesNotMatch(target.errors.join('\n'), /Kitchen|plan/i);
    }
});

test('autocomplete filters safely by display name or full decimal ID', async () => {
    const target = createStartDevice();
    const byName = await target.card.autocomplete('kitCH', { device: target.device });
    const byId = await target.card.autocomplete('916380', { device: target.device });
    const tooLong = await target.card.autocomplete('x'.repeat(101), { device: target.device });

    assert.deepEqual(byName.map((plan) => plan.id), ['2070144007']);
    assert.deepEqual(byId.map((plan) => plan.id), ['916380672']);
    assert.deepEqual(tooLong, []);
});

test('autocomplete rejects non-live, unsupported, and disconnected targets before queueing', async () => {
    for (const settings of [
        { actualModel: 'xiaomi.vacuum.c102gl' },
        { actualModel: null },
        { connected: false }
    ]) {
        const target = createStartDevice(settings);
        target.device._model = 'xiaomi.vacuum.d109gl';
        target.device.getStoreValue = () => 'xiaomi.vacuum.d109gl';
        await assert.rejects(target.card.autocomplete('', { device: target.device }), /supported live vacuum model|not connected/i);
        assert.equal(target.queueCalls(), 0);
        assert.deepEqual(target.propertyCalls, []);
    }

    const throwing = createStartDevice();
    throwing.device._getDeviceModel = () => {
        throw new Error('Private model error');
    };
    await assert.rejects(throwing.card.autocomplete('', { device: throwing.device }), /supported live vacuum model/i);
    assert.equal(throwing.queueCalls(), 0);
});

test('plan extraction preserves the diagnostic ID wrapper and never invokes accessors or inherited values', () => {
    const { device } = createStartDevice();
    const inherited = Object.create({ id: 12, name: 'Inherited plan' });
    inherited.type = 'ignored';
    const accessor = {};
    let accessorReads = 0;
    Object.defineProperty(accessor, 'id', {
        enumerable: true,
        get: () => {
            accessorReads += 1;
            return 13;
        }
    });
    const accessorName = { id: 14 };
    Object.defineProperty(accessorName, 'name', {
        enumerable: true,
        get: () => {
            accessorReads += 1;
            return 'Private plan';
        }
    });
    const plans = device._extractCustomCleanupPlans(catalogResult([
        { id: OBSERVED_IDS[0], name: 'Direct plan', nested: { id: 99 } },
        inherited,
        accessor,
        accessorName,
        { id: OBSERVED_IDS[1], other: 'First safe string' },
        { id: 0 },
        { id: 0x100000000 }
    ]));

    assert.deepEqual(plans, [
        { id: OBSERVED_IDS[0], name: 'Direct plan' },
        { id: 14, name: 'Custom cleanup 2' },
        { id: OBSERVED_IDS[1], name: 'First safe string' }
    ]);
    assert.deepEqual(device._extractCustomCleanupDiagnosticPlanIds(catalogResult(plans.map((plan) => ({ id: plan.id })))), [OBSERVED_IDS[0], 14, OBSERVED_IDS[1]]);
    assert.equal(accessorReads, 0);

    const tooManyRecords = Array.from({ length: 33 }, () => ({}));
    tooManyRecords[32] = { id: 123 };
    assert.deepEqual(device._extractCustomCleanupPlans(catalogResult(tooManyRecords)), []);
});

test('run rejects every malformed autocomplete plan before queueing or I/O', async () => {
    const invalidPlans = [
        undefined, null, '2070144007', {}, { id: undefined }, { id: null }, { id: '' }, { id: ' 2070144007' },
        { id: '+2070144007' }, { id: '2070144007.0' }, { id: '2e9' }, { id: '02070144007' }, { id: '0' },
        { id: '4294967296' }, { id: Number.MAX_SAFE_INTEGER + 1 }, { id: 1.5 }, { id: 0 }, { id: -1 }
    ];
    for (const plan of invalidPlans) {
        const target = createStartDevice();
        await assert.rejects(target.card.run({ device: target.device, plan }), /Select a valid Custom cleanup plan/);
        assert.equal(target.queueCalls(), 0);
        assert.deepEqual(target.propertyCalls, []);
        assert.deepEqual(target.actionCalls, []);
    }
});

test('run refreshes and starts an exact selected full uint32 plan inside one queue slot', async () => {
    for (const planId of [1, OBSERVED_IDS[0], OBSERVED_IDS[1], 0xFFFFFFFF]) {
        const callOrder = [];
        const target = createStartDevice({
            propertyHandler: async () => {
                callOrder.push('catalog');
                return catalogResult([{ id: planId, name: 'Private plan name' }]);
            },
            actionHandler: async () => {
                callOrder.push('action');
                return { code: 0 };
            }
        });
        await assert.deepEqual(await target.card.run({ device: target.device, plan: { id: String(planId), name: 'ignored client label' } }), { code: 0 });
        assert.equal(target.queueCalls(), 1);
        assert.deepEqual(callOrder, ['catalog', 'action']);
        assert.deepEqual(target.propertyCalls[0], {
            definitions: CATALOG_PROPERTY,
            options: { retries: 2, chunkSize: 5, delayMs: 100 }
        });
        assert.deepEqual(target.actionCalls, [{
            method: 'action',
            action: { did: 'call-2-42', siid: 2, aiid: 42, in: [{ piid: 43, value: planId }] },
            options: { retries: 1 }
        }]);
        assert.doesNotMatch(target.errors.join('\n'), /Private plan name|ignored client label/i);
    }
});

test('run uses the live model chunk size for every supported model and preserves numeric autocomplete IDs', async () => {
    for (const { model, planId, selectedId, chunkSize } of [
        { model: 'xiaomi.vacuum.d102gl', planId: OBSERVED_IDS[0], selectedId: String(OBSERVED_IDS[0]), chunkSize: 1 },
        { model: 'xiaomi.vacuum.d109gl', planId: OBSERVED_IDS[1], selectedId: OBSERVED_IDS[1], chunkSize: 5 },
        { model: 'xiaomi.vacuum.ov51gl', planId: 0xFFFFFFFF, selectedId: String(0xFFFFFFFF), chunkSize: 5 }
    ]) {
        const target = createStartDevice({
            actualModel: model,
            propertyHandler: async () => catalogResult([{ id: planId, name: 'Private plan' }])
        });
        await target.card.run({ device: target.device, plan: { id: selectedId } });
        assert.deepEqual(target.propertyCalls[0].options, { retries: 2, chunkSize, delayMs: 100 });
        assert.equal(target.actionCalls[0].action.in[0].value, planId);
    }
});

test('run rejects stale, malformed, unsupported, disconnected, and missing-helper targets without starting', async () => {
    const stale = createStartDevice({ propertyHandler: async () => catalogResult([{ id: 2, name: 'Replacement private plan' }]) });
    await assert.rejects(stale.card.run({ device: stale.device, plan: { id: String(OBSERVED_IDS[0]) } }), /no longer available.*select the plan again/i);
    assert.deepEqual(stale.actionCalls, []);

    const malformed = createStartDevice({ propertyHandler: async () => catalogResult({ unexpected: true }) });
    await assert.rejects(malformed.card.run({ device: malformed.device, plan: { id: String(OBSERVED_IDS[0]) } }), /no longer available/i);
    assert.deepEqual(malformed.actionCalls, []);

    for (const settings of [
        { actualModel: 'xiaomi.vacuum.c102gl' },
        { actualModel: null },
        { connected: false }
    ]) {
        const target = createStartDevice(settings);
        await assert.rejects(target.card.run({ device: target.device, plan: { id: String(OBSERVED_IDS[0]) } }), /supported live vacuum model|not connected/i);
        assert.equal(target.queueCalls(), 0);
        assert.deepEqual(target.actionCalls, []);
    }

    const helperMissing = createStartDevice();
    helperMissing.device.callMiotGetProperties = undefined;
    await assert.rejects(helperMissing.card.run({ device: helperMissing.device, plan: { id: String(OBSERVED_IDS[0]) } }), /does not support/i);
    assert.equal(helperMissing.queueCalls(), 0);
    assert.deepEqual(helperMissing.actionCalls, []);

    const extractorMissing = createStartDevice();
    extractorMissing.device._extractCustomCleanupPlans = undefined;
    await assert.rejects(extractorMissing.card.run({ device: extractorMissing.device, plan: { id: String(OBSERVED_IDS[0]) } }), /does not support/i);
    assert.equal(extractorMissing.queueCalls(), 0);
    assert.deepEqual(extractorMissing.actionCalls, []);
});

test('catalog and action failures remain bounded and never log plan names or raw errors', async () => {
    const catalogError = Object.assign(new Error('token=secret; Kitchen private plan'), { code: 'ECATALOG' });
    const catalogFailure = createStartDevice({ propertyHandler: async () => { throw catalogError; } });
    await assert.rejects(catalogFailure.card.run({ device: catalogFailure.device, plan: { id: String(OBSERVED_IDS[0]) } }), /Could not refresh Custom cleanup plans/);
    assert.deepEqual(catalogFailure.actionCalls, []);
    assert.match(catalogFailure.errors.join('\n'), /request failed \(code: ECATALOG\)/);
    assert.doesNotMatch(catalogFailure.errors.join('\n'), /secret|Kitchen|plan/i);

    const actionError = Object.assign(new Error('Bedroom special plan body'), { code: 'EACTION' });
    const actionFailure = createStartDevice({ actionHandler: async () => { throw actionError; } });
    await assert.rejects(actionFailure.card.run({ device: actionFailure.device, plan: { id: String(OBSERVED_IDS[0]) } }), /Could not start Custom cleanup plan ID 2070144007/);
    assert.equal(actionFailure.actionCalls.length, 1);
    assert.match(actionFailure.errors.join('\n'), /request failed \(code: EACTION\)/);
    assert.doesNotMatch(actionFailure.errors.join('\n'), /Bedroom|special plan body/i);

    const nonThrowingFailure = createStartDevice({ actionHandler: async () => ({ code: -1, name: 'Kitchen response name' }) });
    await assert.rejects(nonThrowingFailure.card.run({ device: nonThrowingFailure.device, plan: { id: String(OBSERVED_IDS[0]) } }), /Could not start Custom cleanup plan ID 2070144007/);
    assert.equal(nonThrowingFailure.actionCalls.length, 1);
    assert.match(nonThrowingFailure.errors.join('\n'), /request failed \(code: -1\)/);
    assert.doesNotMatch(nonThrowingFailure.errors.join('\n'), /Kitchen|response name/i);
});

test('the start action contains no id-zero fallback or other mutating command', () => {
    const source = fs.readFileSync(require.resolve('../drivers/vacuum_xiaomi_vacuum_max/device.js'), 'utf8');
    const actionStart = source.indexOf('const CUSTOM_CLEANUP_START_ACTION');
    const actionEnd = source.indexOf('\nconst CUSTOM_CLEANUP_DIAGNOSTIC_SAFE_KEYS', actionStart);
    const actionSource = source.slice(actionStart, actionEnd);
    const methodStart = source.indexOf('_registerCustomCleanupStartFlowListener()');
    const methodEnd = source.indexOf('\n    _registerCustomCleanupDiagnosticFlowListener()', methodStart);
    const methodSource = source.slice(methodStart, methodEnd);

    assert.match(actionSource, /did: 'call-2-42'/);
    assert.match(actionSource, /aiid: 42/);
    assert.doesNotMatch(methodSource, /\[0\]|set_properties|callVacuumSetProperties|call-2-(?:38|39|40|41)/);
});
