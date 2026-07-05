// ============================================================
// library.js — die zentrale Aktivitäts-Bibliothek
// Aktivitäten existieren eigenständig (state.bibliothek) und
// werden von Sessions/Plänen nur per ID referenziert.
//
// Wichtige Lehre aus der Gym-App: Löschen darf keine Historie
// zerstören. Deshalb: ARCHIVIEREN ist der Normalweg (Aktivität
// verschwindet aus Auswahllisten, Verlauf bleibt lesbar).
// Hartes Löschen geht nur, wenn nichts sie referenziert.
// ============================================================

import { istMesswert } from './metrics.js';
import { neueAktivitaet, neueId, findeAktivitaet } from './model.js';

// ------------------------------------------------------------
// Anlegen & Ändern
// ------------------------------------------------------------

/** Aktivität anlegen und in die Bibliothek einsortieren. Gibt sie zurück. */
export function addAktivitaet(state, daten) {
  const akt = neueAktivitaet(daten);
  state.bibliothek.push(akt);
  return akt;
}

/** Umbenennen (wirkt überall, da Sessions nur die ID kennen). */
export function benenneUm(state, id, neuerName) {
  const akt = muss(state, id);
  if (!neuerName || !neuerName.trim()) throw new Error('Name darf nicht leer sein.');
  akt.name = neuerName.trim();
  return akt;
}

/** Einstellungen teilweise aktualisieren (Progression, einarmig, assistiert …). */
export function setzeEinstellungen(state, id, patch) {
  const akt = muss(state, id);
  akt.einstellungen = { ...akt.einstellungen, ...patch };
  return akt;
}

/** Messwert-Typen einer Aktivität neu setzen (Reihenfolge = Eingabe-Reihenfolge). */
export function setzeMesswerte(state, id, messwerte) {
  const akt = muss(state, id);
  const unbekannt = messwerte.filter(t => !istMesswert(t));
  if (unbekannt.length) throw new Error(`Unbekannte Messwerte: ${unbekannt.join(', ')}`);
  akt.messwerte = [...messwerte];
  return akt;
}

// ------------------------------------------------------------
// Archivieren & Löschen
// ------------------------------------------------------------

/** In wie vielen Sessions kommt die Aktivität vor? */
export function wirdVerwendet(state, id) {
  return state.sessions.filter(s => s.segmente.some(seg => seg.aktivitaetId === id)).length;
}

/** Archivieren: raus aus Auswahllisten, Verlauf bleibt vollständig. */
export function archiviere(state, id) {
  muss(state, id).archiviert = true;
}

/** Archivierung aufheben. */
export function reaktiviere(state, id) {
  delete muss(state, id).archiviert;
}

/**
 * Hartes Löschen — NUR wenn keine Session sie referenziert.
 * Sonst Fehler mit Hinweis auf Archivieren.
 */
export function entferneAktivitaet(state, id) {
  const anzahl = wirdVerwendet(state, id);
  if (anzahl > 0) {
    throw new Error(`Aktivität steckt in ${anzahl} Session(s) — bitte archivieren statt löschen.`);
  }
  const i = state.bibliothek.findIndex(a => a.id === id);
  if (i === -1) throw new Error('Aktivität nicht gefunden.');
  state.bibliothek.splice(i, 1);
}

// ------------------------------------------------------------
// Alternativen (Ersatzübungen)
// Erben nur die Kategorie der Hauptaktivität; eigener Name,
// eigene Einstellungen, eigene Historie (über altOf im Segment).
// ------------------------------------------------------------

/** Alternative anlegen. Gibt sie zurück. */
export function addAlternative(state, aktivitaetId, { name, einstellungen = {} }) {
  const akt = muss(state, aktivitaetId);
  if (!name || !name.trim()) throw new Error('Alternative braucht einen Namen.');
  const alt = { id: neueId(), name: name.trim(), einstellungen: { ...einstellungen } };
  (akt.alternativen ??= []).push(alt);
  return alt;
}

/** Wie oft wurde eine Alternative in Sessions benutzt? */
export function alternativeWirdVerwendet(state, altId) {
  return state.sessions.filter(s => s.segmente.some(seg => seg.altOf === altId)).length;
}

/** Alternative entfernen — nur wenn unbenutzt (sonst würde Verlauf den Namen verlieren). */
export function entferneAlternative(state, aktivitaetId, altId) {
  const akt = muss(state, aktivitaetId);
  const anzahl = alternativeWirdVerwendet(state, altId);
  if (anzahl > 0) {
    throw new Error(`Alternative steckt in ${anzahl} Session(s) und bleibt deshalb erhalten.`);
  }
  const i = (akt.alternativen ?? []).findIndex(a => a.id === altId);
  if (i === -1) throw new Error('Alternative nicht gefunden.');
  akt.alternativen.splice(i, 1);
}

// ------------------------------------------------------------
// Abfragen & Vorschläge
// ------------------------------------------------------------

/** Aktive Aktivitäten einer Kategorie (Standard: ohne archivierte). */
export function aktivitaetenNachKategorie(state, kategorie, { mitArchivierten = false } = {}) {
  return state.bibliothek.filter(a =>
    a.kategorie === kategorie && (mitArchivierten || !a.archiviert));
}

/** Namenssuche (grob, Groß/Klein egal) über die ganze Bibliothek. */
export function sucheAktivitaet(state, text) {
  const q = (text ?? '').trim().toLowerCase();
  if (!q) return [];
  return state.bibliothek.filter(a => a.name.toLowerCase().includes(q));
}

/** Sinnvolle Standard-Messwerte je Kategorie — als Vorbelegung fürs Anlegen-UI. */
export function vorschlagMesswerte(kategorie) {
  switch (kategorie) {
    case 'kraft':     return ['gewicht', 'wdh'];
    case 'rad':       return ['distanz', 'hoehenmeter', 'dauer', 'puls_avg', 'puls_max'];
    case 'wandern':   return ['distanz', 'hoehenmeter', 'dauer', 'puls_avg', 'puls_max'];
    case 'schwimmen': return ['dauer', 'puls_avg', 'puls_max']; // Distanz kommt in Etappe 3 dazu
    default:          return ['dauer'];
  }
}

// ------------------------------------------------------------
// intern
// ------------------------------------------------------------
function muss(state, id) {
  const akt = findeAktivitaet(state, id);
  if (!akt) throw new Error('Aktivität nicht gefunden.');
  return akt;
}
