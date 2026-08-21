'use strict';

const fs = require('node:fs');
const path = require('node:path');
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

const PROPERTY_DEFINITIONS = [
    { did: 'user_define_sweep_cfg', siid: 2, piid: 42 },
    { did: 'user_define_sweep_id', siid: 2, piid: 43 }
];
const GET_USER_DEFINE_ACTION = {
    did: 'call-20-2',
    siid: 20,
    aiid: 2,
    in: [{ piid: 2, value: 0 }]
};

function createFlow() {
    const actionListeners = {};
    return {
        actionListeners,
        flow: {
            getActionCard: (id) => ({
                registerRunListener: (listener) => {
                    actionListeners[id] = listener;
                }
            })
        }
    };
}

function createDiagnosticDevice({
    pairedModel = 'xiaomi.vacuum.d109gl',
    actualModel = pairedModel,
    propertyHandler = async () => [{ siid: 2, piid: 42, code: 0, value: '{}' }],
    actionHandler = async () => ({ code: 0, out: [] })
} = {}) {
    const { actionListeners, flow } = createFlow();
    const actionCalls = [];
    const logs = [];
    const propertyCalls = [];
    const device = Object.create(VacuumDevice.prototype);
    device._model = pairedModel;
    device.getModelIdentifier = () => pairedModel;
    device.homey = {
        flow,
        setTimeout: (callback) => {
            callback();
            return undefined;
        }
    };
    device.log = (message) => logs.push(String(message));
    device.error = (message) => logs.push(String(message));
    device.miio = {
        miioModel: actualModel,
        call: async (...args) => {
            actionCalls.push(args);
            return actionHandler(...args);
        }
    };
    device.callMiotGetProperties = async (definitions, options) => {
        propertyCalls.push({ definitions, options });
        return propertyHandler(definitions, options);
    };
    device._registerCustomCleanupDiagnosticFlowListener();

    return { actionCalls, device, listener: actionListeners.diagnose_custom_cleanup_plans, logs, propertyCalls };
}
async function flushMicrotasks(count = 4) {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
}

function catalogPropertyResult(value, { code = 0, piid = 42, siid = 2 } = {}) {
    return [{ siid, piid, code, value }];
}

function getUserDefineAction(id) {
    return {
        ...GET_USER_DEFINE_ACTION,
        in: [{ piid: 2, value: id }]
    };
}

function actionQueryIds(actionCalls) {
    return actionCalls.map(([, action]) => action.in[0].value);
}

async function assertNoDiagnosticIo(target, args, expectedError = /matching supported live/) {
    let queueCalls = 0;
    target.device._queuePropertyOperation = () => {
        queueCalls += 1;
        return Promise.resolve(true);
    };

    await assert.rejects(target.listener(args), expectedError);
    assert.equal(queueCalls, 0);
    assert.deepEqual(target.propertyCalls, []);
    assert.deepEqual(target.actionCalls, []);
}

test('custom cleanup diagnostic Compose action has the exact required expected-model dropdown contract', () => {
    const compose = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'drivers', 'vacuum_xiaomi_vacuum_max', 'driver.flow.compose.json'), 'utf8')
    );
    const action = compose.actions.find((item) => item.id === 'diagnose_custom_cleanup_plans');

    assert.ok(action);
    assert.match(action.title.en, /diagnos/i);
    assert.match(action.titleFormatted.en, /diagnos/i);
    assert.match(action.titleFormatted.en, /\[\[expected_model\]\]/);
    assert.equal(action.args.length, 1);
    assert.equal(action.args[0].name, 'expected_model');
    assert.equal(action.args[0].type, 'dropdown');
    assert.deepEqual(action.args[0].values, [
        { id: 'xiaomi.vacuum.d102gl', label: { en: 'Xiaomi Robot Vacuum X20 Pro' } },
        { id: 'xiaomi.vacuum.d109gl', label: { en: 'Xiaomi Robot Vacuum X20 Max' } },
        { id: 'xiaomi.vacuum.ov51gl', label: { en: 'Xiaomi Robot Vacuum H40' } }
    ]);
});

