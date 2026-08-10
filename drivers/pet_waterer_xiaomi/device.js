'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const {
    MODEL_ID,
    MODEL_MAPPING,
    PROFILES,
    MODES,
    CHARGING_STATES,
    getModelProfile,
    getPropertyDefinition,
    findValidPropertyResult,
    buildPropertyPayload,
    buildSetPropertyPayload,
    normalizeBoolean,
    validateInterval,
    validateMode,
    mapAlarmCapabilities
} = require('../../lib/pet-waterer-xiaomi-miot.js');

/* supported devices */
// https://home.miot-spec.com/spec/xiaomi.pet_waterer.iv02 // Xiaomi Smart Pet Fountain 2

// Keep these aliases available to match the naming used by older driver code
// and make the model profile easy to inspect in local tests.
const mapping = MODEL_MAPPING;
const properties = PROFILES;
const modes_iv02 = MODES;

class PetwaterdispenserXiaomiDevice extends Device {
    getConnectedDid() {
        const connectedDid = this.miio?.handle?.api?.id;
        if (connectedDid === undefined || connectedDid === null || connectedDid === '') {
            throw new Error('MIoT operation requires a connected device ID');
        }
        return String(connectedDid);
    }

    getPropertyDefinition(did) {
        return getPropertyDefinition(this.deviceProperties, did);
    }

    getPropertyResult(result, did) {
        return findValidPropertyResult(result, this.getPropertyDefinition(did));
    }

    // Helper method to pretty print properties without exposing the physical DID.
    prettyPrintProperties(result, propertyDefs) {
        try {
            const formatted = (Array.isArray(result) ? result : []).map((item) => {
                const def = propertyDefs.find((p) => p.siid === item.siid && p.piid === item.piid);
                return {
                    did: def ? def.did : `unknown_${item.siid}_${item.piid}`,
                    siid: item.siid,
                    piid: item.piid,
                    value: item.value,
                    code: item.code
                };
            });
            return JSON.stringify(formatted, null, 2);
        } catch (error) {
            this.error(`Error formatting properties: ${error.message || error}`);
            return JSON.stringify(result);
        }
    }

    async setMiotProperty(property, value) {
        if (!this.miio || typeof this.miio.call !== 'function') {
            throw new Error('MIoT set_properties requires an active miio device');
        }

        const definition = this.deviceProperties?.set_properties?.[property];
        if (!definition) throw new Error(`MIoT property ${property} is not supported by this device`);

        const payload = buildSetPropertyPayload(definition, this.getConnectedDid(), value);
        return this.miio.call('set_properties', [payload], { retries: 1 });
    }

    async getMiotProperties() {
        if (!this.miio || typeof this.miio.call !== 'function') {
            throw new Error('MIoT get_properties requires an active miio device');
        }

        // Keep the legacy 2.7 interval definition in the profile for model
        // documentation, but do not request it alongside the revision-2
        // property. The remaining 15-property request is split into bounded
        // chunks by the inherited helper to avoid oversized MIoT replies.
        const pollingProperties = this.deviceProperties.get_properties
            .filter((definition) => !(definition.siid === 2 && definition.piid === 7));
        const payload = buildPropertyPayload(pollingProperties, this.getConnectedDid());
        return this.callMiotGetProperties(payload, {
            chunkSize: 8,
            delayMs: 25,
            retries: 1
        });
    }

    async resetFilterLife() {
        if (!this.miio || typeof this.miio.call !== 'function') {
            throw new Error('MIoT reset filter life requires an active miio device');
        }

        // The action DID is the MIoT action identifier, not the connected
        // physical device DID used by property get/set requests.
        const action = this.deviceProperties?.actions?.reset_filter_life;
        if (!action) throw new Error('MIoT reset filter life action is not supported by this device');
        const payload = { ...action, in: Array.isArray(action.in) ? [...action.in] : [] };
        return this.miio.call('action', payload, { retries: 1 });
    }

    async migrateBatteryCapabilities() {
        try {
            const missingCapabilities = ['measure_battery', 'alarm_battery']
                .filter((capability) => !this.hasCapability(capability));
            if (missingCapabilities.length === 0) {
                this.log('IV02 battery capability migration skipped; capabilities already present');
                return;
            }

            this.log(`Starting IV02 battery capability migration: ${missingCapabilities.join(', ')}`);
            for (const capability of missingCapabilities) {
                await this.addCapability(capability);
            }
            this.log('Completed IV02 battery capability migration');
        } catch (error) {
            const detail = error && error.message ? error.message : String(error);
            this.error(`IV02 battery capability migration failed: ${detail}`);
        }
    }

