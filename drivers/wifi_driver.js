'use strict';

const Homey = require('homey');
const miio = require('miio');
const Util = require('../lib/util.js');

const PAIR_DIAGNOSTIC_MESSAGE_LIMIT = 240;

function getPairingString(value) {
  return typeof value === 'string' ? value : null;
}

function getPairingAddressType(address) {
  const value = getPairingString(address);
  if (value === null) return address == null ? 'missing' : typeof address;

  const trimmed = value.trim();
  const octets = trimmed.split('.');
  if (octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return 'ipv4';
  if (trimmed.includes(':') && /^[0-9a-fA-F:.%]+$/.test(trimmed)) return 'ipv6';
  if (/^[a-zA-Z0-9.-]+$/.test(trimmed)) return 'hostname';
  return trimmed ? 'invalid' : 'empty';
}

function getPairingTokenFormat(token) {
  const value = getPairingString(token);
  if (value === null) return token == null ? 'missing' : typeof token;

  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return 'hex32';
  if (/^[a-zA-Z0-9]{32}$/.test(trimmed)) return 'alphanumeric32';
  if (trimmed.length === 32) return 'length32-invalid-characters';
  return trimmed ? 'invalid-length' : 'empty';
}

function getPairingInputDiagnostic(data) {
  const address = data && data.address;
  const token = data && data.token;
  const polling = data && data.polling;
  const addressValue = getPairingString(address);
  const tokenValue = getPairingString(token);
  const pollingValue = typeof polling === 'number' && Number.isFinite(polling) ? polling : 'invalid';

  return {
    inputSummary: [
      `addressType=${getPairingAddressType(address)}`,
      `addressLength=${addressValue === null ? 'n/a' : addressValue.length}`,
      `addressWhitespace=${addressValue === null ? 'n/a' : addressValue !== addressValue.trim()}`,
      `tokenType=${token == null ? 'missing' : typeof token}`,
      `tokenLength=${tokenValue === null ? 'n/a' : tokenValue.length}`,
      `tokenTrimmedLength=${tokenValue === null ? 'n/a' : tokenValue.trim().length}`,
      `tokenWhitespace=${tokenValue === null ? 'n/a' : tokenValue !== tokenValue.trim()}`,
      `tokenFormat=${getPairingTokenFormat(token)}`,
      `polling=${pollingValue}`
    ].join(', '),
    sensitiveValues: [addressValue, addressValue?.trim(), tokenValue, tokenValue?.trim()]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .sort((left, right) => right.length - left.length)
  };
}

function getSafeErrorField(error, field, fallback) {
  try {
    const value = error && error[field];
    if (value === undefined || value === null || value === '') return fallback;
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function sanitizePairingDiagnosticText(value, sensitiveValues = []) {
  let sanitized = String(value);
  sensitiveValues.forEach((sensitiveValue) => {
    sanitized = sanitized.split(sensitiveValue).join('[redacted-input]');
  });

  return sanitized
    .replace(/[\r\n]+/g, ' ')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-address]')
    .replace(/\b[a-zA-Z0-9]{32}\b/g, '[redacted-credential]')
    .replace(/\b(token|password|secret|authorization)\b\s*[:=]\s*[^,;\s]+/gi, '$1=[redacted]')
    .slice(0, PAIR_DIAGNOSTIC_MESSAGE_LIMIT);
}

class MiHomeWifiDriver extends Homey.Driver {

  onInit() {
    if (!this.util) this.util = new Util({homey: this.homey});
  }

  _logPairingDiagnostic(message) {
    try {
      if (typeof this.log === 'function') this.log(message);
    } catch (_) {
      // Diagnostics must never change pairing behavior.
    }
  }

  _startPairingDiagnostic(data) {
    try {
      const currentAttempt = Number.isSafeInteger(this._pairingDiagnosticAttempt) ? this._pairingDiagnosticAttempt : 0;
      this._pairingDiagnosticAttempt = currentAttempt + 1;
      const inputDiagnostic = getPairingInputDiagnostic(data);
      const context = {
        attempt: this._pairingDiagnosticAttempt,
        inputSummary: inputDiagnostic.inputSummary,
        sensitiveValues: inputDiagnostic.sensitiveValues,
        stage: 'miio.device',
        startedAt: Date.now()
      };
      this._logPairingDiagnostic(`[PAIR] Test #${context.attempt} started: stage=${context.stage}, ${context.inputSummary}.`);
      return context;
    } catch (_) {
      return null;
    }
  }

  _setPairingDiagnosticStage(context, stage) {
    try {
      if (context) context.stage = stage;
    } catch (_) {
      // Diagnostics must never change pairing behavior.
    }
  }

  _completePairingDiagnostic(context, model) {
    try {
      if (!context) return;
      const elapsedMs = Math.max(0, Date.now() - context.startedAt);
      const safeModel = sanitizePairingDiagnosticText(model == null ? 'unknown' : model, context.sensitiveValues);
      this._logPairingDiagnostic(`[PAIR] Test #${context.attempt} succeeded: stage=complete, elapsedMs=${elapsedMs}, model=${safeModel}.`);
    } catch (_) {
      // Diagnostics must never change pairing behavior.
    }
  }

  _failPairingDiagnostic(context, error) {
    try {
      if (!context) return;
      const elapsedMs = Math.max(0, Date.now() - context.startedAt);
      const code = sanitizePairingDiagnosticText(getSafeErrorField(error, 'code', 'unknown'), context.sensitiveValues);
      const name = sanitizePairingDiagnosticText(getSafeErrorField(error, 'name', 'Error'), context.sensitiveValues);
      const message = sanitizePairingDiagnosticText(getSafeErrorField(error, 'message', 'Unknown error'), context.sensitiveValues);
      this._logPairingDiagnostic(
        `[PAIR] Test #${context.attempt} failed: stage=${context.stage}, elapsedMs=${elapsedMs}, code=${code}, name=${name}, message=${message}; ${context.inputSummary}.`
      );
    } catch (_) {
      // Diagnostics must never change pairing behavior.
    }
  }

  onPair(session) {

    let deviceObject = {};

    session.setHandler('test_connection', async (data) => {
      const diagnostic = this._startPairingDiagnostic(data);
      try {
        const device = await miio.device({ address: data.address, token: data.token });
        this._setPairingDiagnosticStage(diagnostic, 'model-detection');
        const model = await device.miioModel;
        this._setPairingDiagnosticStage(diagnostic, 'device-object');
        const name = await this.util.getFriendlyNameWiFi(model) || 'Unknown model';
        const device_name = name + ' ('+ model +')';

        // Optional hook: a driver may return a model-specific capability list to create the device with.
        // When omitted (undefined), the device keeps the capabilities declared in its driver.compose.json.
        const capabilities = this.getPairingCapabilities?.(model);

        deviceObject = {
          name: device_name,
          data: {
            id: data.token
          },
          settings: {
            address: data.address,
            token: data.token,
            polling: data.polling
          },
          store: {
            model: model
          },
          ...(capabilities ? { capabilities } : {})
        }
        this._completePairingDiagnostic(diagnostic, model);
        return Promise.resolve(deviceObject);
      } catch (error) {
        this._failPairingDiagnostic(diagnostic, error);
        this.error(error);
        return Promise.reject(error);
      }
    });

    session.setHandler('add_device', async () => {
      try {
        return Promise.resolve(deviceObject);
      } catch (error) {
        this.error(error);
        return Promise.reject(error);
      }
    });

  }

}

module.exports = MiHomeWifiDriver;