test('custom cleanup diagnostic registration keeps setup failures diagnostic-safe', () => {
    for (const setupStage of ['getActionCard', 'registerRunListener']) {
        const errors = [];
        const setupError = Object.assign(new Error('Living Room private plan'), { code: 'ESETUP' });
        const device = Object.create(VacuumDevice.prototype);
        device.homey = {
            flow: {
                getActionCard: () => {
                    if (setupStage === 'getActionCard') throw setupError;
                    return {
                        registerRunListener: () => {
                            throw setupError;
                        }
                    };
                }
            }
        };
        device.error = (message) => errors.push(String(message));

        device._registerCustomCleanupDiagnosticFlowListener();

        assert.deepEqual(errors, [
            '[CUSTOM_CLEANUP_DIAG] Failed to register diagnose_custom_cleanup_plans: request failed (code: ESETUP)'
        ]);
        assert.doesNotMatch(errors.join('\n'), /Living Room|private plan/i);
    }
});

test('custom cleanup diagnostic uses the target device and the exact safe read sequence for every compatible model', async () => {
    const models = ['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl', 'xiaomi.vacuum.ov51gl'];

    for (const model of models) {
        const registering = createDiagnosticDevice({ pairedModel: model, actualModel: model });
        const target = createDiagnosticDevice({ pairedModel: model, actualModel: model });
        assert.equal(await registering.listener({ device: target.device, expected_model: model }), true);
        assert.equal(target.propertyCalls.length, 1);
        assert.deepEqual(target.propertyCalls[0].definitions, PROPERTY_DEFINITIONS);
        assert.deepEqual(target.propertyCalls[0].options, {
            retries: 2,
            chunkSize: model === 'xiaomi.vacuum.d102gl' ? 1 : 5,
            delayMs: 100
        });
        assert.deepEqual(target.actionCalls, [['action', GET_USER_DEFINE_ACTION, { retries: 1 }]]);

        assert.equal(registering.propertyCalls.length, 0, 'the registering device must not receive diagnostic I/O');
        assert.equal(registering.actionCalls.length, 0, 'the registering device must not receive diagnostic I/O');
    }
});

test('custom cleanup diagnostic probes the observed Max catalog IDs in encounter order and never appends fallback id zero', async () => {
    const observedCatalog = [
        { id: 2070144007, name: 'Private program A', nested: { id: 800000001 } },
        { id: 916380672, name: 'Private program B', nested: { id: 800000002 } }
    ];
    const target = createDiagnosticDevice({
        propertyHandler: async () => [
            { siid: 2, piid: 43, code: 0, value: [{ id: 123456789 }] },
            { siid: 2, piid: 42, code: 0, value: observedCatalog }
        ],
        actionHandler: async () => ({ code: 0, out: JSON.stringify({ name: 'Private action output' }) })
    });

    assert.equal(await target.listener({ device: target.device, expected_model: 'xiaomi.vacuum.d109gl' }), true);
    assert.deepEqual(actionQueryIds(target.actionCalls), [2070144007, 916380672]);
    assert.deepEqual(target.actionCalls, [
        ['action', getUserDefineAction(2070144007), { retries: 1 }],
        ['action', getUserDefineAction(916380672), { retries: 1 }]
    ]);
    const output = target.logs.join('\n');
    assert.match(output, /catalog candidate IDs: 2070144007, 916380672/);
    assert.match(output, /get-user-define id 2070144007 result/);
    assert.match(output, /get-user-define id 916380672 result/);
    assert.doesNotMatch(output, /Private program|Private action output/i);
});

test('custom cleanup diagnostic extracts direct catalog record IDs from root arrays, direct object arrays, and one or two JSON encodings', () => {
    const records = [{ id: 2070144007 }, { id: 916380672 }];
    const variants = [
        records,
        { programs: records },
        JSON.stringify(records),
        JSON.stringify(JSON.stringify({ programs: records }))
    ];
    const { device } = createDiagnosticDevice();

    for (const value of variants) {
        assert.deepEqual(device._extractCustomCleanupDiagnosticPlanIds(catalogPropertyResult(value)), [2070144007, 916380672]);
    }
});

