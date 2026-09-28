// ============================================================
// koerper.js — Körperwerte (reiner Kern, kein DOM)
//
// Gewicht, Körperfett & Co. sind KEIN Training: Eine Messung ist ein Zustand
// des Körpers, keine Aktivität. Deshalb liegen sie in einer eigenen Liste
// `state.koerper` — nach demselben Muster wie `termine` und `ausfallTage`:
// nie aus Sessions abgeleitet, nie eine Session erzeugend, und sie fließen
// NIE in Statistik oder Wochenzahlen ein.
//
// Warum nicht ins Messwert-Register (metrics.js)? Dort meint `gewicht` das
// GEHOBENE Gewicht. Ein zweites „gewicht" mit anderer Bedeutung im selben
// Register wäre genau die Doppeldeutigkeit, die dieses Projekt vermeidet.
//
// ── Eine Messung pro Tag ───────────────────────────────────
// Man wiegt sich morgens einmal. Ein zweiter Eintrag am selben Tag ergänzt
// deshalb den vorhandenen (upsert), statt eine zweite Zeile zu erzeugen —
// so bleibt der Verlauf eine saubere Kurve statt einer Punktewolke.
//
// ── Neuer Wert von einer neuen Waage? ──────────────────────
// Ein Eintrag in KOERPER_WERTE, sonst nichts. Eingabe, Anzeige, Verlauf und
// Formatierung richten sich danach — derselbe Registry-Gedanke wie in
// metrics.js.
//
// `schritt` ist die Schrittweite, `platzhalter` der graue Beispieltext im
// leeren Feld. Zwei verschiedene Dinge: Als Platzhalter wäre „0,1" nutzlos
// und sähe aus, als stünde schon ein Wert drin.
// ============================================================

import { neueId, heuteIso, isoZuDatum } from './model.js';
import { formatZahl } from './metrics.js';

export const KOERPER_WERTE = Object.freeze({
  gewicht: Object.freeze({
    label: 'Gewicht', einheit: 'kg', dezimal: 1, schritt: 0.1, platzhalter: '95,0',
    standard: true,      // ohne Zutun im Eingabeformular sichtbar
    richtung: 'runter',  // „gut" ist kleiner — nur für die Färbung der Änderung
  }),
  kfa: Object.freeze({
    label: 'Körperfett', einheit: '%', dezimal: 1, schritt: 0.1, platzhalter: '23,5',
    standard: true, richtung: 'runter',
  }),
  muskelmasse: Object.freeze({
    label: 'Muskelmasse', einheit: 'kg', dezimal: 1, schritt: 0.1, platzhalter: '35,0',
    richtung: 'hoch',
  }),
  wasser: Object.freeze({
    label: 'Wasseranteil', einheit: '%', dezimal: 1, schritt: 0.1, platzhalter: '55,0',
    richtung: 'hoch',
  }),
  knochenmasse: Object.freeze({
    label: 'Knochenmasse', einheit: 'kg', dezimal: 1, schritt: 0.1, platzhalter: '3,2',
  }),
  viszeralfett: Object.freeze({
    label: 'Viszeralfett', einheit: '', dezimal: 1, schritt: 0.5, platzhalter: '10',
    richtung: 'runter',
  }),
  bmi: Object.freeze({
    label: 'BMI', einheit: '', dezimal: 1, schritt: 0.1, platzhalter: '27,0',
    richtung: 'runter',
  }),
});

/** Gibt es diesen Körperwert? */
export function istKoerperWert(typ) {
  return Object.prototype.hasOwnProperty.call(KOERPER_WERTE, typ);
}

/** Die Werte, die ohne Zutun im Formular stehen (Gewicht, Körperfett). */
export function standardWerte() {
  return Object.keys(KOERPER_WERTE).filter(t => KOERPER_WERTE[t].standard);
}

/** Anzeige eines Körperwerts, z.B. „95,1 kg" · „23,5 %". */
export function formatKoerperWert(typ, wert) {
  const def = KOERPER_WERTE[typ];
  if (!def) throw new Error(`Unbekannter Körperwert: ${typ}`);
  if (wert == null || !Number.isFinite(wert)) return '–';
  const zahl = formatZahl(wert, def.dezimal ?? 1);
  return def.einheit ? `${zahl} ${def.einheit}` : zahl;
}

