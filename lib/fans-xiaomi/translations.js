'use strict';

const { MODE } = require('./constants.js');

/**
 * Localized labels for the fan modes, keyed by their native device value (MODE.*).
 * Single source of truth for mode names: drives the per-device tile options
 * (engine.applyCapabilityOptions), the mode flow-card autocomplete, and the
 * mode-changed trigger token. The static capability enum (fan_xiaomi_mode.json)
 * carries English-only stubs; these labels override the tile per device on init.
 */
const MODE_LABELS = {
    [MODE.REGULAR]: { en: 'Regular Fan', nl: 'Gewone ventilator', da: 'Almindelig ventilator', de: 'Normaler Ventilator', es: 'Ventilador normal', fr: 'Ventilateur normal', it: 'Ventilatore normale', no: 'Vanlig vifte', sv: 'Vanlig fläkt', pl: 'Zwykły wentylator', ru: 'Обычный вентилятор', ko: '일반 선풍기' },
    [MODE.NATURAL]: { en: 'Natural Wind', nl: 'Natuurlijke wind', da: 'Naturlig vind', de: 'Natürlicher Wind', es: 'Viento natural', fr: 'Vent naturel', it: 'Vento naturale', no: 'Naturlig vind', sv: 'Naturlig vind', pl: 'Naturalny wiatr', ru: 'Естественный ветер', ko: '자연 바람' },
    [MODE.SLEEP]: { en: 'Sleep (Quiet)', nl: 'Slaap (stil)', da: 'Søvn (stille)', de: 'Schlaf (leise)', es: 'Sueño (silencioso)', fr: 'Sommeil (silencieux)', it: 'Sonno (silenzioso)', no: 'Søvn (stille)', sv: 'Sömn (tyst)', pl: 'Sen (cichy)', ru: 'Сон (тихий)', ko: '수면 (저소음)' }
};

module.exports = { MODE_LABELS };