test('custom cleanup diagnostic deduplicates bounded uint32 candidates in encounter order', () => {
    const { device } = createDiagnosticDevice();
    const ids = [
        2070144007,
        916380672,
        2070144007,
        1,
        0xFFFFFFFF,
        31,
        32,
        33,
        34,
        35
    ];

    assert.deepEqual(
        device._extractCustomCleanupDiagnosticPlanIds(catalogPropertyResult(ids.map((id) => ({ id })))),
        [2070144007, 916380672, 1, 0xFFFFFFFF, 31, 32, 33, 34]
    );
});

test('custom cleanup diagnostic bounds top-level catalog fields, catalog arrays, and inspected records', () => {
    const { device } = createDiagnosticDevice();
    const tooManyTopLevelFields = {};
    for (let index = 0; index < 16; index += 1) tooManyTopLevelFields[`metadata_${index}`] = null;
    tooManyTopLevelFields.programs = [{ id: 700000001 }];
    assert.deepEqual(device._extractCustomCleanupDiagnosticPlanIds(catalogPropertyResult(tooManyTopLevelFields)), []);

    const tooManyCatalogArrays = {};
    for (let index = 0; index < 5; index += 1) tooManyCatalogArrays[`programs_${index}`] = [{ id: index + 1 }];
    assert.deepEqual(device._extractCustomCleanupDiagnosticPlanIds(catalogPropertyResult(tooManyCatalogArrays)), [1, 2, 3, 4]);

    const tooManyRecords = Array.from({ length: 33 }, () => ({}));
    tooManyRecords[32] = { id: 700000002 };
    assert.deepEqual(device._extractCustomCleanupDiagnosticPlanIds(catalogPropertyResult(tooManyRecords)), []);
});

test('custom cleanup diagnostic rejects non-direct, invalid, inherited, accessor, and non-catalog IDs without reading accessors', async () => {
    const inheritedIdRecord = Object.create({ id: 700000001 });
    inheritedIdRecord.type = 'inherited-id';
    const accessorIdRecord = {};
    let accessorReads = 0;
    Object.defineProperty(accessorIdRecord, 'id', {
        enumerable: true,
        get: () => {
            accessorReads += 1;
            return 700000002;
        }
    });
    const arrayRecord = [];
    arrayRecord.id = 700000003;
    const invalidRecords = [
        { id: 0 },
        { id: -1 },
        { id: 1.5 },
        { id: 0x100000000 },
        { id: '700000004' },
        { planId: 700000005 },
        { details: { id: 700000006 } },
        inheritedIdRecord,
        accessorIdRecord,
        arrayRecord
    ];
    const target = createDiagnosticDevice({
        propertyHandler: async () => catalogPropertyResult(invalidRecords)
    });

    assert.deepEqual(target.device._extractCustomCleanupDiagnosticPlanIds(catalogPropertyResult(invalidRecords)), []);
    assert.equal(await target.listener({ device: target.device, expected_model: 'xiaomi.vacuum.d109gl' }), true);
    assert.deepEqual(actionQueryIds(target.actionCalls), [0]);
    assert.equal(accessorReads, 0, 'neither extraction nor bounded diagnostic logging may invoke an id accessor');

    const validId = 700000007;
    for (const wrongPropertyResult of [
        catalogPropertyResult([{ id: validId }], { piid: 43 }),
        catalogPropertyResult([{ id: validId }], { siid: 3 }),
        catalogPropertyResult([{ id: validId }], { code: 1 })
    ]) {
        assert.deepEqual(target.device._extractCustomCleanupDiagnosticPlanIds(wrongPropertyResult), []);
    }
});

