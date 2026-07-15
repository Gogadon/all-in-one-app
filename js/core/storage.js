// ============================================================
// storage.js — die EINZIGE Stelle, die persistiert.
// Der Rest der App ruft nur load() / save().
//
// Schnittstelle ist ASYNC, obwohl dahinter (noch) nur
// localStorage steckt → späterer Umzug auf Server/Accounts
// ist ein Austausch DIESER Datei, kein Umbau der App.
// ============================================================

// ACHTUNG: STORAGE_KEY NIEMALS ändern! Unter diesem Schlüssel liegen die
// Daten im localStorage des Geräts. Eine Umbenennung macht alle gespeicherten
// Trainings unauffindbar. Der historische Name bleibt, auch wenn die App
// inzwischen anders heißt.
export const STORAGE_KEY = 'gogadon_allinone_v1';
export const SCHEMA_VERSION = 2;
const APP_NAME = 'all-in-one';

// ------------------------------------------------------------
// Zustand
// ------------------------------------------------------------

/** Leerer Grundzustand — die eine Wahrheit über die State-Form. */
export function leererZustand() {
  return {
    schema: SCHEMA_VERSION,
    bibliothek: [],      // Aktivitäten (siehe model.js → neueAktivitaet)
    sessions: [],        // Log (Session → Segment → Eintrag)
    termine: [],         // geplante Termine (Werkzeug B) — eigene Liste, getrennt von sessions
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
  // Kaputte Einzel-Sessions (z.B. aus einem von Hand bearbeiteten Backup) still
  // rauswerfen, BEVOR migriert wird — so kann ein defekter Datensatz weder die
  // Migration noch später das UI zum Absturz bringen, ohne das ganze Backup
  // unbrauchbar zu machen.
  normalisiereSessions(state);
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
      case 1: state = migriereV1zuV2(state); schema = 2; break;
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

/** Ist das ein reines Objekt (kein null, kein Array)? Kleiner Helfer. */
function istObjekt(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Kann die App diese Session gefahrlos rendern und aggregieren?
 * Prüft nur die Struktur, die der restliche Code voraussetzt:
 *   datum = nicht-leerer String (Datums-Helfer/Sortierung vergleichen Strings),
 *   segmente = Array, jedes Segment ein Objekt mit eintraege-Array,
 *   jeder Eintrag ein Objekt, dessen messwerte (falls vorhanden) ein Objekt ist.
 * Bewusst nicht strenger — es geht ums Verhindern von Abstürzen, nicht ums
 * Aussortieren inhaltlich fragwürdiger, aber strukturell heiler Daten.
 */
function istGueltigeSession(s) {
  if (!istObjekt(s)) return false;
  if (typeof s.datum !== 'string' || s.datum === '') return false;
  if (!Array.isArray(s.segmente)) return false;
  for (const seg of s.segmente) {
    if (!istObjekt(seg) || !Array.isArray(seg.eintraege)) return false;
    for (const e of seg.eintraege) {
      if (!istObjekt(e)) return false;
      if (e.messwerte != null && !istObjekt(e.messwerte)) return false;
    }
  }
  return true;
}

/**
 * Wirft strukturell kaputte Sessions still raus (z.B. aus einem von Hand
 * bearbeiteten Backup) und behält nur, was die App gefahrlos verarbeiten kann.
 * Meldet die Anzahl entfernter Sessions in der Konsole. Mutiert state.sessions.
 */
export function normalisiereSessions(state) {
  if (!Array.isArray(state?.sessions)) return state;
  const vorher = state.sessions.length;
  state.sessions = state.sessions.filter(istGueltigeSession);
  const entfernt = vorher - state.sessions.length;
  if (entfernt > 0) {
    console.warn(`Import: ${entfernt} kaputte Session(s) übersprungen.`);
  }
  return state;
}

// ============================================================
// Migration Schema 1 → 2: Alternativen werden echte Übungen
//
// VORHER (V1): Eine Übung trug eingebettete Alternativen als Objekte:
//   alternativen: [ { id, name, einstellungen } ]
// Sessions verwiesen via segment.altOf auf diese eingebettete id.
//
// NACHHER (V2): Alternativen sind echte Bibliotheks-Übungen. Die Übung
// trägt nur noch VERWEISE (IDs):
//   alternativen: [ uebungsId, uebungsId, … ]
//
// Regeln (mit Manuel abgestimmt):
//  - Gleichnamige Alternativen werden zu EINER Übung zusammengeführt
//    (z.B. „Face Pulls" 3× → eine Übung, dreifach verlinkt).
//  - Ist eine Alternative namensgleich mit einer bestehenden HAUPT-Übung,
//    wird auf diese echte Übung verwiesen (kein Duplikat).
//  - segment.altOf wird auf die neue (echte) Übungs-ID umgezogen, damit die
//    bisherige Historie erhalten bleibt.
// ============================================================
export function migriereV1zuV2(state) {
  const norm = (n) => String(n ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  const neueId = () => 'm2_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const bib = state.bibliothek ?? [];
  // Index bestehender Hauptübungen nach normalisiertem Namen.
  const hauptNachName = new Map();
  for (const a of bib) hauptNachName.set(norm(a.name), a.id);

  // Zwei Mappings:
  //  altIdZuNeu:   alte eingebettete Alternativ-id → neue echte Übungs-id
  //                (für die Umschreibung von segment.altOf)
  //  nameZuNeu:    normalisierter Name → neue echte Übungs-id
  //                (für die Zusammenführung gleichnamiger)
  const altIdZuNeu = new Map();
  const nameZuNeu = new Map();
  const neueUebungen = [];

  for (const uebung of bib) {
    const alts = uebung.alternativen;
    if (!Array.isArray(alts) || alts.length === 0) { uebung.alternativen = []; continue; }
    const verweise = [];
    for (const alt of alts) {
      // Schon im V2-Format (String-id)? Dann unverändert übernehmen.
      if (typeof alt === 'string') { verweise.push(alt); continue; }
      if (!alt || !alt.name) continue;
      const key = norm(alt.name);

      // 1) Verweist der Name auf eine bestehende Hauptübung? → deren id nutzen.
      let zielId = hauptNachName.get(key);

      // 2) Sonst: schon eine zusammengeführte neue Übung mit dem Namen? → wiederverwenden.
      if (!zielId) zielId = nameZuNeu.get(key);

      // 3) Sonst: neue echte Übung anlegen.
      if (!zielId) {
        zielId = neueId();
        const neu = {
          id: zielId,
          name: alt.name,
          kategorie: uebung.kategorie ?? 'kraft',
          messwerte: [...(uebung.messwerte ?? [])],
          einstellungen: { ...(alt.einstellungen ?? {}) },
          alternativen: [],
        };
        if (uebung.cardio) neu.cardio = true;
        neueUebungen.push(neu);
        nameZuNeu.set(key, zielId);
      }

      // altOf-Umschreibung: die alte eingebettete id zeigt künftig auf zielId.
      if (alt.id) altIdZuNeu.set(alt.id, zielId);
      if (!verweise.includes(zielId)) verweise.push(zielId);
    }
    uebung.alternativen = verweise;
  }

  // Neue Übungen in die Bibliothek aufnehmen.
  state.bibliothek = [...bib, ...neueUebungen];

  // Bestehende Sessions: segment.altOf auf die neuen ids umziehen.
  for (const s of state.sessions ?? []) {
    for (const seg of s.segmente ?? []) {
      if (seg.altOf && altIdZuNeu.has(seg.altOf)) {
        seg.altOf = altIdZuNeu.get(seg.altOf);
      }
    }
  }

  return state;
}
