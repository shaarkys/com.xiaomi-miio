'use strict';

const { MODE_LABELS } = require('./translations.js');

/** Clamp a number into an inclusive range. */
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Whether a raw device value is one of the descriptor's allowed values. */
const isAllowedValue = (list, raw) => Array.isArray(list) && list.map(Number).includes(Number(raw));

const fanLevelDisplayOffset = (desc) => {
    const rawLevels = (desc.fanLevels || []).map((level) => Number(level)).filter((level) => Number.isFinite(level));
    return rawLevels.length > 0 && Math.min(...rawLevels) === 0 ? 1 : 0;
};

const fanLevelOptions = (desc) => {
    const levels = (desc.fanLevels || []).map((level) => Number(level)).filter((level) => Number.isFinite(level));
    const offset = fanLevelDisplayOffset(desc);
    return levels.map((level) => {
        const capabilityValue = String(level + offset);
        return { name: capabilityValue, id: capabilityValue };
    });
};

/**
 * Single source of truth for the fan_xiaomi_advanced driver's capabilities and
 * flow cards. This driver uses custom capabilities for ALL swing controls (no
 * standard `oscillating`, no `fan_zhimi_angle`), so there is no single/dual-swing
 * branching — horizontal swing is present whenever the model declares `swing_h`.
 *
 * WRITERS: every writable capability. `active(props)` decides whether the model
 * has the capability. `encode` converts a Homey capability value to the device value.
 * FLOW: every flow card handled by the driver. `requires` (optional) names the
 * capability + human label used by the runtime guard.
 */

const WRITERS = [
    {
        cap: 'onoff',
        propKey: 'power',
        did: 'power',
        active: (props) => props.power !== undefined,
        encode: (value) => value
    },
    {
        cap: 'fan_xiaomi_horizontal_swing',
        propKey: 'swing_h',
        did: 'swing_h',
        active: (props) => props.swing_h !== undefined,
        encode: (value) => value
    },
    {
        cap: 'fan_xiaomi_fanlevel',
        propKey: 'fan_level',
        did: 'fan_level',
        active: (props) => props.fan_level !== undefined,
        encode: (value, desc) => {
            const offset = fanLevelDisplayOffset(desc);
            return Number(value) - offset;
        }
    },
    {
        cap: 'fan_xiaomi_horizontal_angle',
        propKey: 'swing_h_angle',
        did: 'swing_h_angle',
        active: (props) => props.swing_h_angle !== undefined,
        encode: (value) => +value
    },
    {
        cap: 'fan_speed',
        propKey: 'fan_speed',
        did: 'fan_speed',
        active: (props) => props.fan_speed !== undefined,
        encode: (value) => clamp(Math.round(value * 100), 1, 100)
    },
    {
        cap: 'fan_xiaomi_mode',
        propKey: 'mode',
        did: 'mode',
        active: (props) => props.mode !== undefined,
        encode: (value) => Number(value)
    },
    {
        cap: 'fan_xiaomi_vertical_swing',
        propKey: 'swing_v',
        did: 'swing_v',
        active: (props) => props.swing_v !== undefined,
        encode: (value) => value
    },
    {
        cap: 'fan_xiaomi_vertical_angle',
        propKey: 'swing_v_angle',
        did: 'swing_v_angle',
        active: (props) => props.swing_v_angle !== undefined,
        encode: (value) => +value
    }
];

/** Whether a model can rotate its head in `direction`, from its unified `rotate` block. */
const canRotate = (desc, direction) => desc.rotate !== undefined && desc.rotate[direction] !== undefined;

