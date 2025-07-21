'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');

/* supported devices */
// https://home.miot-spec.com/spec/dmaker.fan.p9
// https://home.miot-spec.com/spec/dmaker.fan.p10
// https://home.miot-spec.com/spec/dmaker.fan.p11
// https://home.miot-spec.com/spec/dmaker.fan.p15
// https://home.miot-spec.com/spec/dmaker.fan.p18
// https://home.miot-spec.com/spec/dmaker.fan.p33
// https://home.miot-spec.com/spec/dmaker.fan.p39
// https://home.miot-spec.com/spec/dmaker.fan.p44
// https://home.miot-spec.com/spec/dmaker.fan.1c
// https://home.miot-spec.com/spec/xiaomi.fan.p45

const mapping = {
    'dmaker.fan.p9': 'properties_p9',
    'dmaker.fan.p10': 'properties_p10',
    'dmaker.fan.p11': 'properties_p11',
    'dmaker.fan.p15': 'properties_p11',
    'dmaker.fan.p18': 'properties_p10',
    'dmaker.fan.p33': 'properties_p33',
    'dmaker.fan.p39': 'properties_p39',
    'dmaker.fan.p44': 'properties_p44',
    'dmaker.fan.1c': 'properties_1c',
    'dmaker.fan.*': 'properties_p9',
    'xiaomi.fan.p45': 'properties_p45'
};