test('custom cleanup diagnostic rejects every invalid selector and every live-model mismatch before queue or I/O', async () => {
    const supportedModels = ['xiaomi.vacuum.d102gl', 'xiaomi.vacuum.d109gl', 'xiaomi.vacuum.ov51gl'];
    const invalidSelectors = [
        undefined,
        null,
        42,
        {},
        'xiaomi.vacuum.c102gl',
        'xiaomi.vacuum.d102',
        'unknown.model',
        'XIAOMI.VACUUM.D109GL',
        ' xiaomi.vacuum.d109gl',
        'xiaomi.vacuum.d109gl '
    ];

    for (const expectedModel of invalidSelectors) {
        const target = createDiagnosticDevice({ actualModel: 'xiaomi.vacuum.d109gl' });
        await assertNoDiagnosticIo(target, { device: target.device, expected_model: expectedModel });
    }

    const missingSelector = createDiagnosticDevice({ actualModel: 'xiaomi.vacuum.d109gl' });
    await assertNoDiagnosticIo(missingSelector, { device: missingSelector.device });

    for (const actualModel of supportedModels) {
        for (const expectedModel of supportedModels) {
            if (actualModel === expectedModel) continue;
            const target = createDiagnosticDevice({ actualModel });
            await assertNoDiagnosticIo(target, { device: target.device, expected_model: expectedModel });
        }
    }
});

test('custom cleanup diagnostic trusts only live metadata and rejects unavailable live metadata or connection before I/O', async () => {
    const missingDevice = createDiagnosticDevice();
    await assert.rejects(missingDevice.listener({ expected_model: 'xiaomi.vacuum.d109gl' }), /target vacuum/);
    assert.deepEqual(missingDevice.propertyCalls, []);
    assert.deepEqual(missingDevice.actionCalls, []);

    const noLiveModel = createDiagnosticDevice({ pairedModel: 'xiaomi.vacuum.d109gl', actualModel: null });
    noLiveModel.device.getStoreValue = () => 'xiaomi.vacuum.d109gl';
    await assertNoDiagnosticIo(noLiveModel, { device: noLiveModel.device, expected_model: 'xiaomi.vacuum.d109gl' });

    for (const actualModel of ['xiaomi.vacuum.c102gl', 'xiaomi.vacuum.d102', 'unknown.model']) {
        const unsupportedLiveModel = createDiagnosticDevice({ pairedModel: 'xiaomi.vacuum.d109gl', actualModel });
        unsupportedLiveModel.device.getStoreValue = () => 'xiaomi.vacuum.d109gl';
        await assertNoDiagnosticIo(unsupportedLiveModel, { device: unsupportedLiveModel.device, expected_model: 'xiaomi.vacuum.d109gl' });
    }

    const throwingLiveModel = createDiagnosticDevice({ actualModel: 'xiaomi.vacuum.d109gl' });
    throwingLiveModel.device._getDeviceModel = () => {
        throw new Error('live metadata unavailable');
    };
    await assertNoDiagnosticIo(throwingLiveModel, { device: throwingLiveModel.device, expected_model: 'xiaomi.vacuum.d109gl' });

    const disconnected = createDiagnosticDevice({ actualModel: 'xiaomi.vacuum.d109gl' });
    disconnected.device.miio.call = undefined;
    await assertNoDiagnosticIo(disconnected, { device: disconnected.device, expected_model: 'xiaomi.vacuum.d109gl' }, /not connected/);
});

test('custom cleanup diagnostic ignores stored models and has no paired-model persistence path', async () => {
    const unsupportedStoredModel = createDiagnosticDevice({ pairedModel: 'xiaomi.vacuum.c102gl', actualModel: 'xiaomi.vacuum.d109gl' });
    unsupportedStoredModel.device.getStoreValue = () => 'xiaomi.vacuum.c102gl';
    unsupportedStoredModel.device.setStoreValue = () => {
        throw new Error('stored model must not be touched');
    };
    assert.equal(
        await unsupportedStoredModel.listener({ device: unsupportedStoredModel.device, expected_model: 'xiaomi.vacuum.d109gl' }),
        true
    );

    const source = fs.readFileSync(require.resolve('../drivers/vacuum_xiaomi_vacuum_max/device.js'), 'utf8');
    const methodStart = source.indexOf('_registerCustomCleanupDiagnosticFlowListener()');
    const methodEnd = source.indexOf('\n    _getDeviceModel()', methodStart);
    const methodSource = source.slice(methodStart, methodEnd);
    assert.doesNotMatch(source, /paired_model_identifier|_getPairedModelIdentifier|_initializePairedModelIdentifier/);
    assert.doesNotMatch(methodSource, /getModelIdentifier|getStoreValue|setStoreValue|(?:target|this)\._model/);
});

