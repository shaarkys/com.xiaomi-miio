'use strict';

const { MODE } = require('./constants.js');

/*
 * Per-model descriptors for the xiaomi.fan.* family (p30, p43, p45, p51, p69, p70, p76, p85).
 *
 * This is the ONLY place model-specific data lives: the engine (engine.js) derives every
 * capability, flow card and poll/write from these descriptors, so adding or extending a
 * model is a data-only change here — no engine edits.
 *
 * Each descriptor lists only what the model has (an absent field means "unsupported"):
 *   props             MIOT { siid, piid } per feature; each present prop switches on its capability (see WRITERS).
 *   fanLevels         required when props.fan_level is set — raw MIOT Gear values (for example [1,2,3,4] or [0,1,2,3]).
 *                     Keep this separate from `fan_speed` (Stepless Fan Level, typically range[1,100,1]).
 *   modes             required when props.mode is set — array of supported device values, e.g. [MODE.REGULAR, MODE.NATURAL].
 *   horizontalAngles  required when props.swing_h_angle is set — allowed swing_h angles.
 *   verticalAngles    required when props.swing_v_angle is set — allowed swing_v angles.
 *   rotate            optional — head-rotation map { via: 'action', siid, left, right, up?, down? }.
 *   fallback          DEFAULT-only — true on DEFAULT, unset on real models; tailors "unrecognized model" errors.
 *
 * To add a model:
 *   1. Run `scripts/miot-spec.sh <model-id>` to dump the model's siid/piid/aiid map to <model-id>.txt
 *      (the script pulls piids from the MIoT spec API). For a read-friendly overview see
 *      https://home.miot-spec.com/spec/<model-id> — though that page doesn't list piids.
 *   2. Add `const pXX = { ... }` using the fields above.
 *   3. Set `fanLevels` from the model's Gear Fan Level enum values exactly as reported by the device.
 *      Do not use Stepless Fan Level ranges here; those map to `props.fan_speed`.
 *   4. Register it in MODELS under its model id. Alias spec-identical siblings to one shared
 *      descriptor (p76 -> p70) instead of duplicating. Never set `fallback` on a real model.
 *   5. If the model uses a value the shared enums don't list yet, also extend the matching
 *      superset(s) — defined once, they cover every model, so they are easy to forget.
 *      Paths below are relative to .homeycompose/:
 *        new mode       capabilities/fan_xiaomi_mode.json  +  MODE.* (lib constants.js) + MODE_LABELS (lib translations.js)
 *        new fan level  capabilities/fan_xiaomi_fanlevel.json
 *        odd angle      capabilities/fan_xiaomi_horizontal_angle.json / fan_xiaomi_vertical_angle.json
 *                       (only if NOT a 10° step — 10–180° are already declared)
 *      A brand-new feature (not just a new value) also needs a WRITER/READER + its own capability + flow card.
 */

const p30 = {
    fanLevels: [1, 2, 3, 4],
    modes: [MODE.REGULAR, MODE.NATURAL],
    horizontalAngles: [30, 60, 90, 120, 140],
    rotate: { via: 'action', siid: 2, left: 4, right: 5 },
    props: {
        buzzer: { siid: 7, piid: 1 },
        child_lock: { siid: 8, piid: 1 },
        fan_level: { siid: 2, piid: 4 },
        fan_speed: { siid: 2, piid: 5 },
        light: { siid: 5, piid: 1 },
        mode: { siid: 2, piid: 3 },
        power: { siid: 2, piid: 1 },
        swing_h: { siid: 2, piid: 6 },
        swing_h_angle: { siid: 2, piid: 7 }
    }
};

const p43 = {
    fanLevels: [1, 2, 3, 4],
    modes: [MODE.REGULAR, MODE.NATURAL, MODE.SLEEP],
    horizontalAngles: [30, 60, 90],
    rotate: { via: 'action', siid: 2, left: 2, right: 3 },
    props: {
        buzzer: { siid: 5, piid: 1 },
        child_lock: { siid: 6, piid: 1 },
        fan_level: { siid: 2, piid: 2 },
        fan_speed: { siid: 2, piid: 6 },
        light: { siid: 4, piid: 1 },
        mode: { siid: 2, piid: 3 },
        power: { siid: 2, piid: 1 },
        swing_h: { siid: 2, piid: 4 },
        swing_h_angle: { siid: 2, piid: 5 }
    }
};

