// ============================================================
// wandern.js — Wander-Modul als CONFIG auf der gemeinsamen Touren-Fabrik.
//
// Baugleich zu Rad, aber mit eigenem Fokus: Höhenmeter und Schritte statt
// Geschwindigkeit, Dauer als Std:Min (eine Wanderung dauert Stunden).
// Die gesamte Logik steckt in touren/tour-modul.js; hier nur die Config.
// Öffentliche Exporte behalten ihre Namen (app.js/Tests laufen unverändert).
// ============================================================

import { formatZahl, formatWert } from '../core/metrics.js';
import {
  erstelleTourModul, tourenFuer, aktivitaetFuer, werteVon,
  statistikFuer, highlightsFuer,
} from './touren/tour-modul.js';

export const MODUL = 'wandern';

const CONFIG = {
  modul: MODUL,
  eyebrow: 'Wandern',
  h1Touren: 'Wanderungen',
  titelEinzahl: 'Wanderung',
  nomenEinzahl: 'Wanderung',
  nomenMehrzahl: 'Wanderungen',
  akzentVar: '--wandern',

  standardMesswerte: ['dauer', 'distanz', 'hoehenmeter', 'schritte', 'kalorien', 'puls_avg'],
  optionalMesswerte: ['puls_max'],

  hero: 'distanz',
  heroEinheit: 'km',
  dauerModus: 'stdMin',                    // Wanderung dauert Stunden: Std:Min
  zeileNeben: ['distanz', 'hoehenmeter'],  // kompakte Verlaufszeile

  namePlatzhalter: 'z.B. Nordhelle-Rundweg',
  leerText: 'Noch keine Wanderungen. Trag deine erste Tour ein — raus in die Natur, wann immer du Lust hast. 🥾',
  leerZeitraumText: 'Keine Wanderungen in diesem Zeitraum. Blätter zurück oder wechsle den Zeitraum. 🥾',

  platzhalter: {
    distanz: '8,5', hoehenmeter: '420', schritte: '12000',
    kalorien: '650', puls_avg: '108', puls_max: '108',
  },

  rekorde: [
    ['distanz', 'Längste Wanderung', v => formatZahl(v / 1000, 1) + ' km'],
    ['hoehenmeter', 'Meiste Höhenmeter', v => formatZahl(v, 0) + ' hm'],
    ['dauer', 'Längste Gehzeit', v => formatWert('dauer', v)],
    ['schritte', 'Meiste Schritte', v => formatZahl(v, 0)],
  ],

  share: {
    eyebrow: 'WANDERN · TOUR',
    heroLabel: 'STRECKE',
    dateiBasis: 'all-in-one-wanderung',
    rueckblick: [
      ['distanz', '🥾', v => `${formatZahl(v / 1000, 1)} km`],
      ['hoehenmeter', '⛰️', v => `${formatZahl(v, 0)} Höhenmeter`],
      ['dauer', '⏱️', v => formatWert('dauer', v)],
      ['schritte', '👣', v => `${formatZahl(v, 0)} Schritte`],
    ],
  },
};

// ---- Öffentliche Oberfläche (stabil, config-gebunden) ----
export const alleWanderungen  = (state)       => tourenFuer(state, CONFIG);
export const wanderAktivitaet = (state, opts) => aktivitaetFuer(state, CONFIG, opts);
export const wanderWerte      = (session)     => werteVon(session);
export const wanderStatistik  = (state)       => statistikFuer(state, CONFIG);
export const wanderHighlights = (state, sess) => highlightsFuer(state, CONFIG, sess);
export const erstelleWanderModul = (ctx)      => erstelleTourModul(ctx, CONFIG);
