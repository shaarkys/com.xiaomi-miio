'use strict';

const Homey = require('homey');
const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const tinycolor = require('tinycolor2');

class GatewayDevice extends Device {
    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            // GENERIC DEVICE INIT ACTIONS
            this.bootSequence();

            // LISTENERS FOR UPDATING CAPABILITIES
            this.registerCapabilityListener('onoff', async (value) => {
                try {
                    if (this.miio) {
                        const lightChild = this.miio.child('light');
                        if (!lightChild) {
                            this.error('Light child device not available');
                            return Promise.reject(new Error('Light child device not available'));
                        }
                        return await lightChild.setPower(value);
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

            this.registerCapabilityListener('dim', async (value) => {
                try {
                    if (this.miio) {
                        const brightness = value * 100;
                        if (brightness < 1 && this.getCapabilityValue('onoff')) {
                            this.triggerCapabilityListener('onoff', false);
                        } else if (brightness > 0 && !this.getCapabilityValue('onoff')) {
                            this.triggerCapabilityListener('onoff', true);
                        }
                        const lightChild = this.miio.child('light');
                        if (!lightChild) {
                            this.error('Light child device not available');
                            return Promise.reject(new Error('Light child device not available'));
                        }
                        return await lightChild.setBrightness(brightness);
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

            this.registerMultipleCapabilityListener(
                ['light_hue', 'light_saturation'],
                async (valueObj) => {
                    try {
                        if (this.miio) {
                            if (valueObj.hasOwnProperty('light_hue')) {
                                var hue_value = valueObj.light_hue;
                            } else {
                                var hue_value = this.getCapabilityValue('light_hue');
                            }

                            if (valueObj.hasOwnProperty('light_saturation')) {
                                var saturation_value = valueObj.light_saturation;
                            } else {
                                var saturation_value = this.getCapabilityValue('light_saturation');
                            }

                            const hue = hue_value * 360;
                            const saturation = saturation_value * 100;
                            const dim = this.getCapabilityValue('dim') * 100;
                            const colorUpdate = tinycolor({ h: Math.round(hue), s: Math.round(saturation), v: dim });

                            return await this.miio.child('light').color(colorUpdate.toRgbString());
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
                },
                500
            );

            this.registerCapabilityListener('homealarm_state', async (value) => {
                try {
                    if (this.miio) {
                        const state = value == 'armed' ? true : false;
                        return await this.miio.setArming(state);
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

            this.registerCapabilityListener('speaker_playing', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('play_fm', [value ? 'on' : 'off'], { retries: 1 });
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

            this.registerCapabilityListener('speaker_next', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('play_fm', ['next'], { retries: 1 });
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

            this.registerCapabilityListener('speaker_prev', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('play_fm', ['prev'], { retries: 1 });
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

            this.registerCapabilityListener('volume_set', async (value) => {
                try {
                    if (this.miio) {
                        let volume = parseInt(value * 100);
                        return await this.miio.call('volume_ctrl_fm', [volume.toString()], { retries: 1 });
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

            this.registerCapabilityListener('volume_set.alarm', async (value) => {
                try {
                    if (this.miio) {
                        let volume = parseInt(value * 100);
                        return await this.miio.call('set_alarming_volume', [volume], { retries: 1 });
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

            this.registerCapabilityListener('button', async (value) => {
                try {
                    if (this.miio) {
                        return await this.miio.call('start_zigbee_join', [30]);
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

        for (let i = 0; i < 20; i++) {
            if (changedKeys.includes(`favorite${i}ID`)) {
                let newFavoriteListsID = newSettings[`favorite${i}ID`];
                let oldFavoriteListID = oldSettings[`favorite${i}ID`];
                let newFavoriteListsIDArray = newFavoriteListsID.split(',');
                let oldFavoriteListsIDArray = oldFavoriteListID.split(',');

                if (oldFavoriteListsIDArray[0] !== undefined && oldFavoriteListsIDArray[0] !== null && oldFavoriteListsIDArray[1] !== undefined && oldFavoriteListsIDArray[1] !== null) {
                    let ids = oldFavoriteListsIDArray[0];
                    ids = ids.replace(/\s/g, '');
                    let id = parseInt(ids);
                    let urls = oldFavoriteListsIDArray[1];
                    urls = urls.replace(/\s/g, '');
                    let url = urls.toString();

                    await this.miio.call('remove_channels', { chs: [{ id: id, type: 0, url: url }] });
                }

                if (newFavoriteListsIDArray[0] !== undefined && newFavoriteListsIDArray[0] !== null && newFavoriteListsIDArray[1] !== undefined && newFavoriteListsIDArray[1] !== null) {
                    let ids = newFavoriteListsIDArray[0];
                    ids = ids.replace(/\s/g, '');
                    let id = parseInt(ids);
                    let urls = newFavoriteListsIDArray[1];
                    urls = urls.replace(/\s/g, '');
                    let url = urls.toString();

                    await this.miio.call('add_channels', { chs: [{ id: id, type: 0, url: url }] });
                }
            }
        }

        return Promise.resolve(true);
    }

    async retrieveDeviceData() {
        try {
            /* onoff */
            if (this.miio.matches('cap:power')) {
                const power = await this.miio.power();
                this.updateCapabilityValue('onoff', power);
            }

            /* dim */
            if (this.miio.matches('cap:brightness')) {
                const brightness = await this.miio.brightness();
                const dim = brightness / 100;
                this.updateCapabilityValue('dim', dim);
            }

            /* light */
            if (this.miio.matches('cap:children')) {
                if (this.miio.child('light')) {
                    if (this.miio.child('light').matches('cap:colorable')) {
                        const color = await this.miio.child('light').color();

                        const colorChanged = tinycolor({ r: color.values[0], g: color.values[1], b: color.values[2] });
                        const hsv = colorChanged.toHsv();
                        const hue = Math.round(hsv.h) / 360;
                        const saturation = Math.round(hsv.s);

                        await this.setCapabilityValue('light_hue', hue);
                        await this.setCapabilityValue('light_saturation', saturation);
                    }
                }
            }

            /* alarm */
            const alarm = await this.miio.call('get_arming', [], { retries: 1 });
            if (alarm[0] == 'on') {
                this.updateCapabilityValue('homealarm_state', 'armed');
            } else if (alarm[0] == 'off') {
                this.updateCapabilityValue('homealarm_state', 'disarmed');
            }

            const alarm_volume = await this.miio.call('get_alarming_volume', [], { retries: 1 });
            this.updateCapabilityValue('volume_set.alarm', alarm_volume / 100);

            /* radio */
            const radio = await this.miio.call('get_prop_fm', [], { retries: 1 });
            await this.updateCapabilityValue('volume_set', radio.current_volume / 100);
            if (radio.current_status == 'run') {
                await this.updateCapabilityValue('speaker_playing', true);
                await this.updateCapabilityValue('speaker_track', 'Station: ' + radio.current_program);
            } else if (radio.current_status == 'pause') {
                await this.updateCapabilityValue('speaker_playing', false);
            }

            const channels = await this.miio.call('get_channels', { start: 0 }, { retries: 1 });
            if (Array.isArray(channels.chs)) {
                channels.chs.forEach(async (item, i, radios) => {
                    await this.setSettings({ [`favorite${i}ID`]: item.id + ', ' + item.url });
                    await this.util.sleep(500);
                    if (i == radios.length - 1) {
                        i = radios.length;
                        for (let j = i; j < 20; j++) {
                            await this.setSettings({ [`favorite${j}ID`]: '' });
                            await this.util.sleep(500);
                        }
                    }
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
}

module.exports = GatewayDevice;
