'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const EventEmitter = require('node:events');

let scenario;
let sockets;
class Socket extends EventEmitter {
  connect(port, address, callback) { this.address = address; queueMicrotask(callback); }
  send(data, offset, length, callback) { callback(); }
  close() { this.closed = true; }
}
class DeviceInfo {
  constructor(transport) { this.transport = transport; this.packet = {}; }
  async handshake() { if (scenario === 'handshake') throw Object.assign(new Error('timeout'), { code: 'timeout' }); }
  async call(method, args, options) {
    assert.equal(method, 'miIO.info');
    assert.deepEqual(options, { retries: 1 });
    if (scenario === 'authentication') throw Object.assign(new Error('timeout'), { code: 'timeout' });
    if (scenario === 'device_error') throw Object.assign(new Error('unsupported'), { code: -10000 });
    if (scenario === 'unexpected') return null;
    return { model: 'example.model' };
  }
}
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'dgram') return { createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; } };
  if (request === 'miio/lib/device_info') return DeviceInfo;
  return originalLoad.call(this, request, parent, isMain);
};
const { diagnoseConnection } = require('../lib/connection-diagnostic');
Module._load = originalLoad;

const token = '0123456789abcdef0123456789abcdef';
test('connection diagnostic classifies each stage and always closes the isolated socket', async () => {
  for (const [inputScenario, expectedHandshake, expectedAuthentication] of [
    ['success', 'passed', 'passed'],
    ['handshake', 'no_response', 'not_tested'],
    ['authentication', 'passed', 'no_response'],
    ['device_error', 'passed', 'device_error'],
    ['unexpected', 'passed', 'unexpected_response']
  ]) {
    scenario = inputScenario;
    sockets = [];
    const result = await diagnoseConnection('192.0.2.10', token);
    assert.deepEqual(result, { input: 'valid', handshake: expectedHandshake, authentication: expectedAuthentication });
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].closed, true);
  }
});

test('invalid settings do not open a socket', async () => {
  sockets = [];
  assert.deepEqual(await diagnoseConnection('192.0.2.10', 'bad-token'), {
    input: 'invalid', handshake: 'not_tested', authentication: 'not_tested'
  });
  assert.equal(sockets.length, 0);
  assert.equal((await diagnoseConnection('999.1.1.1', token)).input, 'invalid');
  assert.equal(sockets.length, 0);
});
