// ============================================================
// model.js — das einheitliche Datenmodell
// Bibliothek → Session → Segment → Eintrag → Messwerte
//
// Kraftübung = Segment mit MEHREREN Einträgen (Sätze)
// Cardio     = Segment mit GENAU EINEM Eintrag
// → gleiche Struktur, ein Code-Pfad. Kein Cardio-Sonderfall.
// ============================================================

import { MESSWERTE, istMesswert, aggregiere, eintragVolumen } from './metrics.js';

export const KATEGORIEN = Object.freeze(['kraft', 'rad', 'wandern', 'schwimmen', 'sonstiges']);

// ------------------------------------------------------------
// IDs & Datum
// ------------------------------------------------------------

export function neueId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback (sehr alte Browser): Zeit + Zufall
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Heutiges Datum als "YYYY-MM-DD" (lokale Zeit, nicht UTC). */
export function heuteIso(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ------------------------------------------------------------
// Datums-Helfer
//
// WICHTIG: Alle rechnen auf ISO-Strings ('YYYY-MM-DD') und intern in UTC.
// Ein `new Date()` + `toISOString()` wäre fehlerhaft — es rechnet die lokale
// Zeit nach UTC zurück und kippt dadurch an Tagesgrenzen um einen Tag.
// Deshalb: erst mit heuteIso() den lokalen Kalendertag bestimmen, dann rein
// in UTC weiterrechnen.
// ------------------------------------------------------------

/** Montag der Woche, in der `heute` liegt (ISO). */
export function wochenStart(heute = heuteIso()) {
  const [y, m, d] = heute.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const tag = (dt.getUTCDay() + 6) % 7;   // Mo=0
  dt.setUTCDate(dt.getUTCDate() - tag);
  return dt.toISOString().slice(0, 10);
}

/** Erster Tag des Monats, in dem `heute` liegt (ISO). */
export function monatsStart(heute = heuteIso()) {
  return heute.slice(0, 7) + '-01';
}

/** Erster Tag des Jahres, in dem `heute` liegt (ISO). */
export function jahresStart(heute = heuteIso()) {
  return heute.slice(0, 4) + '-01-01';
}

/** Der Kalendertag nach `iso` (ISO). */
export function naechsterTag(iso) {
  const [y, m, t] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, t + 1));
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// Fabriken — erzeugen valide Objekte, mehr nicht.
// (Reines JSON, keine Klassen → wandert 1:1 in localStorage/Backups.)
// ------------------------------------------------------------

/** Aktivität für die Bibliothek. Wirft bei ungültiger Kategorie/Messwerten. */
export function neueAktivitaet({ name, kategorie, messwerte = [], einstellungen = {}, alternativen = [] }) {
  if (!name || !name.trim()) throw new Error('Aktivität braucht einen Namen.');
  if (!KATEGORIEN.includes(kategorie)) throw new Error(`Unbekannte Kategorie: ${kategorie}`);
  const unbekannt = messwerte.filter(t => !istMesswert(t));
  if (unbekannt.length) throw new Error(`Unbekannte Messwerte: ${unbekannt.join(', ')}`);
  return {
    id: neueId(),
    name: name.trim(),
    kategorie,
    messwerte: [...messwerte],   // welche Typen diese Aktivität nutzt (Reihenfolge = Eingabe-Reihenfolge)
    einstellungen: { ...einstellungen },   // Progression, einarmig, assistiert … (v.a. Kraft)
    alternativen: [...alternativen],       // [{id, name, einstellungen?}]
  };
}

/** Session = was tatsächlich passiert ist. ausPlan leer → spontan. */
export function neueSession({ datum = heuteIso(), ausPlan = null, notiz = '' } = {}) {
  return { id: neueId(), datum, ausPlan, notiz, segmente: [] };
}

/** Segment = eine Aktivität innerhalb einer Session. altOf = genutzte Alternative. */
export function neuesSegment(aktivitaetId, { altOf = null } = {}) {
  if (!aktivitaetId) throw new Error('Segment braucht eine aktivitaetId.');
  return { id: neueId(), aktivitaetId, altOf, eintraege: [] };
}

/** Eintrag = ein Satz (Kraft) bzw. DIE eine Zeile (Cardio). */
export function neuerEintrag(messwerte = {}, { flags = [], quelle = 'manuell' } = {}) {
  const unbekannt = Object.keys(messwerte).filter(t => !istMesswert(t));
  if (unbekannt.length) throw new Error(`Unbekannte Messwerte: ${unbekannt.join(', ')}`);
  return { id: neueId(), messwerte: { ...messwerte }, flags: [...flags], quelle };
}

