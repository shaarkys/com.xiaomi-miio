'use strict';

const crypto = require('crypto');
const miio = require('miio');
const Driver = require('../wifi_driver.js');
const Util = require('../../lib/util.js');

const SUPPORTED_MODELS = new Set([
  'xiaomi.repeater.v2',
  'xiaomi.repeater.v3',
  'xiaomi.repeater.rd10m'
]);

const LEGACY_CAPABILITIES = [
  'measure_repeater_connected_devices',
  'measure_repeater_signal_strength',
  'repeater_wifi_roaming'
];

const RD10M_CAPABILITIES = [
  'measure_repeater_download_speed',
  'measure_repeater_upload_speed',
  'measure_repeater_connected_devices',
  'repeater_status',
  'alarm_repeater_fault',
  'repeater_indicator_light',
  'repeater_indicator_brightness'
];

class XiaomiRepeaterDriver extends Driver {
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
        if (!SUPPORTED_MODELS.has(model)) {
          throw new Error(`Unsupported model ${model}. Expected xiaomi.repeater.v2, xiaomi.repeater.v3 or xiaomi.repeater.rd10m.`);
        }

        const name = this.util.getFriendlyNameWiFi(model);
        const capabilities = model === 'xiaomi.repeater.rd10m'
          ? RD10M_CAPABILITIES
          : LEGACY_CAPABILITIES;

        deviceObject = {
          name: `${name} (${model})`,
          data: {
            id: `${model}:${crypto.createHash('sha256').update(data.token).digest('hex')}`
          },
          capabilities,
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
      if (!deviceObject) {
        throw new Error('Test the connection before adding the device.');
      }
      return deviceObject;
    });
  }
}

module.exports = XiaomiRepeaterDriver;
