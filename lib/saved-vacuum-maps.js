'use strict';

const MAX_MAP_ID = 0xFFFFFFFF;

function parseMapId(value) {
    if (Number.isInteger(value) && value >= 0 && value <= MAX_MAP_ID) return value;
    if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(value)) return null;
    const id = Number(value);
    return Number.isInteger(id) && id <= MAX_MAP_ID && String(id) === value ? id : null;
}

function propertyValue(result, siid, piid) {
    if (!Array.isArray(result) || result.length !== 1) throw new Error('Unexpected saved-map property response.');
    const item = result[0];
    if (!item || item.siid !== siid || item.piid !== piid || item.code !== 0 || !Object.prototype.hasOwnProperty.call(item, 'value')) {
        throw new Error(`Saved-map property ${siid}/${piid} is unavailable.`);
    }
    return item.value;
}

function parseMapCatalog(raw, currentRaw) {
    let value = raw;
    if (typeof value === 'string') {
        if (value.length > 65536) throw new Error('Saved-map catalog is too large.');
        try { value = JSON.parse(value); } catch (_) { throw new Error('Saved-map catalog is not valid JSON.'); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.map_array)) {
        throw new Error('Saved-map catalog has no map_array.');
    }
    if (value.map_array.length > 100) throw new Error('Saved-map catalog has too many entries.');
    const currentId = parseMapId(currentRaw);
    if (currentId === null) throw new Error('Current map ID is invalid.');
    const seen = new Set();
    let markedCurrent = null;
    const maps = value.map_array.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Saved-map catalog contains a malformed entry.');
        const id = parseMapId(entry.map_id);
        if (id === null) throw new Error(`Saved-map catalog entry ${index + 1} has an invalid map ID (${typeof entry.map_id}).`);
        if (seen.has(id)) throw new Error(`Saved-map catalog entry ${index + 1} repeats map ID ${id}.`);
        seen.add(id);
        if (entry.is_current != null && typeof entry.is_current !== 'boolean') throw new Error('Saved-map catalog contains an invalid current-map marker.');
        if (entry.is_current === true) {
            if (markedCurrent !== null) throw new Error('Saved-map catalog marks multiple current maps.');
            markedCurrent = id;
        }
        const name = typeof entry.map_name === 'string'
            ? entry.map_name.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
            : '';
        return { id, name: name || `Map ${id}`, isCurrent: id === currentId };
    });
    return { maps, currentId, currentInCatalog: seen.has(currentId), markedCurrentId: markedCurrent };
}

module.exports = { parseMapId, propertyValue, parseMapCatalog };
