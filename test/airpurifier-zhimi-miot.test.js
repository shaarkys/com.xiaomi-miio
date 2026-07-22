'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getModelProfile,
  encodeValue,
  decodeValue,
  findValidResult,
  getOptionalCapabilities
} = require('../lib/airpurifier-zhimi-miot.js');

const driverCompose = require('../drivers/airpurifier_zhimi_advanced_miot/driver.compose.json');

const profile = getModelProfile('xiaomi.airp.mb5');

test('xiaomi.airp.mb5 uses its released MIoT property layout', () => {
  assert.ok(profile);

  const readable = Object.fromEntries(profile.properties.get_properties.map(({ did, siid, piid }) => [did, { siid, piid }]));
  assert.deepEqual(readable, {
    power: { siid: 2, piid: 1 },
    fanlevel: { siid: 2, piid: 5 },
    mode: { siid: 2, piid: 4 },
    humidity: { siid: 3, piid: 1 },
    temperature: { siid: 3, piid: 7 },
    aqi: { siid: 3, piid: 4 },
    anion: { siid: 2, piid: 6 },
    uv: { siid: 2, piid: 7 },
    buzzer: { siid: 6, piid: 1 },
    child_lock: { siid: 8, piid: 1 },
    light: { siid: 7, piid: 1 },
    filter_life_remaining: { siid: 4, piid: 1 },
    filter_hours_used: { siid: 4, piid: 3 }
  });
  assert.equal(readable.purify_volume, undefined, 'the MB5 spec has no purify-volume property');

  assert.deepEqual(profile.properties.set_properties.buzzer, { siid: 6, piid: 1 });
  assert.deepEqual(profile.properties.set_properties.light, { siid: 7, piid: 1 });
});

test('xiaomi.airp.mb5 mode values round-trip through the existing Homey capability IDs', () => {
  const expected = new Map([
    ['0', 0],
    ['1', 3],
    ['2', 5],
    ['3', 6]
  ]);

  for (const [homeyValue, deviceValue] of expected) {
    assert.equal(encodeValue(profile, 'mode', homeyValue), deviceValue);
    assert.equal(decodeValue(profile, 'mode', deviceValue), homeyValue);
  }
});

test('xiaomi.airp.mb5 zero-based fan levels round-trip through the legacy 1-based capability', () => {
  const expected = new Map([
    ['1', 0],
    ['2', 1],
    ['3', 2]
  ]);

  for (const [homeyValue, deviceValue] of expected) {
    assert.equal(encodeValue(profile, 'fanlevel', homeyValue), deviceValue);
    assert.equal(decodeValue(profile, 'fanlevel', deviceValue), homeyValue);
  }
});

test('unknown enum values are rejected instead of being written to Homey or the purifier', () => {
  assert.throws(() => encodeValue(profile, 'mode', '4'), /Unsupported mode value/);
  assert.throws(() => encodeValue(profile, 'fanlevel', '0'), /Unsupported fanlevel value/);
  assert.equal(decodeValue(profile, 'mode', 1), undefined);
  assert.equal(decodeValue(profile, 'fanlevel', 3), undefined);
});

test('optional MIoT properties ignore failed and empty results', () => {
  const result = [
    { did: 'anion', code: -4004 },
    { did: 'uv', code: 0, value: null },
    { did: 'mode', code: 0, value: 3 }
  ];

  assert.equal(findValidResult(result, 'anion'), undefined);
  assert.equal(findValidResult(result, 'uv'), undefined);
  assert.deepEqual(findValidResult(result, 'mode'), { did: 'mode', code: 0, value: 3 });
});

test('ion and UV remain model-specific instead of becoming default driver capabilities', () => {
  assert.deepEqual(getOptionalCapabilities(profile.properties).map(({ capability }) => capability), ['onoff.ion', 'onoff.uv']);
  assert.ok(!driverCompose.capabilities.includes('onoff.ion'));
  assert.ok(!driverCompose.capabilities.includes('onoff.uv'));
  assert.ok(driverCompose.capabilitiesOptions['onoff.ion']);
  assert.ok(driverCompose.capabilitiesOptions['onoff.uv']);

  const unsupportedProperties = {
    get_properties: [{ did: 'power', siid: 2, piid: 1 }],
    set_properties: { power: { siid: 2, piid: 1 } }
  };
  assert.deepEqual(getOptionalCapabilities(unsupportedProperties), []);
});