// ------------------------------------------------------------
// Messungen lesen
// ------------------------------------------------------------

/** Alle Messungen, neueste zuerst. */
export function messungen(state) {
  return [...(state?.koerper ?? [])].sort((a, b) => b.datum.localeCompare(a.datum));
}

/** Die Messung eines Tages — null, wenn an dem Tag nichts gemessen wurde. */
export function messungAmTag(state, iso) {
  return (state?.koerper ?? []).find(m => m.datum === iso) ?? null;
}

/**
 * Verlauf eines einzelnen Werts, ÄLTESTE zuerst (so wollen es Diagramme).
 * Enthält nur Messungen, in denen der Wert wirklich steht — fehlende Tage
 * werden nicht als 0 erfunden.
 * `ab` (ISO, einschließlich) schneidet alles davor ab; ohne → der ganze Verlauf.
 * @returns [{ datum, wert }]
 */
export function verlauf(state, typ, { ab = null } = {}) {
  return (state?.koerper ?? [])
    .filter(m => typeof m.werte?.[typ] === 'number' && Number.isFinite(m.werte[typ]))
    .filter(m => ab == null || m.datum >= ab)
    .map(m => ({ datum: m.datum, wert: m.werte[typ] }))
    .sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Der jüngste vorhandene Wert — null, wenn nie gemessen. */
export function letzterWert(state, typ) {
  const v = verlauf(state, typ);
  return v.length ? v[v.length - 1] : null;
}

/**
 * Veränderung des jüngsten Werts gegenüber der vorherigen Messung.
 * @returns { jetzt, vorher, diff, seit } oder null (weniger als 2 Messungen)
 */
export function veraenderung(state, typ) {
  const v = verlauf(state, typ);
  if (v.length < 2) return null;
  const jetzt = v[v.length - 1], vorher = v[v.length - 2];
  return {
    jetzt: jetzt.wert, vorher: vorher.wert,
    diff: jetzt.wert - vorher.wert,
    seit: vorher.datum,
  };
}

// ------------------------------------------------------------
// Messungen schreiben
// ------------------------------------------------------------

/** Eine Messung als Objekt (noch nicht im Zustand). */
export function neueMessung({ datum = heuteIso(), werte = {}, notiz = '' } = {}) {
  const unbekannt = Object.keys(werte).filter(t => !istKoerperWert(t));
  if (unbekannt.length) throw new Error(`Unbekannte Körperwerte: ${unbekannt.join(', ')}`);
  return { id: neueId(), datum, werte: { ...werte }, notiz, erstelltAm: new Date().toISOString() };
}

/**
 * Messung eines Tages setzen — ergänzt eine vorhandene, statt sie zu ersetzen.
 * `null` als Wert löscht den einzelnen Eintrag (z.B. Tippfehler korrigieren).
 * @returns die Messung des Tages
 */
export function setzeMessung(state, datum, werte = {}, { notiz } = {}) {
  const unbekannt = Object.keys(werte).filter(t => !istKoerperWert(t));
  if (unbekannt.length) throw new Error(`Unbekannte Körperwerte: ${unbekannt.join(', ')}`);

  state.koerper ??= [];
  let m = messungAmTag(state, datum);
  if (!m) {
    m = neueMessung({ datum, notiz: notiz ?? '' });
    state.koerper.push(m);
  }
  for (const [typ, wert] of Object.entries(werte)) {
    if (wert == null || !Number.isFinite(wert)) delete m.werte[typ];
    else m.werte[typ] = wert;
  }
  if (notiz != null) m.notiz = notiz;
  return m;
}

/** Ganze Messung eines Tages löschen. @returns true, wenn etwas wegfiel. */
export function entferneMessung(state, datum) {
  const vorher = (state?.koerper ?? []).length;
  state.koerper = (state?.koerper ?? []).filter(m => m.datum !== datum);
  return state.koerper.length !== vorher;
}

/** Hat eine Messung überhaupt einen Wert? (Leere Tage sind nutzlos.) */
export function istLeer(messung) {
  return Object.keys(messung?.werte ?? {}).length === 0;
}

// ------------------------------------------------------------
// Zeitraum der Kennzahl-Karten
//
// Rollende Fenster ab heute rückwärts, keine Kalendermonate: „30 Tage" heißt
// auch am 2. Oktober die letzten 30 Tage und nicht „seit dem 1.".
//
// Die Grenze zählt MIT: Bei „7 Tage" gehört die Messung von vor genau
// 7 Tagen dazu. Wer sich einmal pro Woche wiegt, hat so zwei Punkte und
// sieht einen Trend — sonst stünde dort jede Woche nur ein einsamer Punkt.
// ------------------------------------------------------------

/** Die festen Zeiträume in Anzeige-Reihenfolge. `tage: null` = alles. */
export const KOERPER_ZEITRAEUME = Object.freeze([
  Object.freeze({ art: '7',      label: '7 Tage',  tage: 7 }),
  Object.freeze({ art: '30',     label: '30 Tage', tage: 30 }),
  Object.freeze({ art: '365',    label: '1 Jahr',  tage: 365 }),
  Object.freeze({ art: 'gesamt', label: 'Gesamt',  tage: null }),
  Object.freeze({ art: 'eigene', label: 'Eigene',  tage: null }),
]);

/** Voreinstellung für „Eigene", solange noch nie eine Zahl eingetragen wurde. */
export const EIGENE_TAGE_STANDARD = 45;
/** Zehn Jahre reichen — darüber ist es ohnehin „Gesamt". */
export const EIGENE_TAGE_MAX = 3650;

/** 1 … 3650 ganze Tage, sonst null. */
function gueltigeTage(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const t = Math.round(n);
  return t >= 1 && t <= EIGENE_TAGE_MAX ? t : null;
}

/**
 * Der gewählte Zeitraum — immer in sauberer Form, egal was im Speicher steht
 * (ein Backup von Hand bearbeitet, ein alter Stand ohne Einstellung).
 * @returns {{ art, label, tage: number|null, eigeneTage: number }}
 *   tage === null heißt „Gesamt": kein Schnitt.
 */
export function koerperZeitraum(state) {
  const roh = state?.einstellungen?.koerperZeitraum;
  const eigeneTage = gueltigeTage(roh?.eigeneTage) ?? EIGENE_TAGE_STANDARD;
  const def = KOERPER_ZEITRAEUME.find(z => z.art === roh?.art)
    ?? KOERPER_ZEITRAEUME.find(z => z.art === 'gesamt');
  if (def.art === 'eigene') {
    return { art: 'eigene', label: `${eigeneTage} Tage`, tage: eigeneTage, eigeneTage };
  }
  return { art: def.art, label: def.label, tage: def.tage, eigeneTage };
}

/**
 * Zeitraum wählen. `eigeneTage` nur bei „Eigene" nötig; ein unbrauchbarer
 * Wert lässt die bisherige Zahl stehen. Die Zahl bleibt auch gemerkt, wenn
 * man zwischendurch auf „30 Tage" wechselt.
 */
export function setzeKoerperZeitraum(state, art, eigeneTage) {
  if (!KOERPER_ZEITRAEUME.some(z => z.art === art)) return koerperZeitraum(state);
  const bisher = koerperZeitraum(state);
  state.einstellungen ??= {};
  state.einstellungen.koerperZeitraum = {
    art,
    eigeneTage: gueltigeTage(eigeneTage) ?? bisher.eigeneTage,
  };
  return koerperZeitraum(state);
}

/**
 * Erster Tag (ISO, einschließlich), der zum Zeitraum gehört — null bei Gesamt.
 * Heute 26.09., 7 Tage → „2026-09-19".
 */
export function zeitraumAb(zeitraum, heute = heuteIso()) {
  if (zeitraum?.tage == null) return null;
  const d = isoZuDatum(heute);
  d.setUTCDate(d.getUTCDate() - zeitraum.tage);
  return d.toISOString().slice(0, 10);
}

/**
 * Veränderung über den Zeitraum: erster gegen letzten Wert DARIN.
 * @returns {{ anzahl, diff: number|null, seit: string|null }}
 *   anzahl — Messungen dieses Werts im Zeitraum
 *   diff   — letzter minus erster; null bei weniger als zwei Messungen
 *   seit   — Datum der ersten Messung im Zeitraum
 */
export function veraenderungAb(state, typ, ab) {
  const v = verlauf(state, typ, { ab });
  if (v.length < 2) return { anzahl: v.length, diff: null, seit: v[0]?.datum ?? null };
  return { anzahl: v.length, diff: v[v.length - 1].wert - v[0].wert, seit: v[0].datum };
}
