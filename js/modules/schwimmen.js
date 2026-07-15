// ============================================================
// schwimmen.js — Schwimm-Modul als CONFIG auf der gemeinsamen Touren-Fabrik.
//
// Baugleich zu Rad/Wandern, aber die Primär-Einheit sind BAHNEN, nicht
// Meter — man kennt die Beckenlänge nicht immer, Bahnen zählen geht immer.
// Der Hero ist deshalb eine reine Anzahl (kein „/1000"): heroFormat +
// kopfStat überschreiben die km-Defaults der Fabrik. Die Meter-Umrechnung
// (Bahnen × Bahnlänge) folgt in einer späteren Etappe.
// Die gesamte Logik steckt in touren/tour-modul.js; hier nur die Config.
// ============================================================

import { formatZahl, formatWert, formatDauer } from '../core/metrics.js';
import {
  erstelleTourModul, tourenFuer, aktivitaetFuer, werteVon,
  statistikFuer, highlightsFuer,
} from './touren/tour-modul.js';

export const MODUL = 'schwimmen';

const CONFIG = {
  modul: MODUL,
  eyebrow: 'Schwimmen',
  h1Touren: 'Schwimmen',
  titelEinzahl: 'Schwimmeinheit',
  nomenEinzahl: 'Einheit',
  nomenMehrzahl: 'Einheiten',
  akzentVar: '--schwimmen',

  standardMesswerte: ['dauer', 'bahnen', 'kalorien', 'puls_avg'],
  optionalMesswerte: ['puls_max'],

  hero: 'bahnen',
  heroEinheit: 'Bahnen',
  heroFormat: v => formatZahl(v, 0),        // Bahnen sind eine reine Anzahl
  dauerModus: 'minSek',                     // eine Einheit dauert Minuten: Min:Sek
  zeileNeben: ['bahnen', 'dauer'],          // kompakte Verlaufszeile

  // Kopf-Statistik (Start-Tab): Bahnen gesamt + Gesamt-Schwimmzeit statt km/hm.
  kopfStat: [
    { zahl: st => formatZahl(st.bahnen, 0), label: 'Bahnen gesamt' },
    { zahl: st => formatDauer(st.dauer),    label: 'Gesamtzeit' },
  ],

  namePlatzhalter: 'z.B. Hallenbad Herscheid',
  leerText: 'Noch keine Schwimmeinheiten. Trag deine erste Einheit ein — ab ins Wasser, wann immer du Lust hast. 🏊',
  leerZeitraumText: 'Keine Einheiten in diesem Zeitraum. Blätter zurück oder wechsle den Zeitraum. 🏊',

  platzhalter: {
    bahnen: '20', kalorien: '350', puls_avg: '120', puls_max: '120',
  },

  rekorde: [
    ['bahnen', 'Meiste Bahnen', v => formatZahl(v, 0) + ' Bahnen'],
    ['dauer', 'Längste Schwimmzeit', v => formatWert('dauer', v)],
  ],

  share: {
    eyebrow: 'SCHWIMMEN · EINHEIT',
    heroLabel: 'BAHNEN',
    dateiBasis: 'all-in-one-schwimmen',
    rueckblick: [
      ['bahnen', '🏊', v => `${formatZahl(v, 0)} Bahnen`],
      ['dauer', '⏱️', v => formatWert('dauer', v)],
      ['kalorien', '🔥', v => `${formatZahl(v, 0)} kcal`],
    ],
  },
};

// ---- Öffentliche Oberfläche (stabil, config-gebunden) ----
export const alleSchwimmeinheiten = (state)       => tourenFuer(state, CONFIG);
export const schwimmAktivitaet    = (state, opts) => aktivitaetFuer(state, CONFIG, opts);
export const schwimmWerte         = (session)     => werteVon(session);
export const schwimmStatistik     = (state)       => statistikFuer(state, CONFIG);
export const schwimmHighlights    = (state, sess) => highlightsFuer(state, CONFIG, sess);
export const erstelleSchwimmModul = (ctx)         => erstelleTourModul(ctx, CONFIG);
