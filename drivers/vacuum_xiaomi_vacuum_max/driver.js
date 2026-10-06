'use strict';

const Driver = require('../wifi_driver.js');

const BASE_STATION_STATUS_CAPABILITY = 'vacuum_xiaomi_base_station_status';
const OV21GL_CONSUMABLE_LIFE_CAPABILITIES = Object.freeze([
    'vacuum_xiaomi_mop_life_level',
    'vacuum_xiaomi_dust_bag_left_level'
]);
const BASE_STATION_STATUS_MODELS = Object.freeze([
    'xiaomi.vacuum.d109gl',
    'xiaomi.vacuum.d102gl',
    'xiaomi.vacuum.ov43gb',
    'xiaomi.vacuum.ov21gl',
    'xiaomi.vacuum.ov51gl',
    'xiaomi.vacuum.c102gl'
]);

class XiaomiVacuumMiotDriver extends Driver {
    getPairingCapabilities(model) {
        const manifestCapabilities = this.manifest && this.manifest.capabilities;
        if (!Array.isArray(manifestCapabilities)) return undefined;

        return manifestCapabilities.filter((capability) =>
            (capability !== BASE_STATION_STATUS_CAPABILITY || BASE_STATION_STATUS_MODELS.includes(model))
            && (!OV21GL_CONSUMABLE_LIFE_CAPABILITIES.includes(capability) || model === 'xiaomi.vacuum.ov21gl')
        );
    }
}

module.exports = XiaomiVacuumMiotDriver;
