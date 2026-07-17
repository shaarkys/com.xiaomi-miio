'use strict';

const { WRITERS, READ_DIDS, FLOW, READERS, SETTINGS, fanLevelOptions } = require('./features.js');
const { MODE_LABELS } = require('./translations.js');
const { MODELS, DEFAULT } = require('./models.js');

const POLL_QUEUE = Symbol('fan_xiaomi_poll_queue');
const IMMEDIATE_PENDING = Symbol('fan_xiaomi_immediate_pending');
const LAST_TRIGGER_VALUES = Symbol('fan_xiaomi_last_trigger_values');

/**
 * Runtime engine for the fan_xiaomi_advanced driver (xiaomi.fan.* only). Drives a
 * device purely from its model descriptor; the device/driver classes stay thin and
 * delegate here. Uses custom fan_xiaomi_* capabilities for every swing control.
 */

/** Resolve a model id (incl. aliases) to its descriptor, or the generic default. */
const resolve = (model) => {
    const desc = MODELS[model] ?? DEFAULT;
    return { ...desc };
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
    // setCapabilityOptions is expensive, so skip it when the options are unchanged.
    const setOptionsIfChanged = async (cap, options) => {
        if (!device.hasCapability(cap)) return;
        let current;
        try {
            current = device.getCapabilityOptions(cap);
        } catch (error) {
            current = undefined;
        }
        if (current && JSON.stringify(current.values) === JSON.stringify(options.values)) return;
        await device.setCapabilityOptions(cap, options);
    };

    if (desc.modes) {
        await setOptionsIfChanged('fan_xiaomi_mode', {
            values: desc.modes.map((v) => ({ id: String(v), title: MODE_LABELS[v] ?? String(v) }))
        });
    }

    if (desc.fanLevels) {
        await setOptionsIfChanged('fan_xiaomi_fanlevel', {
            values: fanLevelOptions(desc).map((option) => ({ id: option.id, title: option.name }))
        });
    }

    if (desc.horizontalAngles) {
        await setOptionsIfChanged('fan_xiaomi_horizontal_angle', {
            values: desc.horizontalAngles.map((angle) => ({ id: angle.toString(), title: `${angle}°` }))
        });
    }

    if (desc.verticalAngles) {
        await setOptionsIfChanged('fan_xiaomi_vertical_angle', {
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
                const writeResult = await writeProperty(device, prop, writer.did, writer.encode(value, desc));
                // Confirm state in the background so listener completion is not delayed.
                immediatePollAndUpdate(device, desc).catch((error) => {
                    device.error(error);
                });
                return writeResult;
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

/** Run one get_properties cycle and pass the result through the normal update+trigger logic. */
const runPollCycle = async (device, desc) => {
    const result = await device.miio.call('get_properties', buildGetProperties(desc), { retries: 1 });
    await pollAndUpdate(device, desc, result);
    return result;
};

/**
 * Append a poll cycle to the device's shared serial queue. Regular polls and
 * on-demand (post-write) polls all go through here, so their get_properties
 * responses can never interleave and an older response cannot overwrite newer
 * state or emit out-of-order triggers.
 */
const enqueuePoll = (device, task) => {
    const tail = device[POLL_QUEUE] || Promise.resolve();
    const run = tail.then(() => task(), () => task());
    device[POLL_QUEUE] = run.then(() => {}, () => {});
    return run;
};

/** Regular poll cycle (from retrieveDeviceData), serialized on the shared queue. */
const poll = (device, desc) => enqueuePoll(device, () => runPollCycle(device, desc));

/**
 * On-demand poll used to confirm state right after a write. Serialized on the
 * same shared queue as the regular poll, and coalesced so a burst of writes
 * enqueues at most one pending confirmation poll.
 */
const immediatePollAndUpdate = (device, desc) => {
    if (!device.miio) return Promise.resolve();
    if (device[IMMEDIATE_PENDING]) return device[IMMEDIATE_PENDING];

    const pending = enqueuePoll(device, () => {
        // Cleared once this poll starts running,
        // so a write arriving mid-cycle can queue exactly one more confirmation poll.
        device[IMMEDIATE_PENDING] = null;
        return runPollCycle(device, desc);
    });
    device[IMMEDIATE_PENDING] = pending;
    return pending;
};

/** Decode a poll result into capability/setting updates and fire triggers, driven by READERS/SETTINGS. */
const pollAndUpdate = async (device, desc, result) => {
    const get = (did) => result.find((obj) => obj.did === did);
    const lastValues = device[LAST_TRIGGER_VALUES] || (device[LAST_TRIGGER_VALUES] = {});

    for (const reader of READERS) {
        if (!device.hasCapability(reader.cap)) continue;
        const obj = get(reader.did);
        if (obj === undefined) continue;
        // Skip failed / invalid reads so they can't set bogus capability values
        // or fire bad change triggers (a NaN speed, an out-of-range angle, an unknown mode);
        // only valid observations continue.
        if (obj.code !== undefined && obj.code !== 0) continue;
        if (obj.value === null || obj.value === undefined) continue;
        if (reader.valid && !reader.valid(obj.value, desc)) continue;

        const value = reader.decode(obj.value, desc);
        // Seed the trigger cache on the first observation without firing,
        // so an app restart / newly added capability can't emit a false change with a null-ish "previous".
        // Compare against the last value observed from the device,
        // not the capability value (which Homey sets optimistically on app/Flow writes).
        const hadPrevious = reader.cap in lastValues;
        const previous = lastValues[reader.cap];
        lastValues[reader.cap] = value;
        await device.updateCapabilityValue(reader.cap, value);
        if (reader.trigger && hadPrevious && value !== previous) {
            const trigger = reader.trigger(value, previous, desc);
            const cards = trigger.cards || [trigger.card];
            for (const card of cards) {
                await device.homey.flow
                    .getDeviceTriggerCard(card)
                    .trigger(device, trigger.tokens)
                    .catch((error) => {
                        device.error(error);
                    });
            }
        }
    }

    for (const setting of SETTINGS) {
        if (!setting.active(desc.props)) continue;
        const obj = get(setting.did);
        if (obj === undefined) continue;
        if (obj.code !== undefined && obj.code !== 0) continue;
        if (obj.value === null || obj.value === undefined) continue;
        await device.updateSettingValue(setting.setting, setting.decode(obj.value));
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

/** Write all changed device settings using declarative SETTINGS metadata. */
const writeChangedSettings = async (device, desc, newSettings, changedKeys) => {
    for (const setting of SETTINGS) {
        if (!setting.active(desc.props)) continue;
        if (!changedKeys.includes(setting.setting)) continue;
        await writeSetting(device, desc, setting.propKey, setting.did, newSettings[setting.setting]);
    }
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
    desiredCapabilities,
    syncCapabilities,
    applyCapabilityOptions,
    registerListeners,
    buildGetProperties,
    poll,
    pollAndUpdate,
    rotateFanHead,
    writeSetting,
    writeChangedSettings,
    registerFlowCards
};
