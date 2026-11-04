'use strict';

const dgram = require('dgram');
const net = require('net');
const DeviceInfo = require('miio/lib/device_info');

// Use an isolated socket and DeviceInfo so a probe cannot replace the token or
// destroy the shared miio connection used by an already paired device.
async function diagnoseConnection(address, token) {
  const result = { input: 'invalid', handshake: 'not_tested', authentication: 'not_tested' };
  if (typeof address !== 'string' || !address.trim() || address !== address.trim()
    || typeof token !== 'string' || !/^[a-fA-F0-9]{32}$/.test(token)) return result;
  const hostname = address.length <= 253 && !/^[\d.]+$/.test(address)
    && address.split('.').every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
  if (net.isIP(address) !== 4 && !hostname) return result;
  result.input = 'valid';
  const socket = dgram.createSocket('udp4');
  let stage = 'handshake';
  let socketError;
  const onError = (error) => { socketError = error; };
  socket.on('error', onError);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 2000);
      socket.once('error', reject);
      socket.connect(54321, address, () => {
        clearTimeout(timer);
        socket.removeListener('error', reject);
        resolve();
      });
      socket.once('error', () => clearTimeout(timer));
    });
    const transport = { socket: { send: (data, offset, length, port, host, callback) => socket.send(data, offset, length, callback) } };
    const info = new DeviceInfo(transport, null, address, 54321);
    info.packet.token = Buffer.from(token, 'hex');
    socket.on('message', (message) => {
      if (message.length < 32 || message.readUInt16BE(0) !== 0x2131
        || message.readUInt16BE(2) !== message.length) return;
      if (stage === 'handshake' && (message.length !== 32
        || message.readUInt32BE(8) === 0 || message.readUInt32BE(8) === 0xffffffff)) return;
      info.onMessage(message);
    });
    await info.handshake();
    result.handshake = 'passed';
    stage = 'authentication';
    const response = await info.call('miIO.info', [], { retries: 1 });
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      result.authentication = 'passed';
    } else {
      result.authentication = 'unexpected_response';
    }
  } catch (error) {
    if (stage === 'handshake') result.handshake = socketError || (error && error.code !== 'timeout') ? 'error' : 'no_response';
    else if (error && error.code === 'timeout') result.authentication = 'no_response';
    else if (error && /^-\d+$/.test(String(error.code))) result.authentication = 'device_error';
    else result.authentication = 'error';
  } finally {
    try { socket.close(); } catch (_) { /* Socket was not opened. */ }
  }
  return result;
}

module.exports = { diagnoseConnection };
