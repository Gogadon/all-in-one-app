// ============================================================
// plan.js — Plan/Zyklus, optionaler Überbau PRO MODUL
//
// state.plaene = {
//   kraft: { einheiten: [GeplanteEinheit …], position: 0 }
// }
//
// GeplanteEinheit = Vorlage:
//   { id, name, kategorie, segmente: [{ aktivitaetId }] }
//
// position zeigt auf die NÄCHSTE geplante Einheit im Zyklus.
// Nach einer absolvierten (oder übersprungenen) Einheit schaltet
// schalteWeiter() den Zyklus eins vor — am Ende wieder von vorn.
//
// Das Session-Modell merkt vom Plan nichts: eine Session ist eine
// Session; ausPlan verweist nur zur Info auf die Einheit.
// ============================================================

import { KATEGORIEN, neueId, neueSession, neuesSegment, findeAktivitaet } from './model.js';

// ------------------------------------------------------------
// Plan holen / anlegen
// ------------------------------------------------------------

/** Plan eines Moduls — null, wenn keiner existiert (spontan ist ja der Standard). */
export function planFuer(state, modul) {
  return state.plaene?.[modul] ?? null;
}

/** Plan holen oder frisch anlegen. */
export function erstellePlan(state, modul) {
  state.plaene ??= {};
  state.plaene[modul] ??= { einheiten: [], position: 0 };
  return state.plaene[modul];
}

/** Ganzen Plan eines Moduls entfernen (Sessions bleiben unberührt). */
export function entfernePlan(state, modul) {
  if (state.plaene) delete state.plaene[modul];
}

// ------------------------------------------------------------
// Einheiten verwalten
// ------------------------------------------------------------

/** Geplante Einheit ans Ende des Zyklus hängen. Gibt sie zurück. */
export function addEinheit(state, modul, { name, kategorie = modul }) {
  if (!name || !name.trim()) throw new Error('Einheit braucht einen Namen.');
  if (!KATEGORIEN.includes(kategorie)) throw new Error(`Unbekannte Kategorie: ${kategorie}`);
  const plan = erstellePlan(state, modul);
  const einheit = { id: neueId(), name: name.trim(), kategorie, segmente: [] };
  plan.einheiten.push(einheit);
  return einheit;
}

/** Einheit per ID finden (in einem Modul-Plan). */
export function findeEinheit(state, modul, einheitId) {
  return planFuer(state, modul)?.einheiten.find(e => e.id === einheitId) ?? null;
}

/** Einheit umbenennen. */
export function benenneEinheitUm(state, modul, einheitId, neuerName) {
  const e = mussEinheit(state, modul, einheitId);
  if (!neuerName || !neuerName.trim()) throw new Error('Name darf nicht leer sein.');
  e.name = neuerName.trim();
  return e;
}

/** Einheit aus dem Zyklus löschen; position bleibt konsistent. */
export function entferneEinheit(state, modul, einheitId) {
  const plan = mussPlan(state, modul);
  const i = plan.einheiten.findIndex(e => e.id === einheitId);
  if (i === -1) throw new Error('Einheit nicht gefunden.');
  plan.einheiten.splice(i, 1);
  if (plan.einheiten.length === 0) { plan.position = 0; return; }
  if (i < plan.position) plan.position -= 1;                 // vor dem Zeiger gelöscht → nachrücken
  plan.position %= plan.einheiten.length;                    // Zeiger nie ins Leere
}

/** Einheit im Zyklus verschieben (richtung: -1 = hoch, +1 = runter). */
export function verschiebeEinheit(state, modul, einheitId, richtung) {
  const plan = mussPlan(state, modul);
  const i = plan.einheiten.findIndex(e => e.id === einheitId);
  const j = i + Math.sign(richtung);
  if (i === -1 || j < 0 || j >= plan.einheiten.length) return;
  const zeigtAuf = plan.einheiten[plan.position];            // Zeiger folgt der Einheit,
  [plan.einheiten[i], plan.einheiten[j]] = [plan.einheiten[j], plan.einheiten[i]];
  plan.position = plan.einheiten.indexOf(zeigtAuf);          // nicht dem Index
}

// ------------------------------------------------------------
// Aktivitäten in einer Einheit (Vorlage-Segmente)
// ------------------------------------------------------------

/** Aktivität ans Ende der Einheit hängen. */
export function addAktivitaetZuEinheit(state, modul, einheitId, aktivitaetId) {
  const e = mussEinheit(state, modul, einheitId);
  if (!findeAktivitaet(state, aktivitaetId)) throw new Error('Aktivität nicht gefunden.');
  e.segmente.push({ aktivitaetId });
}

/** Aktivität aus der Einheit nehmen (erste Fundstelle). */
export function entferneAktivitaetAusEinheit(state, modul, einheitId, aktivitaetId) {
  const e = mussEinheit(state, modul, einheitId);
  const i = e.segmente.findIndex(s => s.aktivitaetId === aktivitaetId);
  if (i === -1) throw new Error('Aktivität ist nicht in dieser Einheit.');
  e.segmente.splice(i, 1);
}

/** Reihenfolge innerhalb der Einheit ändern (▲▼, richtung: -1/+1). */
export function verschiebeAktivitaetInEinheit(state, modul, einheitId, index, richtung) {
  const e = mussEinheit(state, modul, einheitId);
  const j = index + Math.sign(richtung);
  if (index < 0 || index >= e.segmente.length || j < 0 || j >= e.segmente.length) return;
  [e.segmente[index], e.segmente[j]] = [e.segmente[j], e.segmente[index]];
}

// ------------------------------------------------------------
// Zyklus: nächste Einheit, weiterschalten, Plan → Session
// ------------------------------------------------------------

/** Die als Nächstes anstehende Einheit (fürs Cockpit) — null ohne Plan/Einheiten. */
export function naechsteEinheit(state, modul) {
  const plan = planFuer(state, modul);
  if (!plan || plan.einheiten.length === 0) return null;
  return plan.einheiten[plan.position % plan.einheiten.length];
}

/** Zyklus eins vorschalten (nach absolvierter ODER übersprungener Einheit). */
export function schalteWeiter(state, modul) {
  const plan = mussPlan(state, modul);
  if (plan.einheiten.length === 0) return null;
  plan.position = (plan.position + 1) % plan.einheiten.length;
  return naechsteEinheit(state, modul);
}

/**
 * Die Brücke Plan → Log: erzeugt aus einer geplanten Einheit eine
 * frische Session mit vorbefüllten (leeren) Segmenten.
 * NICHT automatisch in state.sessions eingehängt und schaltet NICHT
 * weiter — das entscheidet das Modul (z.B. erst beim Abschließen).
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
