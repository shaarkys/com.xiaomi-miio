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
const Util = require('../lib/util.js');

const profile = getModelProfile('xiaomi.airp.mb5');
const cpa5Profile = getModelProfile('xiaomi.airp.cpa5');

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

test('xiaomi.airp.cpa5 uses its dedicated released MIoT property layout', () => {
  assert.ok(cpa5Profile);
  assert.equal(cpa5Profile.mapping, 'mapping_xiaomi_cpa5');

  const readable = Object.fromEntries(cpa5Profile.properties.get_properties.map(({ did, siid, piid }) => [did, { siid, piid }]));
  assert.deepEqual(readable, {
    power: { siid: 2, piid: 1 },
    mode: { siid: 2, piid: 3 },
    aqi: { siid: 3, piid: 4 },
    filter_life_remaining: { siid: 4, piid: 1 },
    filter_hours_used: { siid: 4, piid: 3 },
    light: { siid: 6, piid: 2 },
    buzzer: { siid: 7, piid: 1 },
    child_lock: { siid: 8, piid: 1 },
    fanlevel: { siid: 9, piid: 1 }
  });
  assert.equal(readable.humidity, undefined);
  assert.equal(readable.temperature, undefined);
  assert.equal(readable.anion, undefined);
  assert.equal(readable.uv, undefined);
  assert.equal(readable.purify_volume, undefined);

  assert.deepEqual(cpa5Profile.properties.set_properties, {
    power: { siid: 2, piid: 1 },
    mode: { siid: 2, piid: 3 },
    light: { siid: 6, piid: 2 },
    buzzer: { siid: 7, piid: 1 },
    child_lock: { siid: 8, piid: 1 },
    fanlevel: { siid: 9, piid: 1 }
  });
  assert.deepEqual(cpa5Profile.properties.device_properties.light, { min: 0, max: 2 });
});

test('xiaomi.airp.cpa5 modes preserve the Homey enum and reject unsupported mode 3', () => {
  const expected = new Map([
    ['0', 0],
    ['1', 1],
    ['2', 2]
  ]);

  for (const [homeyValue, deviceValue] of expected) {
    assert.equal(encodeValue(cpa5Profile, 'mode', homeyValue), deviceValue);
    assert.equal(decodeValue(cpa5Profile, 'mode', deviceValue), homeyValue);
  }

  assert.throws(() => encodeValue(cpa5Profile, 'mode', '3'), /Unsupported mode value/);
  assert.equal(decodeValue(cpa5Profile, 'mode', 3), undefined);
});

test('xiaomi.airp.cpa5 favorite fan level is numeric and limited to 0 through 14', () => {
  for (const level of [0, 7, 14]) {
    assert.equal(encodeValue(cpa5Profile, 'fanlevel', level), level);
    assert.equal(decodeValue(cpa5Profile, 'fanlevel', level), String(level));
  }

  assert.throws(() => encodeValue(cpa5Profile, 'fanlevel', -1), /Unsupported fanlevel value/);
  assert.throws(() => encodeValue(cpa5Profile, 'fanlevel', 15), /Unsupported fanlevel value/);
  assert.equal(decodeValue(cpa5Profile, 'fanlevel', 15), undefined);
});

test('xiaomi.airp.cpa5 has its App-facing friendly name', () => {
  assert.equal(new Util({}).getFriendlyNameWiFi('xiaomi.airp.cpa5'), 'Xiaomi Smart Pet Care Air Purifier');
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

test('CPA4 and CPA5 fan levels ignore failed or null MIoT results but preserve zero', () => {
  for (const model of ['xiaomi.airp.cpa4', 'xiaomi.airp.cpa5']) {
    const invalidResult = [
      { did: 'fanlevel', code: -4004, value: 7 },
      { did: 'fanlevel', code: 0, value: null }
    ];
    assert.equal(findValidResult(invalidResult, 'fanlevel'), undefined, `${model} invalid fan level should be ignored`);

    const validResult = [{ did: 'fanlevel', code: 0, value: 0 }];
    assert.deepEqual(findValidResult(validResult, 'fanlevel'), validResult[0], `${model} zero fan level should be accepted`);
  }
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
