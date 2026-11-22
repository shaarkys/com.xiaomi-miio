'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const Vacuum = require('miio/lib/devices/vacuum');
const { openRoborockConnection } = require('../lib/isolated-roborock');

function decryptRequest(message, token) {
  const key = crypto.createHash('md5').update(token).digest();
  const iv = crypto.createHash('md5').update(Buffer.concat([key, token])).digest();
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return JSON.parse(Buffer.concat([decipher.update(message.subarray(32)), decipher.final()]).toString().replace(/\0+$/, ''));
}

function encryptedReply(request, result, token) {
  const key = crypto.createHash('md5').update(token).digest();
  const iv = crypto.createHash('md5').update(Buffer.concat([key, token])).digest();
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify({ id: request.id, result })), cipher.final()]);
  const header = Buffer.alloc(32);
  header.writeUInt16BE(0x2131, 0);
  header.writeUInt16BE(32 + payload.length, 2);
  header.writeUInt32BE(1234, 8);
  header.writeUInt32BE(100, 12);
  crypto.createHash('md5').update(header.subarray(0, 16)).update(token).update(payload).digest().copy(header, 16);
  return Buffer.concat([header, payload]);
}

test('isolated Roborock client handshakes afresh, executes direct calls and closes cleanly', async (t) => {
  const token = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const server = dgram.createSocket('udp4');
  const methods = [];
  let handshakes = 0;
  let retryStatus = false;
  let retryStatusAttempts = 0;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.bind(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    server.close();
    if (error.code === 'EADDRINUSE') return t.skip('Local UDP fixture port is in use');
    throw error;
  }

  server.on('message', (message, peer) => {
    if (message.length === 32) {
      handshakes++;
      const reply = Buffer.alloc(32, 0xff);
      reply.writeUInt16BE(0x2131, 0);
      reply.writeUInt16BE(32, 2);
      reply.writeUInt32BE(1234, 8);
      reply.writeUInt32BE(100, 12);
      server.send(reply, peer.port, peer.address);
      return;
    }

    let request;
    try {
      request = decryptRequest(message, token);
    } catch (_) {
      return;
    }
    methods.push(request.method);
    if (request.method === 'app_start') return;
    if (request.method === 'get_status' && retryStatus && ++retryStatusAttempts === 1) return;
    const result = request.method === 'get_status'
      ? [{ state: 8, battery: 77 }]
      : { model: 'roborock.vacuum.s5' };
    server.send(encryptedReply(request, result, token), peer.port, peer.address);
  });

  let first;
  let second;
  try {
    const port = server.address().port;
    first = await openRoborockConnection({
      address: '127.0.0.1', token: token.toString('hex'), model: 'roborock.vacuum.s5', port
    });
    assert.ok(first instanceof Vacuum);
    assert.deepEqual(await first.call('get_status'), [{ state: 8, battery: 77 }]);
    await assert.rejects(first.activateCleaning(), { code: 'timeout' });
    await first.destroy();
    await first.destroy();

    second = await openRoborockConnection({
      address: '127.0.0.1', token: token.toString('hex'), model: 'roborock.vacuum.s5', port
    });
    assert.deepEqual(await second.call('get_status'), [{ state: 8, battery: 77 }]);
    retryStatus = true;
    assert.deepEqual(await second.call('get_status', [], { retries: 2 }), [{ state: 8, battery: 77 }]);
    assert.equal(handshakes, 2);
    assert.equal(methods.filter((method) => method === 'app_start').length, 1);
    assert.deepEqual(methods, ['get_status', 'app_start', 'get_status', 'get_status', 'get_status']);
  } finally {
    if (first) await first.destroy();
    if (second) await second.destroy();
    server.close();
  }
});
