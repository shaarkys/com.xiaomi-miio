'use strict';

const net = require('net');
const { openIsolatedMiioTransport } = require('./isolated-miio');

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
  let stage = 'handshake';
  let transport;
  try {
    transport = await openIsolatedMiioTransport({
      address,
      token,
      messageFilter: (message) => {
        if (stage !== 'handshake') return true;
        return message.length === 32 && message.readUInt32BE(8) !== 0 && message.readUInt32BE(8) !== 0xffffffff;
      }
    });
    const info = transport.info;
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
    if (stage === 'handshake') result.handshake = (transport && transport.socketError) || (error && error.code !== 'timeout') ? 'error' : 'no_response';
    else if (error && error.code === 'timeout') result.authentication = 'no_response';
    else if (error && /^-\d+$/.test(String(error.code))) result.authentication = 'device_error';
    else result.authentication = 'error';
  } finally {
    if (transport) transport.close();
  }
  return result;
}

module.exports = { diagnoseConnection };