const properties = {
    properties_p9: {
        get_properties: [
            { did: 'power', siid: 2, piid: 1 }, // onoff
            { did: 'fan_level', siid: 2, piid: 2 }, // dim
            { did: 'mode', siid: 2, piid: 4 }, // fan_dmaker_mode
            { did: 'oscillating_mode', siid: 2, piid: 5 }, // oscillating
            { did: 'oscillating_mode_angle', siid: 2, piid: 6 }, // fan_zhimi_angle
            { did: 'fan_speed', siid: 2, piid: 11 }, // fan_speed
            { did: 'light', siid: 2, piid: 9 }, // settings.led
            { did: 'buzzer', siid: 2, piid: 7 }, // settings.buzzer
            { did: 'child_lock', siid: 3, piid: 1 } // settings.childLock
        ],
        set_properties: {
            oscillating_mode: { siid: 2, piid: 5 },
            oscillating_mode_angle: { siid: 2, piid: 6 },
            fan_speed: { siid: 2, piid: 11 },
            mode: { siid: 2, piid: 4 },
            light: { siid: 2, piid: 9 },
            buzzer: { siid: 2, piid: 7 },
            child_lock: { siid: 3, piid: 1 }
        }
    },
    properties_p10: {
        get_properties: [
            { did: 'power', siid: 2, piid: 1 }, // onoff
            { did: 'fan_level', siid: 2, piid: 2 }, // dim
            { did: 'mode', siid: 2, piid: 3 }, // fan_dmaker_mode
            { did: 'oscillating_mode', siid: 2, piid: 4 }, // oscillating
            { did: 'oscillating_mode_angle', siid: 2, piid: 5 }, // fan_zhimi_angle
            { did: 'fan_speed', siid: 2, piid: 10 }, // fan_speed
            { did: 'light', siid: 2, piid: 7 }, // settings.led
            { did: 'buzzer', siid: 2, piid: 8 }, // settings.buzzer
            { did: 'child_lock', siid: 3, piid: 1 } // settings.childLock
        ],
        set_properties: {
            oscillating_mode: { siid: 2, piid: 4 },
            oscillating_mode_angle: { siid: 2, piid: 5 },
            fan_speed: { siid: 2, piid: 10 },
            mode: { siid: 2, piid: 3 },
            light: { siid: 2, piid: 7 },
            buzzer: { siid: 2, piid: 8 },
            child_lock: { siid: 3, piid: 1 }
        }
    },
    properties_p11: {
        get_properties: [
            { did: 'power', siid: 2, piid: 1 }, // onoff
            { did: 'fan_level', siid: 2, piid: 2 }, // dim
            { did: 'mode', siid: 2, piid: 3 }, // fan_dmaker_mode
            { did: 'oscillating_mode', siid: 2, piid: 4 }, // oscillating
            { did: 'oscillating_mode_angle', siid: 2, piid: 5 }, // fan_zhimi_angle
            { did: 'fan_speed', siid: 2, piid: 6 }, // fan_speed
            { did: 'light', siid: 4, piid: 1 }, // settings.led
            { did: 'buzzer', siid: 5, piid: 1 }, // settings.buzzer
            { did: 'child_lock', siid: 7, piid: 1 } // settings.childLock
        ],
        set_properties: {
            oscillating_mode: { siid: 2, piid: 4 },
            oscillating_mode_angle: { siid: 2, piid: 5 },
            fan_speed: { siid: 2, piid: 6 },
            mode: { siid: 2, piid: 3 },
            light: { siid: 4, piid: 1 },
            buzzer: { siid: 5, piid: 1 },
            child_lock: { siid: 7, piid: 1 }
        }
    },
    properties_p33: {
        get_properties: [
            { did: 'power', siid: 2, piid: 1 }, // onoff
            { did: 'fan_level', siid: 2, piid: 2 }, // dim
            { did: 'mode', siid: 2, piid: 3 }, // fan_dmaker_mode
            { did: 'oscillating_mode', siid: 2, piid: 4 }, // oscillating
            { did: 'oscillating_mode_angle', siid: 2, piid: 5 }, // fan_zhimi_angle
            { did: 'fan_speed', siid: 2, piid: 6 }, // fan_speed
            { did: 'light', siid: 4, piid: 1 }, // settings.led
            { did: 'buzzer', siid: 5, piid: 1 }, // settings.buzzer
            { did: 'child_lock', siid: 7, piid: 1 } // settings.childLock
        ],
        set_properties: {
            oscillating_mode: { siid: 2, piid: 4 },
            oscillating_mode_angle: { siid: 2, piid: 5 },
            fan_speed: { siid: 2, piid: 6 },
            mode: { siid: 2, piid: 3 },
            light: { siid: 4, piid: 1 },
            buzzer: { siid: 5, piid: 1 },
            child_lock: { siid: 7, piid: 1 },
            set_move: { siid: 6, piid: 1 } 
        }
    },
    properties_p39: {
        get_properties: [
            { did: 'power', siid: 2, piid: 1 }, // onoff
            { did: 'fan_level', siid: 2, piid: 2 }, // dim
            { did: 'mode', siid: 2, piid: 4 }, // fan_dmaker_mode
            { did: 'oscillating_mode', siid: 2, piid: 5 }, // oscillating
            { did: 'oscillating_mode_angle', siid: 2, piid: 6 }, // fan_zhimi_angle
            { did: 'fan_speed', siid: 2, piid: 11 }, // fan_speed
            { did: 'child_lock', siid: 3, piid: 1 } // settings.childLock
        ],
        set_properties: {
            oscillating_mode: { siid: 2, piid: 5 },
            oscillating_mode_angle: { siid: 2, piid: 6 },
            fan_speed: { siid: 2, piid: 11 },
            mode: { siid: 2, piid: 4 },
            child_lock: { siid: 3, piid: 1 }
        }
    },
    properties_p44: {
        get_properties: [
            { did: 'power', siid: 2, piid: 1 }, // onoff
            { did: 'fan_level', siid: 2, piid: 2 }, // dim
            { did: 'mode', siid: 2, piid: 3 }, // fan_dmaker_mode
            { did: 'oscillating_mode', siid: 2, piid: 4 }, // oscillating
            { did: 'light', siid: 4, piid: 1 }, // settings.led
            { did: 'buzzer', siid: 5, piid: 1 }, // settings.buzzer
            { did: 'child_lock', siid: 7, piid: 1 } // settings.childLock
        ],
        set_properties: {
            oscillating_mode: { siid: 2, piid: 4 },
            mode: { siid: 2, piid: 3 },
            light: { siid: 4, piid: 1 },
            buzzer: { siid: 5, piid: 1 },
            child_lock: { siid: 7, piid: 1 }
        }
    },
    properties_1c: {
        get_properties: [
            { did: 'power', siid: 2, piid: 1 }, // onoff
            { did: 'fan_level', siid: 2, piid: 2 }, // dim
            { did: 'mode', siid: 2, piid: 7 }, // fan_dmaker_mode
            { did: 'oscillating_mode', siid: 2, piid: 3 }, // oscillating
            { did: 'light', siid: 2, piid: 12 }, // setting.led
            { did: 'buzzer', siid: 2, piid: 11 }, // settings.buzzer
            { did: 'child_lock', siid: 3, piid: 1 } // settings.childLock
        ],
        set_properties: {
            oscillating_mode: { siid: 2, piid: 3 },
            mode: { siid: 2, piid: 7 },
            light: { siid: 2, piid: 12 },
            buzzer: { siid: 2, piid: 11 },
            child_lock: { siid: 3, piid: 1 }
        }
    },
    properties_p45: {
        get_properties: [
            { did: 'power', siid: 2, piid: 1 }, // onoff
            { did: 'fan_level', siid: 2, piid: 4 }, // dim           (gear 1‑4)
            { did: 'mode', siid: 2, piid: 3 }, // fan_dmaker_mode 0‑Straight / 1‑Natural / 2‑Sleep
            { did: 'oscillating_mode', siid: 2, piid: 6 }, // oscillating   (bool)
            { did: 'oscillating_mode_angle', siid: 2, piid: 7 }, // fan_zhimi_angle 30‑150
            { did: 'fan_speed', siid: 2, piid: 5 }, // fan_speed     (1‑100 %)
            { did: 'light', siid: 5, piid: 1 }, // settings.led  (bool)
            { did: 'buzzer', siid: 7, piid: 1 }, // settings.buzzer (bool)
            { did: 'child_lock', siid: 11, piid: 1 } // settings.childLock (bool)
        ],

        set_properties: {
            fan_level: { siid: 2, piid: 4 },
            oscillating_mode: { siid: 2, piid: 6 },
            oscillating_mode_angle: { siid: 2, piid: 7 },
            fan_speed: { siid: 2, piid: 5 },
            mode: { siid: 2, piid: 3 },
            light: { siid: 5, piid: 1 },
            buzzer: { siid: 7, piid: 1 },
            child_lock: { siid: 11, piid: 1 }
        }
    }
};

