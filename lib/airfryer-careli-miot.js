'use strict';

const COMMON_PROPERTIES = [
  { did: 'status', siid: 2, piid: 1 },
  { did: 'fault', siid: 2, piid: 2 },
  { did: 'target_time', siid: 2, piid: 3 },
  { did: 'target_temperature', siid: 2, piid: 4 }
];

const COMMON_ACTIONS = {
  start_cook: { siid: 2, aiid: 1, did: 'call-2-1', in: [] },
  stop_cook: { siid: 2, aiid: 2, did: 'call-2-2', in: [] }
};

const LEGACY_SET_PROPERTIES = {
  target_time: { siid: 2, piid: 3 },
  target_temperature: { siid: 2, piid: 4 },
  food_quantity: { siid: 3, piid: 6 },
  preheat_switch: { siid: 3, piid: 7 }
};

const LEGACY_STATUS_NAMES = {
  0: 'Shutdown',
  1: 'Standby',
  2: 'Pause',
  3: 'Schedule',
  4: 'Cooking',
  5: 'Preheat',
  6: 'Cooked',
  7: 'Preheat finished',
  8: 'Preheat paused',
  9: 'Pause2'
};

const MAF65_STATUS_NAMES = {
  ...LEGACY_STATUS_NAMES,
  9: 'Turn pot paused',
  10: 'Keep warm',
  11: 'Keep warm paused',
  12: 'Keep warm finished',
  13: 'Crispy roast',
  14: 'Degrease'
};

const DEFAULT_PROFILE = {
  mapping: 'properties_default',
  properties: {
    get_properties: [
      ...COMMON_PROPERTIES,
      { did: 'food_quantity', siid: 3, piid: 6 },
      { did: 'preheat_switch', siid: 3, piid: 7 }
    ],
    set_properties: LEGACY_SET_PROPERTIES,
    actions: COMMON_ACTIONS
  },
  active_statuses: new Set([4, 5, 6, 7]),
  preheat_values: { on: 2, off: 1 },
  status_names: LEGACY_STATUS_NAMES
};

const MODEL_PROFILES = {
  'careli.fryer.maf10a': {
    mapping: 'properties_maf10a',
    properties: {
      get_properties: COMMON_PROPERTIES,
      set_properties: LEGACY_SET_PROPERTIES,
      actions: COMMON_ACTIONS
    },
    active_statuses: DEFAULT_PROFILE.active_statuses,
    preheat_values: DEFAULT_PROFILE.preheat_values,
    status_names: LEGACY_STATUS_NAMES
  },
  'xiaomi.fryer.maf65': {
    mapping: 'properties_maf65',
    properties: {
      get_properties: [
        ...COMMON_PROPERTIES,
        { did: 'food_quantity', siid: 2, piid: 13 },
        { did: 'preheat_switch', siid: 2, piid: 9 }
      ],
      set_properties: {
        target_time: { siid: 2, piid: 3 },
        target_temperature: { siid: 2, piid: 4 },
        food_quantity: { siid: 2, piid: 13 },
        preheat_switch: { siid: 2, piid: 9 }
      },
      actions: COMMON_ACTIONS
    },
    active_statuses: new Set([4, 5, 6, 7, 10, 13, 14]),
    preheat_values: { on: true, off: false },
    status_names: MAF65_STATUS_NAMES,
    target_temperature_options: { min: 40, max: 230, step: 5 }
  }
};

function getModelProfile(model) {
  return MODEL_PROFILES[model] || DEFAULT_PROFILE;
}

function findValidResult(result, did) {
  if (!Array.isArray(result)) return undefined;

  return result.find((entry) => entry.did === did
    && (entry.code === undefined || entry.code === 0)
    && entry.value !== undefined
    && entry.value !== null);
}

function encodePreheat(profile, enabled) {
  return enabled ? profile.preheat_values.on : profile.preheat_values.off;
}

function decodePreheat(profile, value) {
  return value === profile.preheat_values.on;
}

module.exports = {
  DEFAULT_PROFILE,
  MODEL_PROFILES,
  LEGACY_STATUS_NAMES,
  MAF65_STATUS_NAMES,
  getModelProfile,
  findValidResult,
  encodePreheat,
  decodePreheat
};
