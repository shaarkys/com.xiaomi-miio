'use strict';

const Homey = require('homey');
const miio = require('miio');
const tinycolor = require('tinycolor2');

class MiWifiDeviceDevice extends Homey.Device {
    async onInit() {}

    async bootSequence() {
        try {
            // VARIABLES GENERIC
            this.deviceFailures = 0;

            // CREATE DEVICE
            this.homey.setTimeout(() => {
                this.createDevice();
            }, this.util.getRandomTimeout(10));

            // LOG DEVICE INFO
            this.homey.setTimeout(() => {
                this.getDeviceInfo();
            }, 120000 + this.util.getRandomTimeout(10));

            // INITIAL REFRESH DEVICE
            this.homey.setTimeout(() => {
                this.refreshDevice();
            }, this.util.getRandomTimeout(600));

            this.setUnavailable(this.homey.__('unreachable')).catch((error) => {
                this.error(error);
            });
        } catch (error) {
            this.error(error);
        }
    }

    async onDeleted() {
        try {
            this.homey.clearInterval(this.pollingInterval);
            this.homey.clearInterval(this.refreshInterval);
            this.homey.clearTimeout(this.recreateTimeout);
            if (this.miio) {
                try {
                    this.miio?.destroy();
                } catch (e) {
                    /* ignore double-close */
                }
                this.miio = null;
            }
        } catch (error) {
            this.error(error);
        }
    }

