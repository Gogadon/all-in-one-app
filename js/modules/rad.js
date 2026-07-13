// ============================================================
// rad.js — Rad-Modul als CONFIG auf der gemeinsamen Touren-Fabrik.
//
// Die gesamte Logik + UI steckt in touren/tour-modul.js. Hier steht nur
// noch, was Rad ausmacht (Messwerte, Farbe, Labels, Dauer-Modus …).
// Die öffentlichen Exporte behalten ihre Namen, damit app.js, challenge.js
// und die Tests unverändert weiterlaufen.
// ============================================================

import { formatZahl, formatWert } from '../core/metrics.js';
import {
  erstelleTourModul, tourenFuer, aktivitaetFuer, werteVon,
  statistikFuer, highlightsFuer,
} from './touren/tour-modul.js';

export const MODUL = 'rad';

const CONFIG = {
  modul: MODUL,
  eyebrow: 'Rad',
  h1Touren: 'Touren',
  titelEinzahl: 'Radtour',
  nomenEinzahl: 'Tour',
  nomenMehrzahl: 'Touren',
  akzentVar: '--rad',

  standardMesswerte: ['dauer', 'distanz', 'tempo_avg', 'hoehenmeter', 'kalorien', 'puls_avg'],
  optionalMesswerte: ['tempo_max', 'puls_max', 'watt_avg', 'trittfrequenz'],

  hero: 'distanz',
  heroEinheit: 'km',
  dauerModus: 'minSek',                 // Radzeiten wie am Bordcomputer: Min:Sek
  zeileNeben: ['distanz', 'dauer'],     // kompakte Verlaufszeile

  namePlatzhalter: 'z.B. Lüdenscheid Rundfahrt',
  leerText: 'Noch keine Touren. Trag deine erste Runde ein — freie Fahrt, wann immer du Lust hast. 🚲',
  leerZeitraumText: 'Keine Touren in diesem Zeitraum. Blätter zurück oder wechsle den Zeitraum. 🚲',

  platzhalter: {
    distanz: '10,5', tempo_avg: '16,8', tempo_max: '16,8',
    hoehenmeter: '143', kalorien: '365', puls_avg: '116', puls_max: '116',
  },

  rekorde: [
    ['distanz', 'Längste Tour', v => formatZahl(v / 1000, 1) + ' km'],
    ['hoehenmeter', 'Meiste Höhenmeter', v => formatZahl(v, 0) + ' hm'],
    ['dauer', 'Längste Fahrzeit', v => formatWert('dauer', v)],
    ['tempo_avg', 'Schnellste Ø-Geschw.', v => formatZahl(v, 1) + ' km/h'],
  ],

  share: {
    eyebrow: 'RAD · TOUR',
    heroLabel: 'STRECKE',
    dateiBasis: 'all-in-one-tour',
    rueckblick: [
      ['distanz', '🚴', v => `${formatZahl(v / 1000, 1)} km`],
      ['hoehenmeter', '⛰️', v => `${formatZahl(v, 0)} Höhenmeter`],
      ['dauer', '⏱️', v => formatWert('dauer', v)],
      ['kalorien', '🔥', v => `${formatZahl(v, 0)} kcal`],
    ],
  },
};

// ---- Öffentliche Oberfläche (stabil, config-gebunden) ----
export const alleTouren     = (state)        => tourenFuer(state, CONFIG);
export const tourAktivitaet = (state, opts)  => aktivitaetFuer(state, CONFIG, opts);
export const tourWerte      = (session)      => werteVon(session);
export const tourStatistik  = (state)        => statistikFuer(state, CONFIG);
export const tourHighlights = (state, sess)  => highlightsFuer(state, CONFIG, sess);
export const erstelleRadModul = (ctx)        => erstelleTourModul(ctx, CONFIG);
