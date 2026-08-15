'use strict';

const Driver = require('../wifi_driver.js');

const BASE_STATION_STATUS_CAPABILITY = 'vacuum_xiaomi_base_station_status';
const BASE_STATION_STATUS_MODELS = Object.freeze([
    'xiaomi.vacuum.d109gl',
    'xiaomi.vacuum.d102gl',
    'xiaomi.vacuum.ov51gl',
    'xiaomi.vacuum.c102gl'
]);

class XiaomiVacuumMiotDriver extends Driver {
    getPairingCapabilities(model) {
        const manifestCapabilities = this.manifest && this.manifest.capabilities;
        if (!Array.isArray(manifestCapabilities)) return undefined;

        const capabilities = [...manifestCapabilities];
        if (BASE_STATION_STATUS_MODELS.includes(model)) return capabilities;
        return capabilities.filter((capability) => capability !== BASE_STATION_STATUS_CAPABILITY);
    }
}

module.exports = XiaomiVacuumMiotDriver;
