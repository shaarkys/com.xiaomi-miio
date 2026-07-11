'use strict';

const crypto = require('crypto');
const miio = require('miio');
const Driver = require('../wifi_driver.js');
const Util = require('../../lib/util.js');

const SUPPORTED_MODEL = 'chunmi.cooker.r2';

class ChunmiRiceCookerDriver extends Driver {
  onInit() {
    if (!this.util) this.util = new Util({ homey: this.homey });
  }

  onPair(session) {
    let deviceObject;

    session.setHandler('test_connection', async (data) => {
      let device;
      try {
        device = await miio.device({ address: data.address, token: data.token });
        const model = device.miioModel;
        if (model !== SUPPORTED_MODEL) {
          throw new Error(`Unsupported model ${model}. Expected ${SUPPORTED_MODEL}.`);
        }

        deviceObject = {
          name: `${this.util.getFriendlyNameWiFi(model)} (${model})`,
          data: {
            id: `${model}:${crypto.createHash('sha256').update(data.token).digest('hex')}`
          },
          settings: {
            address: data.address,
            token: data.token,
            polling: data.polling
          },
          store: {
            model
          }
        };

        return deviceObject;
      } catch (error) {
        this.error(error);
        throw error;
      } finally {
        try {
          device?.destroy();
        } catch (_) {
          // The pairing probe may already have released the connection.
        }
      }
    });

    session.setHandler('add_device', async () => {
      if (!deviceObject) throw new Error('Test the connection before adding the device.');
      return deviceObject;
    });
  }
}

module.exports = ChunmiRiceCookerDriver;
