// ============================================================
// plan.js — Plan/Zyklus, optionaler Überbau PRO MODUL
//
// ZWEI Ebenen, klar getrennt (wie die Übungs-Bibliothek):
//
// state.plaene.kraft = {
//   einheiten: [ Einheit … ],   ← BIBLIOTHEK: jede Einheit existiert 1×
//   zyklus:    [ einheitId … ], ← ABLAUF: Verweise, Mehrfachnennung erlaubt
//   position:  0,               ← Zeiger in den ZYKLUS (nicht die Bibliothek)
// }
//
// Einheit (Rezept):
//   { id, name, kategorie, segmente: [{ aktivitaetId }] }
//
// Weil Übungen UND Historie an der Einheit hängen (nicht an der
// Zyklus-Position), teilen sich alle Vorkommen derselben Einheit
// automatisch alles: „Rücken · Bizeps" an Position 1 und 5 ist
// dieselbe Einheit. Einheiten sind über Pläne hinweg wiederverwendbar.
//
// Das Session-Modell merkt vom Plan nichts: ausPlan verweist nur
// zur Info auf die Einheit.
// ============================================================

import { KATEGORIEN, neueId, neueSession, neuesSegment, findeAktivitaet } from './model.js';

// ------------------------------------------------------------
// Plan holen / anlegen
// ------------------------------------------------------------

/** Plan eines Moduls — null, wenn keiner existiert (spontan ist der Standard). */
export function planFuer(state, modul) {
  return state.plaene?.[modul] ?? null;
}

/** Plan holen oder frisch anlegen. */
export function erstellePlan(state, modul) {
  state.plaene ??= {};
  state.plaene[modul] ??= { einheiten: [], zyklus: [], position: 0 };
  const p = state.plaene[modul];
  p.einheiten ??= []; p.zyklus ??= []; p.position ??= 0;
  return p;
}

/** Ganzen Plan eines Moduls entfernen (Sessions bleiben unberührt). */
export function entfernePlan(state, modul) {
  if (state.plaene) delete state.plaene[modul];
}

// ============================================================
// EINHEITEN-BIBLIOTHEK
// ============================================================

/** Einheit anlegen (nur Bibliothek — landet NICHT automatisch im Zyklus). */
export function addEinheit(state, modul, { name, kategorie = modul }) {
  if (!name || !name.trim()) throw new Error('Einheit braucht einen Namen.');
  if (!KATEGORIEN.includes(kategorie)) throw new Error(`Unbekannte Kategorie: ${kategorie}`);
  const plan = erstellePlan(state, modul);
  const einheit = { id: neueId(), name: name.trim(), kategorie, segmente: [] };
  plan.einheiten.push(einheit);
  return einheit;
}

/** Alle Einheiten der Bibliothek. */
export function einheitenBibliothek(state, modul) {
  return planFuer(state, modul)?.einheiten ?? [];
}

/** Einheit per ID (aus der Bibliothek). */
export function findeEinheit(state, modul, einheitId) {
  return planFuer(state, modul)?.einheiten.find(e => e.id === einheitId) ?? null;
}

/** Einheit umbenennen (wirkt an allen Zyklus-Stellen — es ist dieselbe). */
export function benenneEinheitUm(state, modul, einheitId, neuerName) {
  const e = mussEinheit(state, modul, einheitId);
  if (!neuerName || !neuerName.trim()) throw new Error('Name darf nicht leer sein.');
  e.name = neuerName.trim();
  return e;
}

/**
 * Einheit aus der BIBLIOTHEK löschen — entfernt zugleich ALLE ihre
 * Vorkommen aus dem Zyklus. Position bleibt konsistent.
 */
export function loescheEinheit(state, modul, einheitId) {
  const plan = mussPlan(state, modul);
  const iB = plan.einheiten.findIndex(e => e.id === einheitId);
  if (iB === -1) throw new Error('Einheit nicht gefunden.');
  // Vorkommen im Zyklus einsammeln (für Positions-Korrektur), dann raus.
  const zeigtAuf = plan.zyklus[plan.position];
  plan.einheiten.splice(iB, 1);
  plan.zyklus = plan.zyklus.filter(id => id !== einheitId);
  reparierePosition(plan, zeigtAuf);
}

// ------------------------------------------------------------
// Aktivitäten in einer Einheit (Vorlage-Segmente)
// ------------------------------------------------------------

export function addAktivitaetZuEinheit(state, modul, einheitId, aktivitaetId) {
  const e = mussEinheit(state, modul, einheitId);
  if (!findeAktivitaet(state, aktivitaetId)) throw new Error('Aktivität nicht gefunden.');
  e.segmente.push({ aktivitaetId });
}

export function entferneAktivitaetAusEinheit(state, modul, einheitId, aktivitaetId) {
  const e = mussEinheit(state, modul, einheitId);
  const i = e.segmente.findIndex(s => s.aktivitaetId === aktivitaetId);
  if (i === -1) throw new Error('Aktivität ist nicht in dieser Einheit.');
  e.segmente.splice(i, 1);
}

