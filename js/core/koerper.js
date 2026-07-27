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

import { neueId, heuteIso } from './model.js';
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
 * @returns [{ datum, wert }]
 */
export function verlauf(state, typ) {
  return (state?.koerper ?? [])
    .filter(m => typeof m.werte?.[typ] === 'number' && Number.isFinite(m.werte[typ]))
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