/* Model‑specific mode enumerations */
const modeMap = {
    'dmaker.fan.p9': { 0: 'Straight Wind', 1: 'Natural Wind' },
    'dmaker.fan.p10': { 0: 'Straight Wind', 1: 'Natural Wind', 2: 'Sleep' },
    'dmaker.fan.p11': { 0: 'Straight Wind', 1: 'Natural Wind', 2: 'Sleep' },
    'dmaker.fan.p15': { 0: 'Straight Wind', 1: 'Natural Wind', 2: 'Sleep' },
    'dmaker.fan.p18': { 0: 'Straight Wind', 1: 'Natural Wind', 2: 'Sleep' },
    'dmaker.fan.p33': { 0: 'Straight Wind', 1: 'Natural Wind' },
    'dmaker.fan.p39': { 0: 'Straight Wind', 1: 'Natural Wind', 2: 'Sleep' },
    'dmaker.fan.p44': { 0: 'Straight Wind', 1: 'Natural Wind', 2: 'Sleep', 3: 'Cold Air' },
    'dmaker.fan.1c': { 0: 'Straight Wind', 1: 'Sleep' },
    'xiaomi.fan.p45': { 0: 'Straight Wind', 1: 'Natural Wind', 2: 'Sleep' }
};

class AdvancedDmakerFanMiotDevice extends Device {
    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            // GENERIC DEVICE INIT ACTIONS
            this.bootSequence();

            /* Build correct Mode selector for this model */
            const modelId = this.getStoreValue('model');
            const modeTable = modeMap[modelId] ?? { 0: 'Straight Wind' };

            await this.setCapabilityOptions('fan_dmaker_mode', {
                values: Object.keys(modeTable).map((id) => ({ id, title: modeTable[id] }))
            });

            // ADD DEVICES DEPENDANT CAPABILITIES
            if (this.getStoreValue('model') === 'dmaker.fan.p44' || this.getStoreValue('model') === 'dmaker.fan.1c') {
                if (this.hasCapability('fan_speed')) {
                    this.removeCapability('fan_speed');
                }
                if (this.hasCapability('fan_zhimi_angle')) {
                    this.removeCapability('fan_zhimi_angle');
                }
            }

            // DEVICE VARIABLES
            this.deviceProperties = properties[mapping[this.getStoreValue('model')]] !== undefined ? properties[mapping[this.getStoreValue('model')]] : properties[mapping['dmaker.fan.*']];

