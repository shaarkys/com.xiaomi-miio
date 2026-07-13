'use strict';

const { WRITERS, READ_DIDS, FLOW, READERS, SETTINGS } = require('./features.js');
const { MODE_LABELS } = require('./translations.js');
const { MODELS, DEFAULT } = require('./models.js');

/**
 * Runtime engine for the fan_xiaomi_advanced driver (xiaomi.fan.* only). Drives a
 * device purely from its model descriptor; the device/driver classes stay thin and
 * delegate here. Uses custom fan_xiaomi_* capabilities for every swing control.
 */

const DEFAULT_NORMALIZE = { zeroIndexing: false };

/** Resolve a model id (incl. aliases) to its descriptor, or the generic default. */
const resolve = (model) => {
    const desc = MODELS[model] ?? DEFAULT;
    return { ...desc, normalize: { ...DEFAULT_NORMALIZE, ...(desc.normalize || {}) } };
};

/** Capabilities a descriptor should expose (derived from its declared props). */
const desiredCapabilities = (desc) => WRITERS.filter((w) => w.active(desc.props)).map((w) => w.cap);

/**
 * Add capabilities the model has and remove ones it does not. Only the capability
 * universe declared in WRITERS is touched; unrelated capabilities are left alone.
 */
const syncCapabilities = async (device, desc) => {
    const desired = new Set(desiredCapabilities(desc));
    for (const { cap } of WRITERS) {
        if (desired.has(cap) && !device.hasCapability(cap)) {
            await device.addCapability(cap);
        } else if (!desired.has(cap) && device.hasCapability(cap)) {
            await device.removeCapability(cap);
        }
    }
};

/** Configure the enum options for the model's mode and angle capabilities. */
const applyCapabilityOptions = async (device, desc) => {
    if (desc.modes && device.hasCapability('fan_xiaomi_mode')) {
        await device.setCapabilityOptions('fan_xiaomi_mode', {
            values: desc.modes.map((v) => ({ id: String(v), title: MODE_LABELS[v] ?? String(v) }))
        });
    }

    if (desc.horizontalAngles && device.hasCapability('fan_xiaomi_horizontal_angle')) {
        await device.setCapabilityOptions('fan_xiaomi_horizontal_angle', {
            values: desc.horizontalAngles.map((angle) => ({ id: angle.toString(), title: `${angle}°` }))
        });
    }

    if (desc.verticalAngles && device.hasCapability('fan_xiaomi_vertical_angle')) {
        await device.setCapabilityOptions('fan_xiaomi_vertical_angle', {
            values: desc.verticalAngles.map((angle) => ({ id: angle.toString(), title: `${angle}°` }))
        });
    }
};

/** Write a single MIOT property, mirroring the shared unreachable/backoff handling. */
const writeProperty = async (device, prop, did, value) => {
    if (device.miio) {
        return device.miio.call('set_properties', [{ did, siid: prop.siid, piid: prop.piid, value }], { retries: 1 });
    }
    device.setUnavailable(device.homey.__('unreachable')).catch((error) => {
        device.error(error);
    });
    device.createDevice();
    return Promise.reject('Device unreachable, please try again ...');
};

/** Register capability listeners for every writable feature the model has. */
const registerListeners = (device, desc) => {
    for (const writer of WRITERS) {
        if (!writer.active(desc.props)) continue;
        const prop = desc.props[writer.propKey];
        device.registerCapabilityListener(writer.cap, async (value) => {
            try {
                return await writeProperty(device, prop, writer.did, writer.encode(value, desc.normalize));
            } catch (error) {
                device.error(error);
                return Promise.reject(error);
            }
        });
    }
};

/** Build the get_properties array from the props the model declares. */
const buildGetProperties = (desc) =>
    READ_DIDS.filter((did) => desc.props[did] !== undefined).map((did) => ({ did, siid: desc.props[did].siid, piid: desc.props[did].piid }));

/** Decode a poll result into capability/setting updates and fire triggers, driven by READERS/SETTINGS. */
const pollAndUpdate = async (device, desc, result) => {
    const get = (did) => result.find((obj) => obj.did === did);

    for (const reader of READERS) {
        if (!device.hasCapability(reader.cap)) continue;
        const obj = get(reader.did);
        if (obj === undefined) continue;
        const value = reader.decode(obj.value, desc.normalize);
        const previous = device.getCapabilityValue(reader.cap);
        await device.updateCapabilityValue(reader.cap, value);
        if (reader.trigger && value !== previous) {
            const { card, tokens } = reader.trigger(value, previous, desc);
            await device.homey.flow
                .getDeviceTriggerCard(card)
                .trigger(device, tokens)
                .catch((error) => {
                    device.error(error);
                });
        }
    }

    for (const setting of SETTINGS) {
        const obj = get(setting.did);
        if (obj !== undefined) await device.updateSettingValue(setting.setting, setting.decode(obj.value));
    }
};

/** Rotate the fan head via its unified `rotate` block (MIOT action). */
const rotateFanHead = async (device, desc, direction) => {
    device.log(`[Rotate] Requesting fan to rotate ${direction}`);

    const rotate = desc.rotate;
    if (!rotate || rotate[direction] === undefined) {
        throw new Error(`Direction '${direction}' not supported for this model`);
    }

    try {
        if (rotate.via === 'action') {
            return await device.miio.call('action', { siid: rotate.siid, aiid: rotate[direction], in: [] });
        }
        return await device.miio.call('set_properties', [{ did: 'set_move', siid: rotate.siid, piid: rotate.piid, value: rotate[direction] }], { retries: 1 });
    } catch (err) {
        device.error('[Rotate] Failed to rotate fan:', err);
        throw err;
    }
};

/** Write a device setting (led/buzzer/childLock) if the model exposes it. */
const writeSetting = async (device, desc, propKey, did, value) => {
    const prop = desc.props[propKey];
    if (!prop) return;
    await device.miio.call('set_properties', [{ did, siid: prop.siid, piid: prop.piid, value }], { retries: 1 });
};

/** Register all flow-card run listeners once, with the runtime feature guard. */
const registerFlowCards = (driver) => {
    const requireFeature = (device, requires) => {
        if (!requires) return;
        const desc = device.getDescriptor();
        const ok = requires.cap ? device.hasCapability(requires.cap) : requires.supported(desc);
        if (!ok) {
            throw new Error(desc.fallback
                ? `This fan model (${device.getStoreValue('model')}) isn't recognized yet, so ${requires.label} isn't available — please report the model so it can be added.`
                : `This fan does not support ${requires.label}`);
        }
    };

    for (const entry of FLOW) {
        const card = entry.type === 'condition' ? driver.homey.flow.getConditionCard(entry.card) : driver.homey.flow.getActionCard(entry.card);
        card.registerRunListener(async (args) => {
            requireFeature(args.device, entry.requires);
            return entry.run(args.device, args);
        });
        if (entry.autocomplete) {
            card.registerArgumentAutocompleteListener(entry.autocomplete.arg, async (query, args) => {
                const items = args.device ? entry.autocomplete.options(args.device.getDescriptor(), driver.homey) : [];
                const q = String(query || '').toLowerCase();
                return items.filter((item) => item.name.toLowerCase().includes(q));
            });
        }
    }
};

module.exports = {
    resolve,
    syncCapabilities,
    applyCapabilityOptions,
    registerListeners,
    buildGetProperties,
    pollAndUpdate,
    rotateFanHead,
    writeSetting,
    registerFlowCards
};
