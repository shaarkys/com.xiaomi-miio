'use strict';

const EventEmitter = require('events');
const dgram = require('dgram');

const debug = require('debug');

const Packet = require('./packet');
const DeviceInfo = require('./device_info');

const PORT = 54321;

/**
 * Class for keeping track of the current network of devices. This is used to
 * track a few things:
 *
 * 1) Mapping between adresses and device identifiers. Used when connecting to
 * a device directly via IP or hostname.
 *
 * 2) Mapping between id and detailed device info such as the model.
 *
 */
class Network extends EventEmitter {
	constructor() {
		super();

		this.packet = new Packet(true);

		this.addresses = new Map();
		this.devices = new Map();

		this.references = 0;
		this.debug = debug('miio:network');
	}

	search() {
		try {
			this.packet.handshake();
			const data = Buffer.from(this.packet.raw);
			this.socket.send(data, 0, data.length, PORT, '255.255.255.255', err => {
				if (err) {
					this.debug('Discovery broadcast failed', err);
				}
			});

			// Broadcast an extra time in 500 milliseconds in case the first broadcast misses a few devices
			setTimeout(() => {
				this.socket.send(data, 0, data.length, PORT, '255.255.255.255', err => {
					if (err) {
						this.debug('Discovery broadcast retry failed', err);
					}
				});
			}, 500);
		} catch (error) {
			this.debug(error);
		}
	}

	findDevice(id, rinfo) {
		try {
			// First step, check if we know about the device based on id
			let device = this.devices.get(id);
			if (!device && rinfo) {
				// If we have info about the address, try to resolve again
				device = this.addresses.get(rinfo.address);

				if (!device) {
					// No device found, keep track of this one
					device = new DeviceInfo(this, id, rinfo.address, rinfo.port);
					this.devices.set(id, device);
					this.addresses.set(rinfo.address, device);

					return device;
				}
			}

			return device;
		} catch (error) {
			this.debug(error);
		}
	}

	findDeviceViaAddress(options) {
		try {
			if (!this.socket) {
				throw new Error('Implementation issue: Using network without a reference');
			}
	
			let device = this.addresses.get(options.address);
			if (!device) {
				// No device was found at the address, try to discover it
				device = new DeviceInfo(this, null, options.address, options.port || PORT);
				this.addresses.set(options.address, device);
			}
	
			// Update the token if we have one
			if (typeof options.token === 'string') {
				device.token = Buffer.from(options.token, 'hex');
			} else if(options.token instanceof Buffer) {
				device.token = options.token;
			}
	
			// Set the model if provided
			if (!device.model && options.model) {
				device.model = options.model;
			}
	
			// Perform a handshake with the device to see if we can connect
			return device.handshake()
				.catch(err => {
					if (err.code === 'missing-token') {
						// Supress missing tokens - enrich should take care of that
						return;
					}
					throw err;
				})
				.then(() => {
					if (!this.devices.has(device.id)) {
						// This is a new device, keep track of it
						this.devices.set(device.id, device);
						return device;
					} else {
						// Sanity, make sure that the device in the map is returned
						return this.devices.get(device.id);
					}
				})
				.then(device => {
					/*
					 * After the handshake, call enrich which will fetch extra
					 * information such as the model. It will also try to check
					 * if the provided token (or the auto-token) works correctly.
					 */
					/* extra catch added due to error Device has no identifier yet, handshake needed happening */
					return device.enrich()
						.catch(error => { this.debug(error); });
				})
				.then(() => device);
		} catch (error) {
			this.debug(error);
			return Promise.reject(error);
		}
	}

	createSocket() {
		try {
			const socket = this._socket = dgram.createSocket('udp4');
			socket.on('error', err => {
				// Keep transport errors local so they do not crash the process.
				this.debug('Network socket error', err);
			});

			// Install the receive handler before bind/send can expose the socket to replies.
			socket.on('message', (msg, rinfo) => {
				const buf = Buffer.from(msg);
				try {
					this.packet.raw = buf;
				} catch(ex) {
					this.debug('Could not handle incoming message');
					return;
				}

				if (!this.packet.deviceId) {
					this.debug('No device identifier in incoming packet');
					return;
				}

				const device = this.findDevice(this.packet.deviceId, rinfo);
				device.onMessage(buf);

				if (!this.packet.data) {
					if (!device.enriched) {
						// This is the first time we see this device
						device.enrich()
							.then(() => {
								this.emit('device', device);
							})
							.catch(err => {
								this.emit('device', device);
							});
					} else {
						this.emit('device', device);
					}
				}
			});

			// Bind immediately. Node queues sends while binding, so replies cannot arrive
			// before the receive handler above has been installed.
			socket.bind(() => {
				if (this._socket !== socket) return;

				socket.setBroadcast(true);

				const address = socket.address();
				this.debug('Network bound to port', address.port);
			});
		} catch (error) {
			console.log(error);
		}
	}

	list() {
		return this.devices.values();
	}

	/**
	 * Get a reference to the network. Helps with locking of a socket.
	 */
	ref() {
		try {
			this.debug('Grabbing reference to network');
			this.references++;
			this.updateSocket();

			let released = false;
			let self = this;
			return {
				release() {
					if(released) return;

					self.debug('Releasing reference to network');

					released = true;
					self.references--;

					self.updateSocket();
				}
			};
		} catch (error) {
			this.debug(error);
		}
	}

	/**
	 * Update wether the socket is available or not. Instead of always keeping
	 * a socket we track if it is available to allow Node to exit if no
	 * discovery or device is being used.
	 */
	updateSocket() {
		try {
			if (this.references === 0) {
				// No more references, kill the socket
				if(this._socket) {
					this.debug('Network no longer active, destroying socket');
					this._socket.close();
					this._socket = null;
				}
			} else if(this.references === 1 && ! this._socket) {
				// This is the first reference, create the socket
				this.debug('Making network active, creating socket');
				this.createSocket();
			}
		} catch (error) {
			this.debug(error);
		}
	}

	get socket() {
		try {
			if(!this._socket) {
				// RECREATING SOCKET IF IT'S KILLED, WE NEED IT AVAILABLE AT ALL TIME
				this.createSocket();
			}
	
			return this._socket;
		} catch (error) {
			this.debug(error);
		}
	}
}

module.exports = new Network();
