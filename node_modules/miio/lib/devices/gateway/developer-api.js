'use strict';

const EventEmitter = require('events');
const dgram = require('dgram');
const os = require('os');

const MULTICAST_ADDRESS = '224.0.0.50';
const MULTICAST_PORT = 4321;

const SERVER_PORT = 9898;

function isExpectedSocketCloseError(error) {
	return error && (error.code === 'ERR_SOCKET_DGRAM_NOT_RUNNING' || error.code === 'ERR_SOCKET_CLOSED');
}

/**
 * Local Developer API for the gateway. Used to read data from the gateway
 * and connected devices.
 *
 * TODO: Retries for discovery
 */
module.exports = class DeveloperApi extends EventEmitter {
	constructor(parent, address) {
		super();

		this.address = address;
		this.port = SERVER_PORT;
		this._destroyed = false;
		this._readyTimer = null;

		// Bind a custom function instead of using directly to skip resolving debug before id is set
		this.debug = function() { parent.debug.apply(parent, arguments); };
		this._onMessage = this._onMessage.bind(this);
		this._onListening = this._onListening.bind(this);
		this._onSocketError = this._onSocketError.bind(this);

		this.socket = dgram.createSocket({
			type: 'udp4',
			reuseAddr: true
		});

		this.socket.on('message', this._onMessage);
		this.socket.on('listening', this._onListening);
		this.socket.on('error', this._onSocketError);
		this.socket.bind({
			port: SERVER_PORT,
			exclusive: true
		});
	}

	_onListening() {
		if(this._destroyed) return;

		// Add membership to the multicast addresss for all network interfaces
		const interfaces = os.networkInterfaces();
		for(const name of Object.keys(interfaces)) {
			const addresses = interfaces[name];

			for(const addr of addresses) {
				if(addr.family === 'IPv4') {
					this.socket.addMembership(MULTICAST_ADDRESS, addr.address);
				}
			}
		}

		// Broadcast a whois to find all gateways
		const json = JSON.stringify({
			cmd: 'whois'
		});
		this.debug('DEV BROADCAST ->', json);
		this._send(json, MULTICAST_PORT, MULTICAST_ADDRESS);

		// Give us one second to discover the gateway
		this._readyTimer = setTimeout(() => {
			this._readyTimer = null;
			if(this._destroyed) return;

			this.debug('DEV <- Timeout for whois');
			this.emit('ready');
		}, 1000);
	}

	destroy() {
		if(this._destroyed) return;

		this._destroyed = true;
		if(this._readyTimer) {
			clearTimeout(this._readyTimer);
			this._readyTimer = null;
		}

		this.socket.removeListener('message', this._onMessage);
		this.socket.removeListener('listening', this._onListening);
		// Retain the error listener to absorb errors emitted while the socket closes.
		try {
			this.socket.close();
		} catch(error) {
			if(! isExpectedSocketCloseError(error)) throw error;
		}
	}

	send(data) {
		if(this._destroyed) return;

		const json = JSON.stringify(data);
		this.debug('DEV ->', json);

		this._send(json, this.port, this.address);
	}

	_send(json, port, address) {
		if(this._destroyed) return;

		this.socket.send(json, 0, json.length, port, address, err => {
			if(err && ! this._destroyed) {
				this.debug('DEV send failed', err);
			}
		});
	}

	read(sid) {
		this.send({
			cmd: 'read',
			sid: sid
		});
	}

	_onMessage(msg) {
		if(this._destroyed) return;

		let data;
		try {
			this.debug('DEV <-', msg.toString());
			data = JSON.parse(msg.toString());
		} catch(ex) {
			this.emit('error', ex);
			return;
		}

		switch(data.cmd) {
			case 'iam':
				if(data.ip === this.address) {
					this.port = data.port;
					this.sid = data.sid;

					this.emit('ready');
				}
				break;
			case 'read_ack':
			case 'heartbeat':
			case 'report': {
				if(! this.sid && data.model === 'gateway') {
					this.sid = data.sid;
				}

				const parsed = JSON.parse(data.data);
				this.emit('propertiesChanged', {
					id: this.sid === data.sid ? '0' : data.sid,
					data: parsed
				});

				this.emit('properties:' + data.sid, parsed);
			}
		}
	}

	_onSocketError(error) {
		if(this._destroyed) return;

		this.debug('DEV socket error', error);
	}
};