test('custom cleanup diagnostic keeps both reads in one property-operation queue slot', async () => {
    const order = [];
    let releaseProperty;
    const target = createDiagnosticDevice({
        propertyHandler: async () => {
            order.push('property');
            return new Promise((resolve) => {
                releaseProperty = resolve;
            });
        },
        actionHandler: async () => {
            order.push('action');
            return { code: 0 };
        }
    });

    const diagnostic = target.listener({ device: target.device, expected_model: 'xiaomi.vacuum.d109gl' });
    await flushMicrotasks();
    assert.deepEqual(order, ['property']);

    const followingOperation = target.device._queuePropertyOperation(async () => {
        order.push('following');
        return true;
    });
    await flushMicrotasks();
    assert.deepEqual(order, ['property'], 'a normal property operation must not interleave between the two diagnostic steps');

    releaseProperty([{ code: 0 }]);
    assert.equal(await diagnostic, true);
    assert.equal(await followingOperation, true);
    assert.deepEqual(order, ['property', 'action', 'following']);
});

test('custom cleanup diagnostic keeps every candidate query atomic with the catalog read', async () => {
    const order = [];
    let releaseFirstAction;
    const target = createDiagnosticDevice({
        propertyHandler: async () => {
            order.push('property');
            return catalogPropertyResult([{ id: 2070144007 }, { id: 916380672 }]);
        },
        actionHandler: async (method, action) => {
            const id = action.in[0].value;
            order.push(`action:${id}`);
            if (id === 2070144007) {
                return new Promise((resolve) => {
                    releaseFirstAction = () => resolve({ code: 0 });
                });
            }
            return { code: 0 };
        }
    });

    const diagnostic = target.listener({ device: target.device, expected_model: 'xiaomi.vacuum.d109gl' });
    await flushMicrotasks();
    assert.deepEqual(order, ['property', 'action:2070144007']);

    const followingOperation = target.device._queuePropertyOperation(async () => {
        order.push('following');
        return true;
    });
    await flushMicrotasks();
    assert.deepEqual(order, ['property', 'action:2070144007']);

    releaseFirstAction();
    assert.equal(await diagnostic, true);
    assert.equal(await followingOperation, true);
    assert.deepEqual(order, ['property', 'action:2070144007', 'action:916380672', 'following']);
});

test('custom cleanup diagnostic falls back exactly once to id zero for malformed, oversized, over-encoded, and failed catalogs', async () => {
    const malformedCatalogs = [
        '{"programs":',
        'x'.repeat(4097),
        JSON.stringify(JSON.stringify(JSON.stringify([{ id: 2070144007 }])))
    ];

    for (const value of malformedCatalogs) {
        const target = createDiagnosticDevice({
            propertyHandler: async () => catalogPropertyResult(value)
        });
        assert.equal(await target.listener({ device: target.device, expected_model: 'xiaomi.vacuum.d109gl' }), true);
        assert.deepEqual(actionQueryIds(target.actionCalls), [0]);
        assert.match(target.logs.join('\n'), /fallback id 0/);
        assert.doesNotMatch(target.logs.join('\n'), /x{50}/);
        assert.ok(target.logs.join('\n').length < 4500, 'diagnostic output must remain bounded');
    }

    const propertyError = Object.assign(new Error('token=private-catalog'), { code: 'ECATALOG' });
    const failedCatalog = createDiagnosticDevice({
        propertyHandler: async () => {
            throw propertyError;
        }
    });
    await assert.rejects(
        failedCatalog.listener({ device: failedCatalog.device, expected_model: 'xiaomi.vacuum.d109gl' }),
        /inspect \[CUSTOM_CLEANUP_DIAG\] logs/
    );
    assert.deepEqual(actionQueryIds(failedCatalog.actionCalls), [0]);
    assert.match(failedCatalog.logs.join('\n'), /property read failed: request failed \(code: ECATALOG\)/);
    assert.doesNotMatch(failedCatalog.logs.join('\n'), /private-catalog|token=/i);
});