export function verschiebeAktivitaetInEinheit(state, modul, einheitId, index, richtung) {
  const e = mussEinheit(state, modul, einheitId);
  const j = index + Math.sign(richtung);
  if (index < 0 || index >= e.segmente.length || j < 0 || j >= e.segmente.length) return;
  [e.segmente[index], e.segmente[j]] = [e.segmente[j], e.segmente[index]];
}

// ============================================================
// ZYKLUS (Ablauf — Liste von Einheiten-IDs, Mehrfachnennung erlaubt)
// ============================================================

/** Die Einheiten des Zyklus in Reihenfolge (aufgelöst zu Objekten). */
export function zyklusEinheiten(state, modul) {
  const plan = planFuer(state, modul);
  if (!plan) return [];
  return plan.zyklus.map(id => plan.einheiten.find(e => e.id === id)).filter(Boolean);
}

/** Einheit ans Ende des Zyklus hängen (darf schon drin sein). */
export function addZuZyklus(state, modul, einheitId) {
  const plan = mussPlan(state, modul);
  if (!plan.einheiten.some(e => e.id === einheitId)) throw new Error('Einheit nicht in der Bibliothek.');
  plan.zyklus.push(einheitId);
}

/** Zyklus-Stelle (nach Index) entfernen. Position bleibt konsistent. */
export function entferneAusZyklus(state, modul, index) {
  const plan = mussPlan(state, modul);
  if (index < 0 || index >= plan.zyklus.length) return;
  const zeigtAuf = plan.zyklus[plan.position];
  const warZeiger = index === plan.position;
  plan.zyklus.splice(index, 1);
  if (plan.zyklus.length === 0) { plan.position = 0; return; }
  if (warZeiger) plan.position %= plan.zyklus.length;         // Zeiger-Stelle gelöscht → nächste rückt nach
  else reparierePosition(plan, zeigtAuf);
}

/** Zyklus-Stelle verschieben (richtung: -1 hoch / +1 runter). Zeiger folgt der Stelle. */
export function verschiebeImZyklus(state, modul, index, richtung) {
  const plan = mussPlan(state, modul);
  const j = index + Math.sign(richtung);
  if (index < 0 || index >= plan.zyklus.length || j < 0 || j >= plan.zyklus.length) return;
  const zeigerWar = plan.position;
  [plan.zyklus[index], plan.zyklus[j]] = [plan.zyklus[j], plan.zyklus[index]];
  if (zeigerWar === index) plan.position = j;
  else if (zeigerWar === j) plan.position = index;
}

/** Zeiger direkt auf eine Zyklus-Stelle setzen („Heute korrigieren"). */
export function setzePosition(state, modul, index) {
  const plan = mussPlan(state, modul);
  if (plan.zyklus.length === 0) return;
  plan.position = ((index % plan.zyklus.length) + plan.zyklus.length) % plan.zyklus.length;
}

// ------------------------------------------------------------
// Zyklus: nächste Einheit, weiterschalten, Plan → Session
// ------------------------------------------------------------

/** Die als Nächstes anstehende Einheit — null ohne Plan/Zyklus. */
export function naechsteEinheit(state, modul) {
  const plan = planFuer(state, modul);
  if (!plan || plan.zyklus.length === 0) return null;
  const id = plan.zyklus[plan.position % plan.zyklus.length];
  return plan.einheiten.find(e => e.id === id) ?? null;
}

/** Zyklus eins vorschalten (nach absolvierter ODER übersprungener Einheit). */
export function schalteWeiter(state, modul) {
  const plan = mussPlan(state, modul);
  if (plan.zyklus.length === 0) return null;
  plan.position = (plan.position + 1) % plan.zyklus.length;
  return naechsteEinheit(state, modul);
}

/**
 * Brücke Plan → Log: frische Session mit vorbefüllten (leeren) Segmenten.
 * Hängt NICHT in state.sessions ein und schaltet NICHT weiter.
 */
export function sessionAusEinheit(state, modul, einheitId, { datum } = {}) {
  const e = mussEinheit(state, modul, einheitId);
  const session = neueSession({ datum, ausPlan: e.id });
  for (const vorlage of e.segmente) {
    session.segmente.push(neuesSegment(vorlage.aktivitaetId));
  }
  return session;
}

// ------------------------------------------------------------
// intern
// ------------------------------------------------------------
function mussPlan(state, modul) {
  const plan = planFuer(state, modul);
  if (!plan) throw new Error(`Kein Plan für Modul '${modul}'.`);
  return plan;
}
function mussEinheit(state, modul, einheitId) {
  const e = findeEinheit(state, modul, einheitId);
  if (!e) throw new Error('Einheit nicht gefunden.');
  return e;
}
/** Zeiger wieder auf „seine" Zyklus-Stelle setzen (nach Umbau). */
function reparierePosition(plan, zeigerId) {
  if (plan.zyklus.length === 0) { plan.position = 0; return; }
  const i = plan.zyklus.indexOf(zeigerId);
  plan.position = i === -1 ? plan.position % plan.zyklus.length : i;
}
