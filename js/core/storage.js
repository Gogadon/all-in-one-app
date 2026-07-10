// ============================================================
// storage.js — die EINZIGE Stelle, die persistiert.
// Der Rest der App ruft nur load() / save().
//
// Schnittstelle ist ASYNC, obwohl dahinter (noch) nur
// localStorage steckt → späterer Umzug auf Server/Accounts
// ist ein Austausch DIESER Datei, kein Umbau der App.
// ============================================================

export const STORAGE_KEY = 'gogadon_allinone_v1';
export const SCHEMA_VERSION = 1;
const APP_NAME = 'gogadon-allinone';

// ------------------------------------------------------------
// Zustand
// ------------------------------------------------------------

/** Leerer Grundzustand — die eine Wahrheit über die State-Form. */
export function leererZustand() {
  return {
    schema: SCHEMA_VERSION,
    bibliothek: [],      // Aktivitäten (siehe model.js → neueAktivitaet)
    sessions: [],        // Log (Session → Segment → Eintrag)
    plaene: {},          // pro Modul, z.B. plaene.kraft = { einheiten: [], position: 0 }  (Schritt 2)
    challenges: [],      // Auswertungsschicht (Etappe 4)
    einstellungen: {},   // App-weite Einstellungen
  };
}

// ------------------------------------------------------------
// Laden / Speichern
// ------------------------------------------------------------

/**
 * Zustand laden. Nichts gespeichert oder kaputt → leerer Zustand.
 * Bei kaputten Daten wird VOR dem Überschreiben eine Rettungskopie
 * unter `${STORAGE_KEY}_defekt` abgelegt.
 */
export async function load() {
  let roh = null;
  try {
    roh = localStorage.getItem(STORAGE_KEY);
  } catch {
    return leererZustand(); // z.B. Storage blockiert
  }
  if (roh == null) return leererZustand();

  try {
    const state = JSON.parse(roh);
    pruefeGrundform(state);
    return migriere(state);
  } catch (err) {
    console.error('Gespeicherter Zustand unlesbar — starte leer.', err);
    // Rettungskopie der kaputten Rohdaten sichern. Scheitert das (Speicher voll,
    // blockiert), muss man es wissen — sonst sind die Daten wirklich weg.
    try {
      localStorage.setItem(STORAGE_KEY + '_defekt', roh);
      console.warn('Rettungskopie der defekten Daten liegt unter', STORAGE_KEY + '_defekt');
    } catch (kopieErr) {
      console.warn('Rettungskopie konnte NICHT angelegt werden:', kopieErr.message);
    }
    return leererZustand();
  }
}

/** Zustand speichern. Wirft bei vollem/blockiertem Speicher einen klaren Fehler. */
export async function save(state) {
  pruefeGrundform(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    throw new Error('Speichern fehlgeschlagen (Speicher voll oder blockiert): ' + err.message);
  }
}

// ------------------------------------------------------------
// Backup (Export / Import als JSON-Datei)
// ------------------------------------------------------------

/** Zustand → Backup-JSON-String (mit Metadaten, hübsch formatiert). */
export function exportBackup(state) {
  pruefeGrundform(state);
  return JSON.stringify({
    app: APP_NAME,
    schema: state.schema ?? SCHEMA_VERSION,
    exportiertAm: new Date().toISOString(),
    daten: state,
  }, null, 2);
}

/**
 * Backup-JSON-String → Zustand (validiert + migriert).
 * Akzeptiert auch "nackte" Zustände ohne Backup-Hülle (robust).
 * Wirft mit verständlicher Meldung, wenn die Datei nichts taugt.
 */
export function importBackup(jsonString) {
  let obj;
  try {
    obj = JSON.parse(jsonString);
  } catch {
    throw new Error('Das ist keine gültige JSON-Datei.');
  }
  const state = (obj && typeof obj === 'object' && 'daten' in obj) ? obj.daten : obj;
  try {
    pruefeGrundform(state);
  } catch {
    throw new Error('Diese Datei sieht nicht wie ein Backup dieser App aus.');
  }
  return migriere(state);
}

// ------------------------------------------------------------
// Migration & Validierung
// ------------------------------------------------------------

/**
 * Schema-Migration: hebt ältere Zustände Stufe für Stufe aufs aktuelle Schema.
 * (Noch leer — Schema 1 ist das erste. Die Leiter steht für später bereit.)
 */
export function migriere(state) {
  let schema = state.schema ?? 1;
  while (schema < SCHEMA_VERSION) {
    switch (schema) {
      // case 1: state = migriereV1zuV2(state); schema = 2; break;
      default:
        throw new Error(`Keine Migration von Schema ${schema} bekannt.`);
    }
  }
  if (schema > SCHEMA_VERSION) {
    throw new Error(`Backup stammt aus einer neueren App-Version (Schema ${schema}).`);
  }
  state.schema = SCHEMA_VERSION;
  // Fehlende Top-Level-Felder ergänzen (macht Backups aus frühen Ständen robust):
  const leer = leererZustand();
  for (const key of Object.keys(leer)) {
    if (!(key in state)) state[key] = leer[key];
  }
  return state;
}

/** Minimale Formprüfung — wirft, wenn das kein Zustand dieser App sein kann. */
function pruefeGrundform(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Zustand ist kein Objekt.');
  }
  if (!Array.isArray(state.bibliothek) || !Array.isArray(state.sessions)) {
    throw new Error('Zustand hat nicht die erwartete Form (bibliothek/sessions fehlen).');
  }
}