test('custom cleanup diagnostic continues after a candidate failure and reports the final partial failure', async () => {
    const firstId = 2070144007;
    const secondId = 916380672;
    const candidateError = Object.assign(new Error('Bedroom A private program'), { code: 'EPLAN1' });
    const target = createDiagnosticDevice({
        propertyHandler: async () => catalogPropertyResult([{ id: firstId, name: 'Bedroom A' }, { id: secondId }]),
        actionHandler: async (method, action) => {
            if (action.in[0].value === firstId) throw candidateError;
            return { code: 0, out: JSON.stringify({ name: 'Private program B' }) };
        }
    });

    await assert.rejects(
        target.listener({ device: target.device, expected_model: 'xiaomi.vacuum.d109gl' }),
        /inspect \[CUSTOM_CLEANUP_DIAG\] logs/
    );
    assert.deepEqual(actionQueryIds(target.actionCalls), [firstId, secondId]);
    const output = target.logs.join('\n');
    assert.match(output, /get-user-define id 2070144007 failed: request failed \(code: EPLAN1\)/);
    assert.match(output, /get-user-define id 916380672 result:/);
    assert.match(output, /completion: partial failure/);
    assert.doesNotMatch(output, /Bedroom A|Private program B/i);
});

test('custom cleanup diagnostic always performs the action after a property failure and reports bounded safe errors', async () => {
    const propertyError = Object.assign(new Error('token=top-secret; Living Room; Kitchen Plan'), { code: 'EFAIL' });
    const target = createDiagnosticDevice({
        propertyHandler: async () => {
            throw propertyError;
        },
        actionHandler: async () => ({ result: JSON.stringify({ name: 'Kitchen Plan', code: 0 }) })
    });

    await assert.rejects(target.listener({ device: target.device, expected_model: 'xiaomi.vacuum.d109gl' }), /inspect \[CUSTOM_CLEANUP_DIAG\] logs/);
    assert.equal(target.propertyCalls.length, 1);
    assert.deepEqual(target.actionCalls, [['action', GET_USER_DEFINE_ACTION, { retries: 1 }]]);
    const output = target.logs.join('\n');
    assert.match(output, /property read failed: request failed \(code: EFAIL\)/);
    assert.match(output, /get-user-define result:/);
    assert.match(output, /completion: partial failure/);
    assert.doesNotMatch(output, /top-secret|Living Room|Kitchen Plan|token=/i);
});

test('custom cleanup diagnostic reports action failure only after the property read and never uses cleaning actions', async () => {
    const actionError = new Error('Bedroom schedule should not leak');
    const target = createDiagnosticDevice({
        propertyHandler: async () => [{ siid: 2, piid: 42, code: 0, value: '{"name":"Private Plan"}' }],
        actionHandler: async () => {
            throw actionError;
        }
    });

    await assert.rejects(target.listener({ device: target.device, expected_model: 'xiaomi.vacuum.d109gl' }), /inspect \[CUSTOM_CLEANUP_DIAG\] logs/);
    assert.equal(target.propertyCalls.length, 1);
    assert.deepEqual(target.actionCalls, [['action', GET_USER_DEFINE_ACTION, { retries: 1 }]]);
    assert.doesNotMatch(target.logs.join('\n'), /Bedroom|Private Plan/i);

    const source = fs.readFileSync(require.resolve('../drivers/vacuum_xiaomi_vacuum_max/device.js'), 'utf8');
    const methodStart = source.indexOf('_registerCustomCleanupDiagnosticFlowListener()');
    const methodEnd = source.indexOf('\n    _getDeviceModel()', methodStart);
    const methodSource = source.slice(methodStart, methodEnd);
    assert.match(methodSource, /callMiotGetProperties/);
    assert.doesNotMatch(methodSource, /callVacuumGetProperties|callVacuumSetProperties|set_properties|aiid:\s*(?:38|39|40|41|42)/);
    assert.doesNotMatch(JSON.stringify(target.actionCalls), /start_|stop_|call-2-(?:38|39|40|41|42)/i);
});