    async requireMiio() {
        if (this.miio && typeof this.miio.call === 'function') return this.miio;

        this.setUnavailable(this.homey.__('unreachable')).catch((error) => this.error(error));
        this.createDevice();
        throw new Error('Device unreachable, please try again ...');
    }

    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            this.log('Xiaomi Smart Pet Fountain 2 initializing...');

            const model = this.getStoreValue('model');
            this.deviceProperties = getModelProfile(model);

            // Existing paired devices may predate the battery capabilities.
            // Migration is intentionally best-effort so an add failure cannot
            // prevent the device from starting and polling.
            await this.migrateBatteryCapabilities();

            this.bootSequence();

            // The mode Flow action is registered once by app.js.  Keep the
            // trigger lookup here for compatibility with existing devices.
            this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

            this.registerCapabilityListener('onoff', async (value) => {
                try {
                    await this.requireMiio();
                    return await this.setMiotProperty('onoff', Boolean(value));
                } catch (error) {
                    this.error(error.message || error);
                    return Promise.reject(error);
                }
            });

            this.registerCapabilityListener('petwaterdispenser_mmgg_mode_3', async (value) => {
                try {
                    const mode = validateMode(value);
                    await this.requireMiio();
                    this.log(`[mode] Setting mode to: ${mode} (${modes_iv02[mode]})`);
                    return await this.setMiotProperty('mode', mode);
                } catch (error) {
                    this.error(error.message || error);
                    return Promise.reject(error);
                }
            });
        } catch (error) {
            this.error(error);
        }
    }

    async onSettings({ newSettings = {}, changedKeys = [] }) {
        try {
            const changed = new Set(changedKeys);
            const writes = [];

            // Validate every changed MIoT setting before issuing any I/O.
            if (changed.has('child_lock')) {
                const childLock = normalizeBoolean(newSettings.child_lock);
                if (childLock === undefined) throw new TypeError('child_lock must be a boolean');
                writes.push(['child_lock', childLock]);
            }
            if (changed.has('no_disturb')) {
                const noDisturb = normalizeBoolean(newSettings.no_disturb);
                if (noDisturb === undefined) throw new TypeError('no_disturb must be a boolean');
                writes.push(['no_disturb', noDisturb]);
            }
            if (changed.has('out_water_interval')) {
                writes.push(['out_water_interval', validateInterval(newSettings.out_water_interval)]);
            }

            if (writes.length > 0) {
                await this.requireMiio();
                for (const [property, value] of writes) {
                    await this.setMiotProperty(property, value);
                }
            }

            if (changed.has('address') || changed.has('token') || changed.has('polling')) {
                this.refreshDevice();
            }
            return true;
        } catch (error) {
            this.error(error.message || error);
            throw error;
        }
    }

    async retrieveDeviceData() {
        try {
            const result = await this.getMiotProperties();
            if (!Array.isArray(result)) throw new Error('MIoT get_properties returned an invalid response');
            if (!this.getAvailable()) await this.setAvailable();

            // Store previous values to compare and only log when a valid
            // property value changed. Invalid MIoT entries are ignored.
            const prevProps = this._lastPropertyValues || {};
            const resultValues = {};
            for (const definition of this.deviceProperties.get_properties) {
                const found = this.getPropertyResult(result, definition.did);
                if (found) resultValues[definition.did] = found.value;
            }

            let valueChanged = false;
            for (const key of Object.keys(resultValues)) {
                if (resultValues[key] !== undefined && prevProps[key] !== resultValues[key]) {
                    valueChanged = true;
                    break;
                }
            }
            if (valueChanged) {
                this.log('Raw property data: ' + this.prettyPrintProperties(result, this.deviceProperties.get_properties));
            }
            // Only merge valid results. Missing/failed properties retain their
            // last valid cached value instead of being overwritten by
            // undefined.
            this._lastPropertyValues = { ...prevProps, ...resultValues };

            const onoff = this.getPropertyResult(result, 'onoff');
            const errorValue = this.getPropertyResult(result, 'fault');
            const mode = this.getPropertyResult(result, 'mode');
            const childLock = this.getPropertyResult(result, 'child_lock');
            const noDisturb = this.getPropertyResult(result, 'no_disturb');
            const interval = this.getPropertyResult(result, 'out_water_interval');
            const filterLife = this.getPropertyResult(result, 'filter_life_level');
            const filterDaysLeft = this.getPropertyResult(result, 'filter_left_time');
            const batteryLevel = this.getPropertyResult(result, 'battery_level');
            const chargingState = this.getPropertyResult(result, 'charging_state');
            const lowBattery = this.getPropertyResult(result, 'low_battery');
            const usbInsertState = this.getPropertyResult(result, 'usb_insert_state');

            if (onoff) {
                const power = normalizeBoolean(onoff.value);
                if (power !== undefined) await this.updateCapabilityValue('onoff', power);
            }

            if (mode) {
                const modeValue = Number(mode.value);
                if (Number.isInteger(modeValue) && Object.prototype.hasOwnProperty.call(modes_iv02, modeValue)) {
                    const modeString = String(modeValue);
                    if (this.getCapabilityValue('petwaterdispenser_mmgg_mode_3') !== modeString) {
                        const previousMode = this.getCapabilityValue('petwaterdispenser_mmgg_mode_3');
                        await this.setCapabilityValue('petwaterdispenser_mmgg_mode_3', modeString);
                        await this.homey.flow
                            .getDeviceTriggerCard('triggerModeChanged')
                            .trigger(this, {
                                new_mode: modes_iv02[modeValue],
                                previous_mode: modes_iv02[Number(previousMode)]
                            })
                            .catch((error) => this.error(error));
                        this.log(`[diagnostics] Device mode changed: ${modeValue}`);
                    }
                }
            }

            const alarms = mapAlarmCapabilities(result, this.deviceProperties);
            for (const [capability, value] of Object.entries(alarms)) {
                await this.updateCapabilityValue(capability, value);
            }

            if (batteryLevel) {
                const level = Number(batteryLevel.value);
                if (Number.isFinite(level)) {
                    const batteryPercentage = Math.max(0, Math.min(100, level));
                    const low = lowBattery ? normalizeBoolean(lowBattery.value) : undefined;
                    const isLowBattery = low === undefined ? batteryPercentage <= 20 : low;
                    await this.updateCapabilityValue('measure_battery', batteryPercentage);
                    await this.updateCapabilityValue('alarm_battery', isLowBattery);
                }
            } else if (lowBattery) {
                const low = normalizeBoolean(lowBattery.value);
                if (low !== undefined) await this.updateCapabilityValue('alarm_battery', low);
            }

            if (childLock) {
                const value = normalizeBoolean(childLock.value);
                if (value !== undefined) await this.updateSettingValue('child_lock', value);
            }
            if (noDisturb) {
                const value = normalizeBoolean(noDisturb.value);
                if (value !== undefined) await this.updateSettingValue('no_disturb', value);
            }
            if (interval) {
                try {
                    await this.updateSettingValue('out_water_interval', validateInterval(interval.value));
                } catch (error) {
                    this.log(`[diagnostics] Ignoring unsupported interval value: ${interval.value}`);
                }
            }

            if (usbInsertState) {
                const usb = normalizeBoolean(usbInsertState.value);
                if (usb !== undefined) {
                    await this.updateSettingValue('power_source', usb ? 'Connected to power' : 'Battery powered');
                }
            }

            if (chargingState) {
                const charging = Number(chargingState.value);
                if (Object.prototype.hasOwnProperty.call(CHARGING_STATES, charging)) {
                    await this.updateSettingValue('charging_state', CHARGING_STATES[charging]);
                }
            }

            if (errorValue) {
                const errorMessage = Number(errorValue.value) === 0 ? 'No Error' : `Error code: ${errorValue.value}`;
                await this.updateSettingValue('error', errorMessage);
                this.log(`[diagnostics] Device error status: ${errorMessage}`);
            }

            if (filterLife) {
                const value = Number(filterLife.value);
                if (Number.isFinite(value)) {
                    await this.updateSettingValue('filter_life_remaining', `${value}%`);
                    await this.updateCapabilityValue('measure_filter_life', value);
                }
            }

            if (filterDaysLeft) {
                const value = Number(filterDaysLeft.value);
                if (Number.isFinite(value)) {
                    await this.updateCapabilityValue('measure_filter_days_left', value);
                }
            }
        } catch (error) {
            this.homey.clearInterval(this.pollingInterval);
            if (this.getAvailable()) {
                this.setUnavailable(this.homey.__('device.unreachable') + (error.message || error)).catch((e) => this.error(e));
            }
            this.recreateTimeout = this.homey.setTimeout(() => this.createDevice(), 60000);
            this.error(error.message || error);
        }
    }
}

// Export aliases on the class for backwards-compatible local tooling/tests;
// the runtime export remains the Homey Device class itself.
PetwaterdispenserXiaomiDevice.mapping = mapping;
PetwaterdispenserXiaomiDevice.properties = properties;
PetwaterdispenserXiaomiDevice.modes = modes_iv02;
PetwaterdispenserXiaomiDevice.modelId = MODEL_ID;

module.exports = PetwaterdispenserXiaomiDevice;
