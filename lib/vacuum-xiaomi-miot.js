'use strict';

const S12_ROOM_CLEANING_MODEL = 'xiaomi.vacuum.b106eu';

/*
 * The S12 room-cleaning action is service 2/action 7. Its one input is the
 * value of service 2/property 10 (`room-ids`), so MIoT receives one string.
 */
function normalizeRoomIds(roomIdsText) {
    if (typeof roomIdsText !== 'string') {
        throw new TypeError('Room IDs must be a comma-separated string of positive integers.');
    }

    if (roomIdsText.trim() === '') {
        throw new Error('At least one positive room ID is required.');
    }

    const roomIds = [];
    const seenRoomIds = new Set();

    for (const roomIdText of roomIdsText.split(',')) {
        const trimmedRoomIdText = roomIdText.trim();

        if (trimmedRoomIdText === '') {
            throw new Error('Room IDs must not contain empty values.');
        }

        if (!/^\d+$/.test(trimmedRoomIdText)) {
            throw new Error(`Invalid room ID "${trimmedRoomIdText}": room IDs must be positive integers.`);
        }

        const roomId = Number(trimmedRoomIdText);
        if (!Number.isSafeInteger(roomId) || roomId <= 0) {
            throw new Error(`Invalid room ID "${trimmedRoomIdText}": room IDs must be positive integers.`);
        }

        if (!seenRoomIds.has(roomId)) {
            seenRoomIds.add(roomId);
            roomIds.push(roomId);
        }
    }

    return roomIds;
}

function createS12RoomCleaningAction(model, roomIdsText) {
    if (model !== S12_ROOM_CLEANING_MODEL) {
        const reportedModel = typeof model === 'string' && model !== '' ? model : 'unknown model';
        throw new Error(`Room cleaning is only supported for ${S12_ROOM_CLEANING_MODEL}; received ${reportedModel}.`);
    }

    return {
        siid: 2,
        aiid: 7,
        did: 'call-2-7',
        in: [normalizeRoomIds(roomIdsText).join(',')]
    };
}

module.exports = {
    S12_ROOM_CLEANING_MODEL,
    normalizeRoomIds,
    createS12RoomCleaningAction
};