const FLOW = [
    {
        card: 'xiaomiFanMode',
        type: 'action',
        autocomplete: {
            arg: 'mode',
            options: (desc, homey) => {
                const lang = homey.i18n.getLanguage();
                return (desc.modes || []).map((v) => ({ name: MODE_LABELS[v]?.[lang] ?? MODE_LABELS[v]?.en ?? String(v), id: String(v) }));
            }
        },
        run: (device, args) => {
            const desc = device.getDescriptor();
            if (!desc.modes || !desc.modes.includes(Number(args.mode.id))) {
                throw new Error('This fan does not support that mode');
            }
            return device.triggerCapabilityListener('fan_xiaomi_mode', args.mode.id);
        }
    },
    {
        card: 'xiaomiSetFanLevel',
        type: 'action',
        requires: { cap: 'fan_xiaomi_fanlevel', label: 'fan level' },
        autocomplete: {
            arg: 'level',
            options: (desc) => fanLevelOptions(desc)
        },
        run: (device, args) => device.triggerCapabilityListener('fan_xiaomi_fanlevel', args.level.id)
    },
    {
        card: 'xiaomiModeEquals',
        type: 'condition',
        requires: { cap: 'fan_xiaomi_mode', label: 'mode' },
        autocomplete: {
            arg: 'mode',
            options: (desc, homey) => {
                const lang = homey.i18n.getLanguage();
                return (desc.modes || []).map((v) => ({ name: MODE_LABELS[v]?.[lang] ?? MODE_LABELS[v]?.en ?? String(v), id: String(v) }));
            }
        },
        run: (device, args) => String(device.getCapabilityValue('fan_xiaomi_mode')) === String(args.mode.id)
    },
    {
        card: 'xiaomiFanLevelEquals',
        type: 'condition',
        requires: { cap: 'fan_xiaomi_fanlevel', label: 'fan level' },
        autocomplete: {
            arg: 'level',
            options: (desc) => fanLevelOptions(desc)
        },
        run: (device, args) => String(device.getCapabilityValue('fan_xiaomi_fanlevel')) === String(args.level.id)
    },
    {
        card: 'xiaomiHorizontalAngleEquals',
        type: 'condition',
        requires: { cap: 'fan_xiaomi_horizontal_angle', label: 'horizontal angle' },
        autocomplete: { arg: 'angle', options: (desc) => (desc.horizontalAngles || []).map((a) => ({ name: `${a}°`, id: String(a) })) },
        run: (device, args) => String(device.getCapabilityValue('fan_xiaomi_horizontal_angle')) === String(args.angle.id)
    },
    {
        card: 'xiaomiVerticalAngleEquals',
        type: 'condition',
        requires: { cap: 'fan_xiaomi_vertical_angle', label: 'vertical angle' },
        autocomplete: { arg: 'angle', options: (desc) => (desc.verticalAngles || []).map((a) => ({ name: `${a}°`, id: String(a) })) },
        run: (device, args) => String(device.getCapabilityValue('fan_xiaomi_vertical_angle')) === String(args.angle.id)
    },
    {
        card: 'xiaomiHorizontalSwingIsOn',
        type: 'condition',
        requires: { cap: 'fan_xiaomi_horizontal_swing', label: 'horizontal swing' },
        run: (device) => device.getCapabilityValue('fan_xiaomi_horizontal_swing') === true
    },
    {
        card: 'xiaomiHorizontalSwingOff',
        type: 'action',
        requires: { cap: 'fan_xiaomi_horizontal_swing', label: 'horizontal swing' },
        run: (device) => device.triggerCapabilityListener('fan_xiaomi_horizontal_swing', false)
    },
    {
        card: 'xiaomiHorizontalSwingOn',
        type: 'action',
        requires: { cap: 'fan_xiaomi_horizontal_swing', label: 'horizontal swing' },
        run: (device) => device.triggerCapabilityListener('fan_xiaomi_horizontal_swing', true)
    },
    {
        card: 'xiaomiHorizontalSwingToggle',
        type: 'action',
        requires: { cap: 'fan_xiaomi_horizontal_swing', label: 'horizontal swing' },
        run: (device) => device.triggerCapabilityListener('fan_xiaomi_horizontal_swing', !device.getCapabilityValue('fan_xiaomi_horizontal_swing'))
    },
    {
        card: 'xiaomiRotateDown',
        type: 'action',
        requires: { label: 'vertical rotation', supported: (desc) => canRotate(desc, 'down') },
        run: (device) => device.rotateFanHead('down')
    },
    {
        card: 'xiaomiRotateLeft',
        type: 'action',
        requires: { label: 'horizontal rotation', supported: (desc) => canRotate(desc, 'left') },
        run: (device) => device.rotateFanHead('left')
    },
    {
        card: 'xiaomiRotateRight',
        type: 'action',
        requires: { label: 'horizontal rotation', supported: (desc) => canRotate(desc, 'right') },
        run: (device) => device.rotateFanHead('right')
    },
    {
        card: 'xiaomiRotateUp',
        type: 'action',
        requires: { label: 'vertical rotation', supported: (desc) => canRotate(desc, 'up') },
        run: (device) => device.rotateFanHead('up')
    },
    {
        card: 'xiaomiSetHorizontalAngle',
        type: 'action',
        requires: { cap: 'fan_xiaomi_horizontal_angle', label: 'horizontal angle' },
        autocomplete: { arg: 'angle', options: (desc) => (desc.horizontalAngles || []).map((a) => ({ name: `${a}°`, id: String(a) })) },
        run: (device, args) => device.triggerCapabilityListener('fan_xiaomi_horizontal_angle', args.angle.id)
    },
    {
        card: 'xiaomiSetVerticalAngle',
        type: 'action',
        requires: { cap: 'fan_xiaomi_vertical_angle', label: 'vertical angle' },
        autocomplete: { arg: 'angle', options: (desc) => (desc.verticalAngles || []).map((a) => ({ name: `${a}°`, id: String(a) })) },
        run: (device, args) => device.triggerCapabilityListener('fan_xiaomi_vertical_angle', args.angle.id)
    },
    {
        card: 'xiaomiVerticalSwingIsOn',
        type: 'condition',
        requires: { cap: 'fan_xiaomi_vertical_swing', label: 'vertical swing' },
        run: (device) => device.getCapabilityValue('fan_xiaomi_vertical_swing') === true
    },
    {
        card: 'xiaomiVerticalSwingOff',
        type: 'action',
        requires: { cap: 'fan_xiaomi_vertical_swing', label: 'vertical swing' },
        run: (device) => device.triggerCapabilityListener('fan_xiaomi_vertical_swing', false)
    },
    {
        card: 'xiaomiVerticalSwingOn',
        type: 'action',
        requires: { cap: 'fan_xiaomi_vertical_swing', label: 'vertical swing' },
        run: (device) => device.triggerCapabilityListener('fan_xiaomi_vertical_swing', true)
    },
    {
        card: 'xiaomiVerticalSwingToggle',
        type: 'action',
        requires: { cap: 'fan_xiaomi_vertical_swing', label: 'vertical swing' },
        run: (device) => device.triggerCapabilityListener('fan_xiaomi_vertical_swing', !device.getCapabilityValue('fan_xiaomi_vertical_swing'))
    }
];

