'use strict';

const { TimedDiscovery, BasicDiscovery, search, addService, removeService } = require('tinkerhub-discovery');
const { Children } = require('abstract-things');

const util = require('util');
const dns = require('dns');

const network = require('./network');
const infoFromHostname = require('./infoFromHostname');

const connectToDevice = require('./connectToDevice');

const tryAdd = Symbol('tryAdd');

const Browser = module.exports.Browser = class Browser extends TimedDiscovery {
	static get type() {
		return 'miio';
	}

	constructor(options) {
		try {
			super({
				maxStaleTime: (options.cacheTime || 1800) * 1000
			});
	
			if(typeof options.useTokenStorage !== 'undefined' ? options.useTokenStorage : true) {
				this.tokens = require('./tokens');
			}
	
			this.manualTokens = options.tokens || {};
			this[tryAdd] = this[tryAdd].bind(this);
	
			this.start();
		} catch (error) {
			console.error(error);
		}
	}

	_manualToken(id) {
		return this.manualTokens[id] || null;
	}

	start() {
		try {
			this.handle = network.ref();
			network.on('device', this[tryAdd]);

			super.start();
		} catch (error) {
			console.error(error);
		}
	}

	stop() {
		try {
			super.stop();

			network.removeListener('device', this[tryAdd]);
			this.handle.release();
		} catch (error) {
			console.error(error);
		}
	}

	[search]() {
		network.search();
	}

	[tryAdd](device) {
		try {
			const service = {
				id: device.id,
				address: device.address,
				port: device.port,
				token: device.token || this._manualToken(device.id),
				autoToken: device.autoToken
			};
	
			// Modified code with backward-compatible check
			const add = () => {
			// Skip services without proper identifiers to prevent "Services must have an identifier" error
			if (!service || !service.id) {
	  			return; // Silently skip invalid services
			}
			this[addService](service);
};
	
			// Give us five seconds to try resolve some extras for new devices
			setTimeout(add, 5000);
	
			dns.lookupService(service.address, service.port, (err, hostname) => {
				if(err || ! hostname) {
					add();
					return;
				}
	
				service.hostname = hostname;
				const info = infoFromHostname(hostname);
				if(info) {
					service.model = info.model;
				}
	
				add();
			});
		} catch (error) {
			console.error(error);
		}
	}

	[util.inspect.custom]() {
		return 'MiioBrowser{}';
	}
};

class Devices extends BasicDiscovery {
	static get type() {
		return 'miio:devices';
	}

	constructor(options) {
		try {
			super();

			this._filter = options && options.filter;
			this._skipSubDevices = options && options.skipSubDevices;

			this._browser = new Browser(options)
				.map(reg => {
					return connectToDevice({
						address: reg.address,
						port: reg.port,
						model: reg.model,
						withPlaceholder: true
					})
						.then(device => {
							reg.device = device;
							return reg;
						});
				});

			this._browser.on('available', s => {
				this[addService](s);

				if(s.device instanceof Children) {
					this._bindSubDevices(s.device);
				}
			});

			this._browser.on('unavailable', s => {
				this[removeService](s);
			});
		} catch (error) {
			console.error(error);
		}
	}

	start() {
		super.start();

		this._browser.start();
	}

	stop() {
		super.stop();

		this._browser.stop();
	}

	[util.inspect.custom]() {
		return 'MiioDevices{}';
	}

	_bindSubDevices(device) {
		try {
			if(this._skipSubDevices) return;

			const handleAvailable = sub => {
				if(! sub.miioModel) return;

				const reg = {
					id: sub.internalId,
					model: sub.model,
					type: sub.type,

					parent: device,
					device: sub
				};

				if(this._filter && ! this._filter(reg)) {
					// Filter does not match sub device
					return;
				}

				// Register and emit event
				this[addService](reg);
			};

			device.on('thing:available', handleAvailable);
			device.on('thing:unavailable', sub => this[removeService](sub.id));

			// Register initial devices
			for(const child of device.children()) {
				handleAvailable(child);
			}
		} catch (error) {
			console.error(error);
		}
	}
}

module.exports.Devices = Devices;