test('custom cleanup diagnostic snapshot sanitizer parses nested JSON and redacts arbitrary names and keys', () => {
    const { device } = createDiagnosticDevice();
    const doubleEncoded = JSON.stringify(
        JSON.stringify({
            result: {
                code: 0,
                value: JSON.stringify({ items: [{ code: 7, name: 'Private Plan', 'Living Room': 'private room' }] })
            }
        })
    );
    const formatted = device._formatCustomCleanupDiagnosticSnapshot(doubleEncoded);
    const snapshot = JSON.parse(formatted);

    assert.equal(snapshot.truncated, false);
    assert.equal(snapshot.snapshot.result.code, 0);
    assert.equal(snapshot.snapshot.result.value.items[0].code, 7);
    assert.ok(Object.keys(snapshot.snapshot.result.value.items[0]).some((key) => key.startsWith('redacted_key_')));
    assert.doesNotMatch(formatted, /Private Plan|Living Room|private room/i);
    assert.equal(JSON.parse(device._formatCustomCleanupDiagnosticSnapshot({ value: 'unstructured secret' })).snapshot.value.type, 'redacted_string');

    const primitiveSnapshot = JSON.parse(device._formatCustomCleanupDiagnosticSnapshot({ code: 0, count: 1.5, success: true, data: null }));
    assert.deepEqual(primitiveSnapshot.snapshot, { code: 0, count: 1.5, success: true, data: null });
});

test('custom cleanup diagnostic snapshot sanitizer bounds raw input, decoding, depth, keys, arrays, final output, and circular data', () => {
    const { device } = createDiagnosticDevice();
    const oversized = device._formatCustomCleanupDiagnosticSnapshot('x'.repeat(4097));
    assert.equal(JSON.parse(oversized).snapshot.reason, 'input_length');
    assert.equal(JSON.parse(oversized).truncated, true);
    assert.doesNotMatch(oversized, /x{20}/);

    const decodeSnapshot = JSON.parse(
        device._formatCustomCleanupDiagnosticSnapshot({ items: Array.from({ length: 13 }, () => '0') })
    );
    assert.equal(decodeSnapshot.truncated, true);
    assert.equal(decodeSnapshot.snapshot.items.at(-1).reason, 'json_decode_limit');

    let deeplyNested = { value: 0 };
    for (let index = 0; index < 8; index += 1) deeplyNested = { value: deeplyNested };
    const depthSnapshot = JSON.parse(device._formatCustomCleanupDiagnosticSnapshot(deeplyNested));
    assert.equal(depthSnapshot.truncated, true);
    assert.match(JSON.stringify(depthSnapshot), /depth/);

    const manyKeys = {};
    for (let index = 0; index < 25; index += 1) manyKeys[`unsafe_key_${index}`] = index;
    const keySnapshot = JSON.parse(device._formatCustomCleanupDiagnosticSnapshot(manyKeys));
    assert.equal(keySnapshot.truncated, true);
    assert.equal(keySnapshot.snapshot.truncated.reason, 'object_keys');
    assert.doesNotMatch(JSON.stringify(keySnapshot), /unsafe_key_/);

    const arraySnapshot = JSON.parse(device._formatCustomCleanupDiagnosticSnapshot({ items: Array.from({ length: 25 }, () => 0) }));
    assert.equal(arraySnapshot.truncated, true);
    assert.equal(arraySnapshot.snapshot.items.at(-1).reason, 'array_entries');

    const circular = { result: { code: 0 } };
    circular.self = circular;
    const circularSnapshot = JSON.parse(device._formatCustomCleanupDiagnosticSnapshot(circular));
    assert.equal(circularSnapshot.truncated, true);
    assert.match(JSON.stringify(circularSnapshot), /circular_reference/);

    const wide = {
        items: Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 1)))
    };
    const finalBounded = device._formatCustomCleanupDiagnosticSnapshot(wide);
    const finalSnapshot = JSON.parse(finalBounded);
    assert.equal(finalSnapshot.truncated, true);
    assert.equal(finalSnapshot.snapshot.reason, 'serialized_length');
    assert.ok(finalBounded.length <= 3500);
});