const p45 = {
    fanLevels: [1, 2, 3, 4],
    modes: [MODE.REGULAR, MODE.NATURAL, MODE.SLEEP],
    horizontalAngles: [30, 60, 90, 120, 150],
    rotate: { via: 'action', siid: 2, left: 4, right: 5 },
    props: {
        buzzer: { siid: 7, piid: 1 },
        child_lock: { siid: 11, piid: 1 },
        fan_level: { siid: 2, piid: 4 },
        fan_speed: { siid: 2, piid: 5 },
        light: { siid: 5, piid: 1 },
        mode: { siid: 2, piid: 3 },
        power: { siid: 2, piid: 1 },
        swing_h: { siid: 2, piid: 6 },
        swing_h_angle: { siid: 2, piid: 7 }
    }
};

const p51 = {
    fanLevels: [1, 2, 3, 4],
    modes: [MODE.REGULAR, MODE.NATURAL],
    horizontalAngles: [30, 60, 90, 120],
    rotate: { via: 'action', siid: 2, left: 4, right: 5 },
    props: {
        buzzer: { siid: 6, piid: 1 },
        child_lock: { siid: 7, piid: 1 },
        fan_level: { siid: 2, piid: 2 },
        fan_speed: { siid: 2, piid: 6 },
        light: { siid: 5, piid: 1 },
        mode: { siid: 2, piid: 3 },
        power: { siid: 2, piid: 1 },
        swing_h: { siid: 2, piid: 4 },
        swing_h_angle: { siid: 2, piid: 5 }
    }
};

const p70 = {
    fanLevels: [0, 1, 2, 3],
    modes: [MODE.REGULAR, MODE.NATURAL],
    horizontalAngles: [30, 60, 90, 120],
    verticalAngles: [30, 60, 90, 100],
    rotate: { via: 'action', siid: 2, left: 4, right: 5, up: 6, down: 7 },
    props: {
        buzzer: { siid: 7, piid: 1 },
        child_lock: { siid: 8, piid: 1 },
        fan_level: { siid: 2, piid: 4 },
        fan_speed: { siid: 2, piid: 5 },
        light: { siid: 5, piid: 1 },
        mode: { siid: 2, piid: 3 },
        power: { siid: 2, piid: 1 },
        swing_h: { siid: 2, piid: 6 },
        swing_h_angle: { siid: 2, piid: 7 },
        swing_v: { siid: 2, piid: 8 },
        swing_v_angle: { siid: 2, piid: 9 }
    }
};

const p85 = {
    fanLevels: [1, 2, 3, 4],
    modes: [MODE.REGULAR, MODE.NATURAL],
    horizontalAngles: [30, 60, 90],
    rotate: { via: 'action', siid: 2, left: 6, right: 7 },
    props: {
        buzzer: { siid: 7, piid: 1 },
        child_lock: { siid: 8, piid: 1 },
        fan_level: { siid: 2, piid: 4 },
        fan_speed: { siid: 11, piid: 6 },
        light: { siid: 5, piid: 1 },
        mode: { siid: 2, piid: 3 },
        power: { siid: 2, piid: 1 },
        swing_h: { siid: 2, piid: 6 },
        swing_h_angle: { siid: 2, piid: 7 }
    }
};

/* Fallback for unknown xiaomi.fan.* models: p70 property layout, generic modes. */
const DEFAULT = {
    fallback: true,
    fanLevels: [1, 2, 3, 4],
    modes: [MODE.REGULAR, MODE.NATURAL],
    horizontalAngles: [30, 60, 90],
    props: {
        buzzer: { siid: 7, piid: 1 },
        child_lock: { siid: 8, piid: 1 },
        fan_level: { siid: 2, piid: 4 },
        fan_speed: { siid: 2, piid: 5 },
        light: { siid: 5, piid: 1 },
        mode: { siid: 2, piid: 3 },
        power: { siid: 2, piid: 1 },
        swing_h: { siid: 2, piid: 6 },
        swing_h_angle: { siid: 2, piid: 7 }
    }
};

const MODELS = {
    'xiaomi.fan.p30': p30,
    'xiaomi.fan.p43': p43,
    'xiaomi.fan.p45': p45,
    'xiaomi.fan.p51': p51,
    'xiaomi.fan.p69': p70,
    'xiaomi.fan.p70': p70,
    'xiaomi.fan.p76': p70,
    'xiaomi.fan.p85': p85
};

module.exports = { MODELS, DEFAULT };