            // FLOW TRIGGER CARDS
            this.homey.flow.getDeviceTriggerCard('triggerModeChanged');

            // Register flow action for rotating left by one step
            this.homey.flow.getActionCard('rotateLeftStep').registerRunListener(async (args, state) => {
                return this.rotateFanHead('left');
            });

            // Register flow action for rotating right by one step
            this.homey.flow.getActionCard('rotateRightStep').registerRunListener(async (args, state) => {
                return this.rotateFanHead('right');
            });

            // LISTENERS FOR UPDATING CAPABILITIES
            this.registerCapabilityListener('onoff', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ did: 'onoff', siid: 2, piid: 1, value: value }], { retries: 1 });
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                            this.error(error);
                        });
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            this.registerCapabilityListener('oscillating', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ did: 'oscillating_mode', siid: this.deviceProperties.set_properties.oscillating_mode.siid, piid: this.deviceProperties.set_properties.oscillating_mode.piid, value: value ? 1 : 0 }], { retries: 1 });
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                            this.error(error);
                        });
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            /* ─── DIM / gear fan‑level 1‑4 ─── */
            this.registerCapabilityListener('dim', async (value) => {
                try {
                    if (!this.miio) throw new Error('miio not initialised');

                    const prop = this.deviceProperties.set_properties.fan_level ?? { siid: 2, piid: 2 }; // fall‑back for older models

                    return await this.miio.call(
                        'set_properties',
                        [
                            {
                                did: 'fan_level',
                                siid: prop.siid,
                                piid: prop.piid,
                                value: value
                            }
                        ],
                        { retries: 1 }
                    );
                } catch (error) {
                    this.error(error);
                    this.setUnavailable(this.homey.__('unreachable')).catch(this.error);
                    this.createDevice();
                    return Promise.reject(error);
                }
            });

            this.registerCapabilityListener('fan_zhimi_angle', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ did: 'fan_zhimi_angle', siid: this.deviceProperties.set_properties.oscillating_mode_angle.siid, piid: this.deviceProperties.set_properties.oscillating_mode_angle.piid, value: +value }], { retries: 1 });
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                            this.error(error);
                        });
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            this.registerCapabilityListener('fan_speed', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ did: 'fan_speed', siid: this.deviceProperties.set_properties.fan_speed.siid, piid: this.deviceProperties.set_properties.fan_speed.piid, value: value * 100 }], { retries: 1 });
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                            this.error(error);
                        });
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });

            this.registerCapabilityListener('fan_dmaker_mode', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('set_properties', [{ did: 'set', siid: this.deviceProperties.set_properties.mode.siid, piid: this.deviceProperties.set_properties.mode.piid, value: Number(value) }], { retries: 1 });
                    } else {
                        this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                            this.error(error);
                        });
                        this.createDevice();
                        return Promise.reject('Device unreachable, please try again ...');
                    }
                } catch (error) {
                    this.error(error);
                    return Promise.reject(error);
                }
            });
        } catch (error) {
            this.error(error);
        }
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
            this.refreshDevice();
        }

        if (changedKeys.includes('led') && this.getStoreValue('model') !== 'dmaker.fan.p39') {
            await this.miio.call('set_properties', [{ did: 'light', siid: this.deviceProperties.set_properties.light.siid, piid: this.deviceProperties.set_properties.light.piid, value: newSettings.led }], { retries: 1 });
        }

        if (changedKeys.includes('buzzer') && this.getStoreValue('model') !== 'dmaker.fan.p39') {
            await this.miio.call('set_properties', [{ did: 'buzzer', siid: this.deviceProperties.set_properties.buzzer.siid, piid: this.deviceProperties.set_properties.buzzer.piid, value: newSettings.buzzer }], { retries: 1 });
        }

        if (changedKeys.includes('childLock')) {
            await this.miio.call('set_properties', [{ did: 'child_lock', siid: this.deviceProperties.set_properties.child_lock.siid, piid: this.deviceProperties.set_properties.child_lock.piid, value: newSettings.childLock }], { retries: 1 });
        }

        return Promise.resolve(true);
    }

    async retrieveDeviceData() {
        try {
            const result = await this.miio.call('get_properties', this.deviceProperties.get_properties, { retries: 1 });
            if (!this.getAvailable()) {
                await this.setAvailable();
            }

            /* data */
            const onoff = result.find((obj) => obj.did === 'power');
            const oscillating_mode = result.find((obj) => obj.did === 'oscillating_mode');
            const dim_fan_level = result.find((obj) => obj.did === 'fan_level');
            const mode = result.find((obj) => obj.did === 'mode');

            const led = result.find((obj) => obj.did === 'light');
            const buzzer = result.find((obj) => obj.did === 'buzzer');
            const child_lock = result.find((obj) => obj.did === 'child_lock');

            /* capabilities */
            await this.updateCapabilityValue('onoff', onoff.value);
            await this.updateCapabilityValue('oscillating', oscillating_mode.value);
            await this.updateCapabilityValue('dim', +dim_fan_level.value);

            if (this.hasCapability('fan_zhimi_angle')) {
                const dim_oscillating_mode_angle = result.find((obj) => obj.did === 'oscillating_mode_angle');
                await this.updateCapabilityValue('fan_zhimi_angle', dim_oscillating_mode_angle.value.toString());
            }
            if (this.hasCapability('fan_speed')) {
                const fan_speed = result.find((obj) => obj.did === 'fan_speed');
                await this.updateCapabilityValue('fan_speed', fan_speed.value / 100);
            }

            /* settings */
            if (led !== undefined) {
                await this.updateSettingValue('led', !!led.value);
            }
            if (buzzer !== undefined) {
                await this.updateSettingValue('buzzer', buzzer.value);
            }
            await this.updateSettingValue('childLock', child_lock.value);

            /* mode capability */
            if (this.getCapabilityValue('fan_dmaker_mode') !== mode.value.toString()) {
                const previous_mode = this.getCapabilityValue('fan_dmaker_mode');
                await this.setCapabilityValue('fan_dmaker_mode', mode.value.toString());
                const nameTable = modeMap[this.getStoreValue('model')] ?? {};
                await this.homey.flow
                    .getDeviceTriggerCard('triggerModeChanged')
                    .trigger(this, { new_mode: nameTable[mode.value] ?? String(mode.value), previous_mode: nameTable[previous_mode] ?? String(previous_mode) })
                    .catch((error) => {
                        this.error(error);
                    });
            }
        } catch (error) {
            this.homey.clearInterval(this.pollingInterval);

            if (this.getAvailable()) {
                this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((error) => {
                    this.error(error);
                });
            }

            this.homey.setTimeout(() => {
                this.createDevice();
            }, 60000);

            this.error(error);
        }
    }

    /**
     * Rotate the fan head by one device-defined step (typically 5–7.5 degrees) left or right.
     * @param {"left"|"right"} direction
     */
    async rotateFanHead(direction) {
        this.log(`[Rotate] Requesting fan to rotate ${direction}`);

        // Check for model
        const model = this.getStoreValue('model');
        if (model === 'xiaomi.fan.p45') {
            // Use MIOT Action call for Smart Tower Fan 2
            let aiid;
            if (direction === 'left') aiid = 4;
            else if (direction === 'right') aiid = 5;
            else throw new Error('Invalid direction for rotateFanHead');
            try {
                return await this.miio.call('action', {
                    siid: 2,
                    aiid: aiid,
                    in: []
                });
            } catch (err) {
                this.error(`[Rotate] Failed to rotate fan (miot action):`, err);
                throw err;
            }
        } else {
            // Fallback for other models using legacy "set_move" property if exists
            const moveMap = this.deviceProperties.set_properties.set_move;
            if (!moveMap) {
                this.error('[Rotate] set_move property mapping not found for this model');
                throw new Error('Device does not support manual rotation');
            }
            let value;
            if (direction === 'right') value = 1; // Rotate right (JSON points to left)
            else if (direction === 'left') value = 2; // Rotate left (JSON points to right)
            else {
                this.error('[Rotate] Invalid direction:', direction);
                throw new Error('Invalid direction');
            }
            try {
                return await this.miio.call(
                    'set_properties',
                    [
                        {
                            did: 'set_move',
                            siid: moveMap.siid,
                            piid: moveMap.piid,
                            value: value
                        }
                    ],
                    { retries: 1 }
                );
            } catch (err) {
                this.error('[Rotate] Failed to rotate fan:', err);
                throw err;
            }
        }
    }
}

module.exports = AdvancedDmakerFanMiotDevice;
