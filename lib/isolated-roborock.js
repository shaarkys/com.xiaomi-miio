'use strict';

const Vacuum = require('miio/lib/devices/vacuum');
const { openIsolatedMiioTransport } = require('./isolated-miio');

class IsolatedRoborock extends Vacuum {
  internalPoll() {
    // Preserve the superclass init lifecycle without its initial or recurring
    // background I/O. Homey owns the recovery polling schedule.
    return Promise.resolve();
  }

  call(method, args = [], options = {}) {
    // Do not run the Vacuum wrapper's delayed status/consumable refresh. A
    // timed-out command is ambiguous, so writes are never replayed. The
    // driver deliberately requests a second get_status attempt for regular
    // recovery polls and that bounded read retry remains available.
    const retries = method === 'get_status' && options.retries === 2 ? 2 : 1;
    return this.handle.api.call(method, args, { ...options, retries });
  }
}

/**
 * Open a fresh, typed Roborock client on a private UDP socket.
 *
 * This is intentionally not miio.device(): the latter reuses miio's global
 * network and starts a polling loop that can race Homey's own recovery poll.
 */
async function openRoborockConnection({ address, token, model, port }) {
  let transport;
  try {
    let stage = 'handshake';
    transport = await openIsolatedMiioTransport({
      address,
      token,
      port,
      messageFilter: (message) => stage !== 'handshake' || (message.length === 32
        && message.readUInt32BE(8) !== 0 && message.readUInt32BE(8) !== 0xffffffff)
    });
    transport.info.model = model;
    await transport.info.handshake();
    stage = 'ready';

    const device = new IsolatedRoborock({
      api: transport.info,
      ref: { release: transport.close }
    });
    await device.init();
    return device;
  } catch (error) {
    if (transport) transport.close();
    throw error;
  }
}

module.exports = { openRoborockConnection };