    async onUninit() {
        try {
            this.homey.clearInterval(this.pollingInterval);
            this.homey.clearInterval(this.refreshInterval);
            this.homey.clearTimeout(this.recreateTimeout);
            if (this.miio) {
                try {
                    this.miio?.destroy();
                } catch (e) {
                    /* ignore double-close */
                }
                this.miio = null;
            }
        } catch (error) {
            this.error(error);
        }
    }
    // UPDATE DEVICE SETTINGS, CAN BE OVERWRITTEN ON DEVICE LEVEL
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
            this.refreshDevice();
        }
        /* always resolve so Homey closes the settings view */
        return true;
    }

    // GENERIC CAPABILITY LISTENERS

    /* onoff */
    async onCapabilityOnoff(value, opts) {
        try {
            if (this.miio && typeof this.miio.setPower === 'function') {
                return await this.miio.setPower(value);
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
    }

    /* dim */
    async onCapabilityDim(value, opts) {
        try {
            if (this.miio && typeof this.miio.setBrightness === 'function') {
                const brightness = value * 100;
                return await this.miio.setBrightness(brightness);
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
    }

    /* vacuumcleaner onoff */
    async onCapabilityOnoffVacuumcleaner(value, opts) {
        try {
            if (this.miio) {
                if (value) {
                    await this.miio.clean();
                    return await this.setCapabilityValue('vacuumcleaner_state', 'cleaning');
                } else {
                    await this.miio.stop();
                    return this.setCapabilityValue('vacuumcleaner_state', 'stopped');
                }
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
    }

    /* vacuumcleaner_state */
    async onCapabilityVacuumcleanerState(value, opts) {
        try {
            if (this.miio) {
                switch (value) {
                    case 'cleaning':
                        await this.miio.clean();
                        await this.setCapabilityValue('onoff', true);
                        break;
                    case 'spot_cleaning':
                        await this.miio.spotClean();
                        await this.setCapabilityValue('onoff', true);
                        break;
                    case 'stopped':
                        await this.miio.stop();
                        await this.setCapabilityValue('onoff', false);
                        break;
                    case 'docked':
                    case 'charging':
                        await this.miio.stop();
                        await this.miio.activateCharging();
                        await this.setCapabilityValue('onoff', false);
                        break;
                    default:
                        this.error('Not a valid vacuumcleaner_state (wifi_device)');
                }
                return Promise.resolve();
            } else {
                this.setUnavailable(`${this.homey.__('unreachable')}: Device unreachable`).catch((error) => {
                    this.error(error);
                });
                this.createDevice();
                return Promise.reject('Device unreachable, please try again ...');
            }
        } catch (error) {
            this.error(error);
            return Promise.reject(error);
        }
    }

    /* vacuumcleaner mop intensity */
    async onCapabilityVacuumMopIntensity(value, opts) {
        try {
            if (this.miio) {
                return await this.miio.call('set_water_box_custom_mode', [Number(value)], { retries: 1 });
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
    }

    /* button.consumables */
    async onCapabilityButtonConsumable(value, opts) {
        try {
            if (this.miio) {
                return await this.miio.call('reset_consumable', ['main_brush_work_time', 'side_brush_work_time', 'filter_work_time', 'sensor_dirty_time'], { retries: 1 });
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
    }

    // HELPER FUNCTIONS

    /* updating capabilities */
    async updateCapabilityValue(capability, value) {
        try {
            if (this.hasCapability(capability)) {
                if (value !== this.getCapabilityValue(capability) && value !== null && value !== 'null' && value !== 'undefined' && value !== undefined) {
                    await this.setCapabilityValue(capability, value);
                }
            } else {
                if (!this.miio || typeof this.miio.matches !== 'function' || !this.miio.matches('cap:children')) {
                    this.log('adding capability ' + capability + ' to ' + this.getData().id + ' as the device seems to have values for this capability ...');
                    await this.addCapability(capability);
                    await this.setCapabilityValue(capability, value);
                }
            }
        } catch (error) {
            this.error('Trying to update or add capability', capability, 'with value', value, 'for device', this.getName(), 'with device id', this.getData().id);
            this.error(error);
        }
    }

    /* updating settings */
    async updateSettingValue(setting, value) {
        try {
            if (this.getSetting(setting) !== undefined) {
                if (this.getSetting(setting) !== value) {
                    // Fix: Use dynamic key name instead of literal "setting"
                    const settingsUpdate = {};
                    settingsUpdate[setting] = value;
                    await this.setSettings(settingsUpdate);
                }
            }
        } catch (error) {
            this.error('Trying to update setting', setting, 'with value', value, 'for device', this.getName(), 'with device id', this.getData().id);
            this.error(error);
        }
    }

    /* create device instance and start polling */
    async createDevice() {
        try {
            // stop any previous timers/loops
            this.homey.clearInterval(this.pollingInterval);
            this.homey.clearTimeout(this.recreateTimeout);

            // dispose of an old miio instance safely
            try {
                this.miio?.destroy();
            } catch (e) {
                /* ignore */
            }
            this.miio = null;

            this.miio = await miio.device({
                address: this.getSetting('address'),
                token: this.getSetting('token')
            });

            // device came back, clear failure counter
            this.deviceFailures = 0;

            if (!this.getAvailable()) await this.setAvailable();

            this.startCapabilityListeners();
            this.pollDevice();
        } catch (error) {
            // mark unavailable
            this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((err) => this.error(err));

            // exponential back-off: 10 s up to 9 tries, then 10 min
            this.deviceFailures = (this.deviceFailures || 0) + 1;
            const delay = this.deviceFailures <= 9 ? 10_000 : 600_000;

            this.recreateTimeout = this.homey.setTimeout(() => this.createDevice(), delay);
            this.miio = null;
            this.error(error.message);
        }
    }

    /* refresh device instance on regular interval */
    async refreshDevice() {
        try {
            this.homey.clearInterval(this.refreshInterval);
            this.refreshInterval = this.homey.setInterval(() => {
                if (this.miio) {
                    try {
                        this.miio?.destroy();
                    } catch (e) {
                        /* ignore double-close */
                    }
                    this.miio = null;
                }
                this.homey.setTimeout(() => {
                    this.createDevice();
                }, 2000);
            }, 3600000 + this.util.getRandomTimeout(600));
        } catch (error) {
            this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((error) => {
                this.error(error);
            });
            this.deviceFailures++;
            this.miio = null;
            this.createDevice();
            this.error(error.message);
        }
    }

    /* log device info */
    async getDeviceInfo() {
        try {
            this.log('WiFi Device Init: ' + this.getName() + ' and model ' + this.getStoreValue('model') + ' with ip ' + this.getSetting('address') + ' and capabilities ' + this.getCapabilities().toString());
            if (this.miio && typeof this.miio.matches === 'function') {
                if (this.miio.matches('cap:state')) {
                    const states = await this.miio.state();
                    for (const state in states) {
                        await this.setStoreValue(state, states[state]);
                    }
                }
            }
        } catch (error) {
            this.error(error);
        }
    }

    /* poll interval */
    async pollDevice() {
        try {
            this.homey.clearInterval(this.pollingInterval);
            this.homey.setTimeout(() => {
                this.retrieveDeviceData();
            }, this.util.getRandomTimeout(5));
            let interval = this.getSetting('polling') || 60;
            this.pollingInterval = this.homey.setInterval(() => {
                this.retrieveDeviceData();
            }, 1000 * interval);
        } catch (error) {
            this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((error) => {
                this.error(error);
            });
            this.deviceFailures++;
            this.createDevice();
            this.error(error);
        }
    }

    /* RETRIEVE DEVICE DATA THROUGH POLLING */
    async retrieveDeviceData() {
        try {
            if (!this.miio) {
                this.setUnavailable(this.homey.__('device.unreachable')).catch((error) => this.error(error));
                this.createDevice();
                return;
            }

            const supports = (capability) => typeof this.miio?.matches === 'function' && this.miio.matches(capability);

            // CAPABILITIES

            /* onoff */
            if (supports('cap:power')) {
                const power = await this.miio.power();
                this.updateCapabilityValue('onoff', power);
            }

            /* measure_power */
            if (supports('cap:power-load')) {
                const watt = await this.miio.powerLoad();
                this.updateCapabilityValue('measure_power', watt);
            }

            /* meter_power */
            if (supports('cap:power-consumed')) {
                const wh = await this.miio.powerConsumed();
                const kwh = wh / 1000;
                this.updateCapabilityValue('meter_power', kwh);
            }

            /* measure_battery */
            if (supports('cap:battery-level')) {
                const battery = await this.miio.batteryLevel();
                this.updateCapabilityValue('measure_battery', this.util.clamp(battery, 0, 100));
            }

            /* measure_temperature */
            if (supports('cap:temperature')) {
                const temp = await this.miio.temperature();
                this.updateCapabilityValue('measure_temperature', temp.value);
            }

            /* measure_humidity */
            if (supports('cap:relative-humidity')) {
                const rh = await this.miio.relativeHumidity();
                this.updateCapabilityValue('measure_humidity', rh);
            }

            /* measure_pm25 */
            if (supports('cap:pm2.5')) {
                const aqi = await this.miio.pm2_5();
                this.updateCapabilityValue('measure_pm25', aqi);
            }

            /* measure_waterlevel */
            if (supports('cap:depth')) {
                const depth = await this.miio.depth();
                const waterlevel = this.util.clamp(Math.round(depth), 0, 100);
                if (this.getCapabilityValue('measure_waterlevel') !== waterlevel) {
                    const previous_waterlevel = await this.getCapabilityValue('measure_waterlevel');
                    await this.setCapabilityValue('measure_waterlevel', waterlevel);
                    await this.homey.flow
                        .getDeviceTriggerCard('humidifier2Waterlevel')
                        .trigger(this, { waterlevel: waterlevel, previous_waterlevel: previous_waterlevel })
                        .catch((error) => {
                            this.error(error);
                        });
                }
            }

            /* dim */
            if (supports('cap:brightness')) {
                const brightness = await this.miio.brightness();
                const dim = brightness / 100;
                this.updateCapabilityValue('dim', dim);
            }

            /* measure_luminance */
            if (supports('cap:illuminance')) {
                const luminance = await this.miio.illuminance();
                this.updateCapabilityValue('measure_luminance', luminance.value);
            }

            /* light_temperature */
            // not clear on how to set light_temperature from polling

            /* light_hue & light_saturation for child device */
            if (supports('cap:children') && typeof this.miio.child === 'function') {
                const lightChild = this.miio.child('light');
                if (lightChild && typeof lightChild.matches === 'function' && lightChild.matches('cap:colorable') && typeof lightChild.color === 'function') {
                    const color = await lightChild.color();

                    const colorChanged = tinycolor({ r: color.values[0], g: color.values[1], b: color.values[2] });
                    const hsv = colorChanged.toHsv();
                    const hue = Math.round(hsv.h) / 360;
                    const saturation = Math.round(hsv.s);

                    this.updateCapabilityValue('light_hue', hue);
                    this.updateCapabilityValue('light_saturation', saturation);
                }
            }

            // STORE VALUES

            /* mode */
            if (supports('cap:mode')) {
                const mode = await this.miio.mode();
                this.handleModeEvent(mode);
                if (this.getStoreValue('mode') !== mode && mode !== null) {
                    this.setStoreValue('mode', mode);
                }
            }

            /* state */
            if (supports('cap:state')) {
                const states = await this.miio.state();
                for (const state in states) {
                    await this.setStoreValue(state, states[state]);
                }
            }

            /* fanspeed */
            if (supports('cap:fan-speed')) {
                const fanspeed = await this.miio.getState('fanSpeed');
                if (this.getStoreValue('fanspeed') !== fanspeed) {
                    await this.setStoreValue('fanspeed', fanspeed);
                }
            }

            /* roll */
            if (supports('cap:roll-angle')) {
                const angle = await this.miio.getState('roll');
                if (this.getStoreValue('angle') !== angle) {
                    await this.setStoreValue('angle', angle);
                }
            }

            /* adjustable-roll-angle */
            if (supports('cap:adjustable-roll-angle')) {
                const roll_angle = await this.miio.getState('roll_angle');
                if (this.getStoreValue('roll_angle') !== Number(roll_angle)) {
                    await this.setStoreValue('roll_angle', Number(roll_angle));
                }
            }

            /* switchable-child-lock */
            if (supports('cap:switchable-child-lock')) {
                const child_lock = await this.miio.getState('child_lock');
                if (this.getStoreValue('child_lock') !== child_lock) {
                    await this.setStoreValue('child_lock', child_lock);
                }
            }

            /* eyecare */
            if (supports('cap:eyecare')) {
                const eyecare = await this.miio.eyeCare();
                if (this.getStoreValue('eyecare') !== eyecare) {
                    await this.setStoreValue('eyecare', eyecare);
                }
            }

            // DEVICE TYPE SPECIFIC

            /* multifunction air monitor */
            if (this.getStoreValue('model') === 'cgllc.airmonitor.b1') {
                const data = await this.miio.call('get_air_data', []);
                data.co2 = data.co2e;
                ['temperature', 'humidity', 'pm25', 'tvoc', 'co2'].forEach((capability) => {
                    this.updateCapabilityValue(`measure_${capability}`, data[capability]);
                });
            }

            if (!this.getAvailable()) {
                await this.setAvailable();
            }
        } catch (error) {
            this.homey.clearInterval(this.pollingInterval);

            if (this.getAvailable()) {
                this.setUnavailable(this.homey.__('device.unreachable') + error.message).catch((error) => this.error(error));
            }

            /* RETRY AFTER 60 s - **now tracked so onDeleted/onUninit can clear it** */
            this.recreateTimeout = this.homey.setTimeout(() => {
                this.createDevice();
            }, 60000);
            this.miio = null;

            this.error(error);
        }
    }

    /* START CAPABILITY LISTENERS */
    async startCapabilityListeners() {
        try {
            /* avoid piling up listeners after reconnects */
            this.miio.removeAllListeners?.();

            // debugging
            // this.miio.on('stateChanged', (change) => {
            //   this.log(JSON.stringify(change));
            // });

            /* onoff */
            this.miio.on('powerChanged', (onoff) => {
                this.updateCapabilityValue('onoff', onoff);
            });

            /* measure_power */
            this.miio.on('powerLoadChanged', (watt) => {
                this.updateCapabilityValue('measure_power', watt);
            });

            /* meter_power */
            this.miio.on('powerConsumedChanged', (wh) => {
                const kwh = wh / 1000;
                this.updateCapabilityValue('meter_power', kwh);
            });

            /* measure_battery */
            this.miio.on('batteryLevelChanged', (battery) => {
                this.updateCapabilityValue('measure_battery', this.util.clamp(battery, 0, 100));
            });

            /* measure_temperature */
            this.miio.on('temperatureChanged', (temp) => {
                this.updateCapabilityValue('measure_temperature', temp.value);
            });

            /* measure_humidity */
            this.miio.on('relativeHumidityChanged', (humidity) => {
                this.updateCapabilityValue('measure_humidity', humidity);
            });

            /* measure_pm25 */
            this.miio.on('pm2.5Changed', (aqi) => {
                this.updateCapabilityValue('measure_pm25', aqi);
            });

            /* measure_waterlevel */
            this.miio.on('depthChanged', (depth) => {
                const waterlevel = this.util.clamp(Math.round(depth), 0, 100);
                this.updateCapabilityValue('measure_waterlevel', waterlevel);
            });

            /* measure_luminance */
            this.miio.on('illuminanceChanged', (illuminance) => {
                this.updateCapabilityValue('measure_luminance', illuminance.value);
            });

            /* light_temperature */
            this.miio.on('colorChanged', (c) => {
                const light_temperature = this.util.normalize(c.values[0], 3000, 5700);
                this.updateCapabilityValue('light_temperature', light_temperature);
            });

            /* light_hue & light_saturation for child device */
            if (typeof this.miio?.matches === 'function' && this.miio.matches('cap:children') && typeof this.miio.child === 'function') {
                const lightChild = this.miio.child('light');
                lightChild?.on?.('colorChanged', (c) => {
                    const colorChanged = tinycolor({ r: c.rgb.red, g: c.rgb.green, b: c.rgb.blue });
                    const hsv = colorChanged.toHsv();
                    const hue = Math.round(hsv.h) / 360;
                    const saturation = Math.round(hsv.s);

                    this.updateCapabilityValue('light_hue', hue);
                    this.updateCapabilityValue('light_saturation', saturation);
                });

                /* dim */
                lightChild?.on?.('brightnessChanged', (brightness) => {
                    const dim = brightness / 100;
                    this.updateCapabilityValue('dim', dim);
                });
            }

            /* mode */
            this.miio.on('modeChanged', (mode) => {
                this.handleModeEvent(mode);
            });
        } catch (error) {
            this.log(error);
        }
    }

    /* HANDLE MODE EVENTS, CAN BE OVERWRITTEN ON DEVICE LEVEL */
    async handleModeEvent(mode) {
        try {
            /* device with mode implemented as capability */
            if (this.hasCapability('airpurifier_mode')) {
                const previous_mode = this.getCapabilityValue('airpurifier_mode');
                if (previous_mode !== mode) {
                    this.setCapabilityValue('airpurifier_mode', mode);
                    this.homey.flow
                        .getDeviceTriggerCard('triggerModeChanged')
                        .trigger(this, { new_mode: mode, previous_mode: previous_mode })
                        .catch((error) => {
                            this.error(error);
                        });
                }
            }

            if (this.hasCapability('humidifier_zhimi_mode')) {
                const previous_mode = this.getCapabilityValue('humidifier_zhimi_mode');
                if (previous_mode !== mode) {
                    this.setCapabilityValue('humidifier_zhimi_mode', mode);
                    this.homey.flow
                        .getDeviceTriggerCard('triggerModeChanged')
                        .trigger(this, { new_mode: mode, previous_mode: previous_mode.toString() })
                        .catch((error) => {
                            this.error(error);
                        });
                }
            }
        } catch (error) {
            this.error(error);
        }
    }

    /* HANDLE DEVICE SETTINGS, NEED TO OVERWRITTEN ON DEVICE LEVEL */
    async handleDeviceSettings() {}

    /* VACUUMCLEANER STATE, CAN BE OVERWRITTEN ON DEVICE LEVEL */
    async vacuumCleanerState(state) {
        try {
            switch (state) {
                case 'cleaning':
                    if (this.getCapabilityValue('vacuumcleaner_state') !== 'cleaning') {
                        await this.updateCapabilityValue('vacuumcleaner_state', 'cleaning');
                        await this.updateCapabilityValue('onoff', true);
                        await this.homey.flow
                            .getDeviceTriggerCard('statusVacuum')
                            .trigger(this, { status: 'cleaning' })
                            .catch((error) => {
                                this.error(error);
                            });
                    }
                    break;
                case 'spot_cleaning':
                    if (this.getCapabilityValue('vacuumcleaner_state') !== 'spot_cleaning') {
                        await this.updateCapabilityValue('vacuumcleaner_state', 'spot_cleaning');
                        await this.updateCapabilityValue('onoff', true);
                        await this.homey.flow
                            .getDeviceTriggerCard('statusVacuum')
                            .trigger(this, { status: 'spot_cleaning' })
                            .catch((error) => {
                                this.error(error);
                            });
                    }
                    break;
                case 'stopped':
                    if (this.getCapabilityValue('vacuumcleaner_state') !== 'stopped') {
                        await this.updateCapabilityValue('vacuumcleaner_state', 'stopped');
                        await this.updateCapabilityValue('onoff', false);
                        await this.homey.flow
                            .getDeviceTriggerCard('statusVacuum')
                            .trigger(this, { status: 'stopped' })
                            .catch((error) => {
                                this.error(error);
                            });
                    }
                    break;
                case 'docked':
                    if (this.getCapabilityValue('vacuumcleaner_state') !== 'docked') {
                        await this.updateCapabilityValue('vacuumcleaner_state', 'docked');
                        await this.updateCapabilityValue('onoff', false);
                        await this.homey.flow
                            .getDeviceTriggerCard('statusVacuum')
                            .trigger(this, { status: 'docked' })
                            .catch((error) => {
                                this.error(error);
                            });
                    }
                    break;
                case 'charging':
                    if (this.getCapabilityValue('vacuumcleaner_state') !== 'charging') {
                        await this.updateCapabilityValue('vacuumcleaner_state', 'charging');
                        await this.updateCapabilityValue('onoff', false);
                        await this.homey.flow
                            .getDeviceTriggerCard('statusVacuum')
                            .trigger(this, { status: 'charging' })
                            .catch((error) => {
                                this.error(error);
                            });
                    }
                    break;
                case 'stopped_error':
                    await this.updateCapabilityValue('vacuumcleaner_state', 'stopped');
                    await this.updateCapabilityValue('onoff', false);
                    await this.homey.flow
                        .getDeviceTriggerCard('statusVacuum')
                        .trigger(this, { status: 'error' })
                        .catch((error) => {
                            this.error(error);
                        });
                    break;
                default:
                    break;
            }
        } catch (error) {
            this.error(error);
        }
    }

    /* VACUUMCLEANER CONSUMABLES, CAN BE OVERWRITTEN ON DEVICE LEVEL */
    async vacuumConsumables(consumables) {
        try {
            let main_brush_remaining_value = 0;
            let side_brush_remaining_value = 0;
            let filter_remaining_value = 0;
            let sensor_dirty_remaining_value = 0;

            /* main_brush_work_time */
            if (consumables[0].hasOwnProperty('main_brush_work_time')) {
                main_brush_remaining_value = 100 - Math.ceil((consumables[0]['main_brush_work_time'] / 1080000) * 100);
                const main_brush_remaining = main_brush_remaining_value + '%';
                if (this.getSetting('main_brush_work_time') !== main_brush_remaining) {
                    await this.setSettings({ main_brush_work_time: main_brush_remaining });
                    await this.main_brush_lifetime_token.setValue(main_brush_remaining_value);
                }
                if (main_brush_remaining_value < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_main_brush_work_time')) {
                    await this.updateCapabilityValue('alarm_main_brush_work_time', true);
                    await this.homey.flow
                        .getDeviceTriggerCard('alertVacuum')
                        .trigger(this, { consumable: 'Main Brush', value: main_brush_remaining })
                        .catch((error) => {
                            this.error(error);
                        });
                } else if (main_brush_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_main_brush_work_time')) {
                    this.updateCapabilityValue('alarm_main_brush_work_time', false);
                }
            }

            /* side_brush_work_time */
            if (consumables[0].hasOwnProperty('side_brush_work_time')) {
                side_brush_remaining_value = 100 - Math.ceil((consumables[0]['side_brush_work_time'] / 720000) * 100);
                const side_brush_remaining = side_brush_remaining_value + '%';
                if (this.getSetting('side_brush_work_time') !== side_brush_remaining) {
                    await this.setSettings({ side_brush_work_time: side_brush_remaining });
                    await this.side_brush_lifetime_token.setValue(side_brush_remaining_value);
                }
                if (side_brush_remaining_value < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_side_brush_work_time')) {
                    await this.updateCapabilityValue('alarm_side_brush_work_time', true);
                    await this.homey.flow
                        .getDeviceTriggerCard('alertVacuum')
                        .trigger(this, { consumable: 'Side Brush', value: side_brush_remaining })
                        .catch((error) => {
                            this.error(error);
                        });
                } else if (side_brush_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_side_brush_work_time')) {
                    this.updateCapabilityValue('alarm_side_brush_work_time', false);
                }
            }

            /* filter_work_time */
            if (consumables[0].hasOwnProperty('filter_work_time')) {
                filter_remaining_value = 100 - Math.ceil((consumables[0]['filter_work_time'] / 540000) * 100);
                const filter_remaining = filter_remaining_value + '%';
                if (this.getSetting('filter_work_time') !== filter_remaining) {
                    await this.setSettings({ filter_work_time: filter_remaining });
                    await this.filter_lifetime_token.setValue(filter_remaining_value);
                }
                if (filter_remaining_value < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_filter_work_time')) {
                    await this.updateCapabilityValue('alarm_filter_work_time', true);
                    await this.homey.flow
                        .getDeviceTriggerCard('alertVacuum')
                        .trigger(this, { consumable: 'Filter', value: filter_remaining })
                        .catch((error) => {
                            this.error(error);
                        });
                } else if (filter_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_filter_work_time')) {
                    this.updateCapabilityValue('alarm_filter_work_time', false);
                }
            }

            /* sensor_dirty_work_time */
            if (consumables[0].hasOwnProperty('sensor_dirty_time')) {
                sensor_dirty_remaining_value = 100 - Math.ceil((consumables[0]['sensor_dirty_time'] / 108000) * 100);
                const sensor_dirty_remaining = sensor_dirty_remaining_value + '%';
                if (this.getSetting('sensor_dirty_time') !== sensor_dirty_remaining) {
                    await this.setSettings({ sensor_dirty_time: sensor_dirty_remaining });
                    await this.sensor_dirty_lifetime_token.setValue(sensor_dirty_remaining_value);
                }
                if (sensor_dirty_remaining_value < this.getSetting('alarm_threshold') && !this.getCapabilityValue('alarm_sensor_dirty_time')) {
                    await this.updateCapabilityValue('alarm_sensor_dirty_time', true);
                    await this.homey.flow
                        .getDeviceTriggerCard('alertVacuum')
                        .trigger(this, { consumable: 'Sensor', value: sensor_dirty_remaining })
                        .catch((error) => {
                            this.error(error);
                        });
                } else if (sensor_dirty_remaining_value > this.getSetting('alarm_threshold') && this.getCapabilityValue('alarm_sensor_dirty_time')) {
                    this.updateCapabilityValue('alarm_sensor_dirty_time', false);
                }
            }

            /* initial update tokens */
            if (!this.initialTokenConsumable || this.initialTokenConsumable == undefined) {
                await this.main_brush_lifetime_token.setValue(main_brush_remaining_value);
                await this.side_brush_lifetime_token.setValue(side_brush_remaining_value);
                await this.filter_lifetime_token.setValue(filter_remaining_value);
                await this.sensor_dirty_lifetime_token.setValue(sensor_dirty_remaining_value);
                this.initialTokenConsumable = true;
            }
        } catch (error) {
            this.error(error);
        }
    }

    /* VACUUMCLEANER TOTALS, CAN BE OVERWRITTEN ON DEVICE LEVEL */
    async vacuumTotals(totals) {
        try {
            let worktime = 0;
            let cleared_area = 0;
            let clean_count = 0;

            // different models use different values
            if (totals.hasOwnProperty('clean_time')) {
                worktime = totals.clean_time;
                cleared_area = totals.clean_area;
                clean_count = totals.clean_count;
            } else {
                worktime = totals[0];
                cleared_area = totals[1];
                clean_count = totals[2];
            }

            /* total_work_time */
            const total_work_time_value = Math.round(worktime / 3600);
            const total_work_time = total_work_time_value + ' h';
            if (this.getSetting('total_work_time') !== total_work_time) {
                await this.setSettings({ total_work_time: total_work_time });
                await this.total_work_time_token.setValue(total_work_time_value);
            }

            /* total_cleared_area */
            const total_cleared_area_value = Math.round(cleared_area / 1000000);
            const total_cleared_area = total_cleared_area_value + ' m2';
            if (this.getSetting('total_cleared_area') !== total_cleared_area) {
                await this.setSettings({ total_cleared_area: total_cleared_area });
                await this.total_cleared_area_token.setValue(total_cleared_area_value);
            }

            /* total_clean_count */
            if (this.getSetting('total_clean_count') !== clean_count) {
                await this.setSettings({ total_clean_count: String(clean_count) });
                await this.total_clean_count_token.setValue(clean_count);
            }

            /* initial update tokens */
            if (!this.initialTokenTotal || this.initialTokenTotal == undefined) {
                await this.total_work_time_token.setValue(total_work_time_value);
                await this.total_cleared_area_token.setValue(total_cleared_area_value);
                await this.total_clean_count_token.setValue(clean_count);
                this.initialTokenTotal = true;
            }
        } catch (error) {
            this.error(error);
        }
    }
}

module.exports = MiWifiDeviceDevice;
