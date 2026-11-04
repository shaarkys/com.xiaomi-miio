'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { diagnoseConnection } = require('../lib/connection-diagnostic');

test('diagnostic completes a handshake and encrypted info request against a local protocol fixture', async (t) => {
  const token = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const server = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.bind(54321, '127.0.0.1', resolve);
    });
  } catch (error) {
    server.close();
    if (error.code === 'EADDRINUSE') return t.skip('Local UDP fixture port is in use');
    throw error;
  }
  server.on('message', (message, peer) => {
    if (message.length === 32) {
      const reply = Buffer.alloc(32, 0xff);
      reply.writeUInt16BE(0x2131, 0);
      reply.writeUInt16BE(32, 2);
      reply.writeUInt32BE(1234, 8);
      reply.writeUInt32BE(100, 12);
      server.send(reply, peer.port, peer.address);
      return;
    }
    const key = crypto.createHash('md5').update(token).digest();
    const iv = crypto.createHash('md5').update(Buffer.concat([key, token])).digest();
    let request;
    try {
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      request = JSON.parse(Buffer.concat([decipher.update(message.subarray(32)), decipher.final()]).toString().replace(/\0+$/, ''));
    } catch (_) {
      return;
    }
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    const payload = Buffer.concat([cipher.update(JSON.stringify({ id: request.id, result: { model: 'example.model' } })), cipher.final()]);
    const header = Buffer.alloc(32);
    header.writeUInt16BE(0x2131, 0);
    header.writeUInt16BE(32 + payload.length, 2);
    header.writeUInt32BE(1234, 8);
    header.writeUInt32BE(100, 12);
    crypto.createHash('md5').update(header.subarray(0, 16)).update(token).update(payload).digest().copy(header, 16);
    server.send(Buffer.concat([header, payload]), peer.port, peer.address);
  });
  try {
    assert.deepEqual(await diagnoseConnection('127.0.0.1', token.toString('hex')), {
      input: 'valid', handshake: 'passed', authentication: 'passed'
    });
    assert.deepEqual(await diagnoseConnection('127.0.0.1', 'ffffffffffffffffffffffffffffffff'), {
      input: 'valid', handshake: 'passed', authentication: 'no_response'
    });
  } finally {
    server.close();
  }
});
