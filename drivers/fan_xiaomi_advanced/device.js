'use strict';

const Device = require('../wifi_device.js');
const Util = require('../../lib/util.js');
const engine = require('../../lib/fans-xiaomi/engine.js');

// Supported models and all their data (properties, enums, angles, actions) live in
// lib/fans-xiaomi/models.js (MODELS) — the single source of truth. The generic runtime
// lives in lib/fans-xiaomi/engine.js; adding a model is a data-only change there.
// Per-model MIOT specs: https://home.miot-spec.com/spec/<model-id>

class AdvancedXiaomiFanMiotDevice extends Device {
    async onInit() {
        try {
            if (!this.util) this.util = new Util({ homey: this.homey });

            // GENERIC DEVICE INIT ACTIONS
            this.bootSequence();

            // Resolve the model descriptor (single source of truth)
            this.descriptor = engine.resolve(this.getStoreValue('model'));

            // Reconcile capabilities, options and listeners with the model
            await engine.syncCapabilities(this, this.descriptor);
            await engine.applyCapabilityOptions(this, this.descriptor);

            // FLOW TRIGGER CARDS
            this.homey.flow.getDeviceTriggerCard('xiaomiModeChanged');

            // LISTENERS FOR UPDATING CAPABILITIES
            engine.registerListeners(this, this.descriptor);
        } catch (error) {
            this.error(error);
        }
    }

    getDescriptor() {
        if (!this.descriptor) this.descriptor = engine.resolve(this.getStoreValue('model'));
        return this.descriptor;
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes('address') || changedKeys.includes('token') || changedKeys.includes('polling')) {
            this.refreshDevice();
        }

        const descriptor = this.getDescriptor();

        await engine.writeChangedSettings(this, descriptor, newSettings, changedKeys);

        return Promise.resolve(true);
    }

    async retrieveDeviceData() {
        try {
            const descriptor = this.getDescriptor();
            await engine.poll(this, descriptor);
            if (!this.getAvailable()) {
                await this.setAvailable();
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
     * Rotate the fan head by one device-defined step.
     * Left/right are supported by all xiaomi.fan.* models; up/down only by models whose spec exposes them (p70 / p76).
     * @param {"left"|"right"|"up"|"down"} direction
     */
    async rotateFanHead(direction) {
        return engine.rotateFanHead(this, this.getDescriptor(), direction);
    }
}

module.exports = AdvancedXiaomiFanMiotDevice;