// ------------------------------------------------------------
// Log-Logik — kleine, generische Helfer. EIN Pfad für alles.
// ------------------------------------------------------------

/** Segment an Session anhängen (gibt das Segment zurück). */
export function addSegment(session, segment) {
  session.segmente.push(segment);
  return segment;
}

/** Eintrag an Segment anhängen (gibt den Eintrag zurück). */
export function addEintrag(segment, eintrag) {
  segment.eintraege.push(eintrag);
  return eintrag;
}

/** Alle Einträge einer Session (flach, über alle Segmente). */
export function alleEintraege(session) {
  return session.segmente.flatMap(seg => seg.eintraege);
}

/** Hat der Eintrag ein Flag (z.B. 'aufwaermsatz')? */
export function hatFlag(eintrag, flag) {
  return Array.isArray(eintrag.flags) && eintrag.flags.includes(flag);
}

/**
 * Aggregierter Wert eines Segments für einen Messwert-Typ.
 * Funktioniert identisch für Kraft (n Sätze) und Cardio (1 Eintrag).
 */
export function segmentWert(segment, typ, { ohneFlag = null } = {}) {
  let eintraege = segment.eintraege;
  if (ohneFlag) eintraege = eintraege.filter(e => !hatFlag(e, ohneFlag));
  return aggregiere(typ, eintraege.map(e => e.messwerte[typ]));
}

/**
 * Aggregierter Wert einer ganzen Session für einen Messwert-Typ.
 * filterSegment (optional): z.B. nur Segmente einer Kategorie.
 */
export function sessionWert(session, typ, { filterSegment = null, ohneFlag = null } = {}) {
  let segmente = session.segmente;
  if (filterSegment) segmente = segmente.filter(filterSegment);
  let eintraege = segmente.flatMap(seg => seg.eintraege);
  if (ohneFlag) eintraege = eintraege.filter(e => !hatFlag(e, ohneFlag));
  return aggregiere(typ, eintraege.map(e => e.messwerte[typ]));
}

/** Volumen (kg) eines Segments: Σ gewicht × wdh. Aufwärmsätze zählen NICHT. */
export function segmentVolumen(segment) {
  return segment.eintraege
    .filter(e => !hatFlag(e, 'aufwaermsatz'))
    .reduce((sum, e) => sum + eintragVolumen(e.messwerte), 0);
}

/** Volumen (kg) einer Session. */
export function sessionVolumen(session) {
  return session.segmente.reduce((sum, seg) => sum + segmentVolumen(seg), 0);
}

// ------------------------------------------------------------
// Bibliothek-Zugriff (arbeitet auf state.bibliothek)
// ------------------------------------------------------------

/** Aktivität per ID. */
export function findeAktivitaet(state, id) {
  return state.bibliothek.find(a => a.id === id) ?? null;
}

/**
 * Löst ein Segment zu {aktivitaet, alternative, anzeigeName} auf.
 * altOf gesetzt → Name/Einstellungen der Alternative, Typ bleibt der Hauptaktivität.
 */
export function loeseSegmentAuf(state, segment) {
  const aktivitaet = findeAktivitaet(state, segment.aktivitaetId);
  if (!aktivitaet) return { aktivitaet: null, alternative: null, anzeigeName: '(gelöschte Aktivität)' };
  let alternative = null;
  if (segment.altOf) {
    alternative = (aktivitaet.alternativen ?? []).find(a => a.id === segment.altOf) ?? null;
  }
  return { aktivitaet, alternative, anzeigeName: alternative?.name ?? aktivitaet.name };
}

// ------------------------------------------------------------
// Session-Abfragen (arbeiten auf state.sessions)
// ------------------------------------------------------------

/** Alle Sessions eines Tages ("YYYY-MM-DD"). */
export function sessionsAmTag(state, iso) {
  return state.sessions.filter(s => s.datum === iso);
}

/** Sessions, die eine bestimmte Aktivität enthalten — neueste zuerst. */
export function sessionsMitAktivitaet(state, aktivitaetId, { limit = null } = {}) {
  const treffer = state.sessions
    .filter(s => s.segmente.some(seg => seg.aktivitaetId === aktivitaetId))
    .sort((a, b) => b.datum.localeCompare(a.datum));
  return limit ? treffer.slice(0, limit) : treffer;
}

/** Kategorien, die in einer Session vorkommen (für Tags/Farben im Feed). */
export function sessionKategorien(state, session) {
  const set = new Set();
  for (const seg of session.segmente) {
    const akt = findeAktivitaet(state, seg.aktivitaetId);
    if (akt) set.add(akt.kategorie);
  }
  return [...set];
}
