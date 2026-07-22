'use strict';

const MODEL_PROFILES = {
  'xiaomi.airp.mb5': {
    mapping: 'mapping_xiaomi_mb5',
    properties: {
      get_properties: [
        { did: 'power', siid: 2, piid: 1 },
        { did: 'fanlevel', siid: 2, piid: 5 },
        { did: 'mode', siid: 2, piid: 4 },
        { did: 'humidity', siid: 3, piid: 1 },
        { did: 'temperature', siid: 3, piid: 7 },
        { did: 'aqi', siid: 3, piid: 4 },
        { did: 'anion', siid: 2, piid: 6 },
        { did: 'uv', siid: 2, piid: 7 },
        { did: 'buzzer', siid: 6, piid: 1 },
        { did: 'child_lock', siid: 8, piid: 1 },
        { did: 'light', siid: 7, piid: 1 },
        { did: 'filter_life_remaining', siid: 4, piid: 1 },
        { did: 'filter_hours_used', siid: 4, piid: 3 }
      ],
      set_properties: {
        power: { siid: 2, piid: 1 },
        ion: { siid: 2, piid: 6 },
        uv: { siid: 2, piid: 7 },
        fanlevel: { siid: 2, piid: 5 },
        mode: { siid: 2, piid: 4 },
        buzzer: { siid: 6, piid: 1 },
        child_lock: { siid: 8, piid: 1 },
        light: { siid: 7, piid: 1 }
      },
      device_properties: {
        light: { min: false, max: true }
      }
    },
    value_maps: {
      mode: {
        to_device: { 0: 0, 1: 3, 2: 5, 3: 6 },
        from_device: { 0: '0', 3: '1', 5: '2', 6: '3' }
      },
      fanlevel: {
        to_device: { 1: 0, 2: 1, 3: 2 },
        from_device: { 0: '1', 1: '2', 2: '3' }
      }
    }
  }
};

const OPTIONAL_CAPABILITIES = [
  { capability: 'onoff.ion', property: 'ion', did: 'anion' },
  { capability: 'onoff.uv', property: 'uv', did: 'uv' }
];

function getModelProfile(model) {
  return MODEL_PROFILES[model];
}

function encodeValue(profile, property, value) {
  const valueMap = profile?.value_maps?.[property]?.to_device;
  if (!valueMap) return Number(value);

  const key = String(value);
  if (!Object.prototype.hasOwnProperty.call(valueMap, key)) {
    throw new Error(`Unsupported ${property} value: ${value}`);
  }
  return valueMap[key];
}

function decodeValue(profile, property, value) {
  const valueMap = profile?.value_maps?.[property]?.from_device;
  if (!valueMap) return String(value);

  const key = String(value);
  return Object.prototype.hasOwnProperty.call(valueMap, key) ? valueMap[key] : undefined;
}

function findValidResult(result, did) {
  return result.find((entry) => entry.did === did
    && (entry.code === undefined || entry.code === 0)
    && entry.value !== undefined
    && entry.value !== null);
}

function getOptionalCapabilities(properties) {
  return OPTIONAL_CAPABILITIES.filter(({ property, did }) => properties.get_properties.some((entry) => entry.did === did)
    && properties.set_properties[property] !== undefined);
}

module.exports = {
  MODEL_PROFILES,
  getModelProfile,
  encodeValue,
  decodeValue,
  findValidResult,
  getOptionalCapabilities
};
