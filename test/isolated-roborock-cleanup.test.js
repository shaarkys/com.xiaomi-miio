'use strict';

const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');
const test = require('node:test');

const sockets = [];
class Socket extends EventEmitter {
  connect(port, address, callback) { queueMicrotask(callback); }
  close() { this.closed = true; }
}
class DeviceInfo {
  constructor() { this.packet = {}; }
  async handshake() { throw Object.assign(new Error('timeout'), { code: 'timeout' }); }
}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'dgram') return { createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; } };
  if (request === 'miio/lib/device_info') return DeviceInfo;
  return originalLoad.call(this, request, parent, isMain);
};
const { openRoborockConnection } = require('../lib/isolated-roborock');
Module._load = originalLoad;

test('isolated Roborock setup closes its private socket when the handshake fails', async () => {
  await assert.rejects(openRoborockConnection({
    address: '192.0.2.10', token: '0123456789abcdef0123456789abcdef', model: 'roborock.vacuum.s5'
  }), { code: 'timeout' });
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].closed, true);
});