/**
 * READERS drive the poll/update path: each entry optionally validates the raw value (`valid`),
 * decodes it into a capability value, and optionally fires a device trigger on change.
 * Mirrors WRITERS so adding a feature stays data-only on both the write and the read side.
 */
const READERS = [
    {
        cap: 'onoff',
        did: 'power',
        decode: (value) => value
    },
    {
        cap: 'fan_xiaomi_horizontal_swing',
        did: 'swing_h',
        decode: (value) => !!value,
        trigger: (value) => ({ card: value ? 'xiaomiHorizontalSwingTurnedOn' : 'xiaomiHorizontalSwingTurnedOff' })
    },
    {
        cap: 'fan_xiaomi_fanlevel',
        did: 'fan_level',
        valid: (value, desc) => isAllowedValue(desc.fanLevels, value),
        decode: (value, desc) => {
            const offset = fanLevelDisplayOffset(desc);
            return String(Number(value) + offset);
        },
        trigger: (value, previous) => ({ card: 'xiaomiFanLevelChanged', tokens: { new_level: Number(value), previous_level: Number(previous) } })
    },
    {
        cap: 'fan_xiaomi_horizontal_angle',
        did: 'swing_h_angle',
        valid: (value, desc) => isAllowedValue(desc.horizontalAngles, value),
        decode: (value) => value.toString(),
        trigger: (value, previous) => ({ card: 'xiaomiHorizontalAngleChanged', tokens: { new_angle: Number(value), previous_angle: Number(previous) } })
    },
    {
        cap: 'fan_speed',
        did: 'fan_speed',
        valid: (value) => Number.isFinite(Number(value)),
        decode: (value) => value / 100
    },
    {
        cap: 'fan_xiaomi_vertical_swing',
        did: 'swing_v',
        decode: (value) => !!value,
        trigger: (value) => ({ card: value ? 'xiaomiVerticalSwingTurnedOn' : 'xiaomiVerticalSwingTurnedOff' })
    },
    {
        cap: 'fan_xiaomi_vertical_angle',
        did: 'swing_v_angle',
        valid: (value, desc) => isAllowedValue(desc.verticalAngles, value),
        decode: (value) => value.toString(),
        trigger: (value, previous) => ({ card: 'xiaomiVerticalAngleChanged', tokens: { new_angle: Number(value), previous_angle: Number(previous) } })
    },
    {
        cap: 'fan_xiaomi_mode',
        did: 'mode',
        valid: (value, desc) => isAllowedValue(desc.modes, value),
        decode: (value) => value.toString(),
        trigger: (value, previous) => {
            const label = (v) => MODE_LABELS[v]?.en ?? String(v);
            return {
                card: 'xiaomiModeChanged',
                tokens: { new_mode: label(value), previous_mode: label(previous) }
            };
        }
    }
];

/** SETTINGS drive the poll path for device settings (led/buzzer/childLock), not capabilities. */
const SETTINGS = [
    {
        setting: 'led',
        propKey: 'light',
        did: 'light',
        active: (props) => props.light !== undefined,
        decode: (value) => !!value
    },
    {
        setting: 'buzzer',
        propKey: 'buzzer',
        did: 'buzzer',
        active: (props) => props.buzzer !== undefined,
        decode: (value) => value
    },
    {
        setting: 'childLock',
        propKey: 'child_lock',
        did: 'child_lock',
        active: (props) => props.child_lock !== undefined,
        decode: (value) => value
    }
];

/** Unique did list used for get_properties polling. */
const READ_DIDS = [...new Set([...READERS.map((reader) => reader.did), ...SETTINGS.map((setting) => setting.did)])];

module.exports = { WRITERS, READ_DIDS, FLOW, READERS, SETTINGS, fanLevelOptions };
