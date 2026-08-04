'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    S12_ROOM_CLEANING_MODEL,
    normalizeRoomIds,
    createS12RoomCleaningAction
} = require('../lib/vacuum-xiaomi-miot.js');

test('normalizes whitespace and de-duplicates positive room IDs in their original order', () => {
    assert.deepEqual(normalizeRoomIds(' 3, 001, 3, 2, 01, 4 '), [3, 1, 2, 4]);
});

test('rejects every invalid room-ID input class', async (t) => {
    const invalidInputs = [
        ['non-string input', 1, TypeError, /comma-separated string/],
        ['empty input', '', Error, /At least one positive room ID/],
        ['whitespace-only input', '   ', Error, /At least one positive room ID/],
        ['empty item', '1,,2', Error, /must not contain empty values/],
        ['trailing separator', '1,', Error, /must not contain empty values/],
        ['decimal value', '1.5', Error, /positive integers/],
        ['non-numeric value', 'one', Error, /positive integers/],
        ['scientific notation', '1e3', Error, /positive integers/],
        ['zero', '0', Error, /positive integers/],
        ['negative value', '-1', Error, /positive integers/],
        ['unsafe integer', '9007199254740992', Error, /positive integers/]
    ];

    for (const [name, input, ErrorType, message] of invalidInputs) {
        await t.test(name, () => {
            assert.throws(() => normalizeRoomIds(input), {
                name: ErrorType.name,
                message
            });
        });
    }
});

test('builds the exact released S12 MIoT room-cleaning action', () => {
    assert.deepEqual(createS12RoomCleaningAction(S12_ROOM_CLEANING_MODEL, ' 7,2,7,003 '), {
        siid: 2,
        aiid: 7,
        did: 'call-2-7',
        in: ['7,2,3']
    });
});

test('rejects unverified room-cleaning models before an action can be created', () => {
    for (const model of ['xiaomi.vacuum.b112gl', 'dreame.vacuum.r2216o', undefined]) {
        assert.throws(
            () => createS12RoomCleaningAction(model, '1,2'),
            /only supported for xiaomi\.vacuum\.b106eu/
        );
    }
});
