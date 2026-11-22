'use strict';

const dgram = require('dgram');
const DeviceInfo = require('miio/lib/device_info');

const PORT = 54321;
const CONNECT_TIMEOUT = 2000;

function closeSocket(socket) {
  try {
    socket.close();
  } catch (_) {
    // A failed or already closed UDP socket needs no further cleanup.
  }
}

function connectSocket(socket, address, port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('error', onConnectError);
      if (error) reject(error);
      else resolve();
    };
    const onConnectError = (error) => finish(error);
    // Keep this as a plain connection error. The diagnostic intentionally
    // distinguishes a native socket-connect failure from a miIO handshake
    // timeout (which is tagged with code=timeout by DeviceInfo).
    const timer = setTimeout(() => finish(new Error('Socket connection timed out')), CONNECT_TIMEOUT);

    socket.once('error', onConnectError);
    try {
      socket.connect(port, address, () => finish());
    } catch (error) {
      finish(error);
    }
  });
}

/**
 * Creates an isolated connected miIO UDP transport. The caller owns the
 * returned transport and must call close(), including after a failed command.
 * It deliberately does not use miio's process-wide network singleton.
 */
async function openIsolatedMiioTransport({ address, token, messageFilter, port = PORT }) {
  const socket = dgram.createSocket('udp4');
  const state = { socketError: null, closed: false };
  const onSocketError = (error) => { state.socketError = error; };
  socket.on('error', onSocketError);

  try {
    await connectSocket(socket, address, port);

    const transport = {
      socket: {
        // The native socket is connected, so DeviceInfo's address/port arguments
        // must not select or share another miio socket.
        send: (data, offset, length, port, host, callback) => socket.send(data, offset, length, callback)
      }
    };
    const info = new DeviceInfo(transport, null, address, port);
    info.packet.token = Buffer.from(token, 'hex');

    const onMessage = (message) => {
      if (!Buffer.isBuffer(message) || message.length < 32
        || message.readUInt16BE(0) !== 0x2131 || message.readUInt16BE(2) !== message.length) return;
      if (messageFilter && !messageFilter(message)) return;
      try {
        info.onMessage(message);
      } catch (_) {
        // A malformed UDP datagram must not escape an EventEmitter callback.
      }
    };
    socket.on('message', onMessage);

    return {
      info,
      get socketError() { return state.socketError; },
      close() {
        if (state.closed) return;
        state.closed = true;
        socket.removeListener('message', onMessage);
        closeSocket(socket);
      }
    };
  } catch (error) {
    state.closed = true;
    closeSocket(socket);
    throw error;
  }
}

module.exports = { openIsolatedMiioTransport };
