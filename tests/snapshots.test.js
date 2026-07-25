// tests/snapshots.test.js — automatische Tages-Snapshots + Export-Erinnerung
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- localStorage-Attrappe (muss VOR dem Import von storage.js stehen) ---
const speicher = new Map();
let speicherVoll = false;
globalThis.localStorage = {
  getItem: k => (speicher.has(k) ? speicher.get(k) : null),
  setItem: (k, v) => {
    if (speicherVoll) throw new Error('QuotaExceededError');
    speicher.set(k, String(v));
  },
  removeItem: k => speicher.delete(k),
};

const {
  leererZustand, snapshots, sichereSnapshot, ladeSnapshot, loescheSnapshots,
  merkeExport, tageSeitExport, brauchtExportErinnerung, verschiebeErinnerung,
  SNAPSHOT_KEY, MAX_SNAPSHOTS,
} = await import('../js/core/storage.js');
const { neueSession } = await import('../js/core/model.js');

function frisch() {
  speicher.clear();
  speicherVoll = false;
}

/** Zustand mit n Sessions. */
function stateMit(n) {
  const s = leererZustand();
  for (let i = 0; i < n; i++) {
    const sess = neueSession({ datum: '2026-07-0' + (i + 1) });
    sess.modul = 'rad';
    s.sessions.push(sess);
  }
  return s;
}

// ============================================================
// Anlegen: höchstens einer pro Tag
// ============================================================

test('Snapshot: erster wird angelegt, zweiter am selben Tag nicht', () => {
  frisch();
  assert.equal(sichereSnapshot(stateMit(2), '2026-07-10'), true);
  assert.equal(snapshots().length, 1);
  // gleicher Tag → kein zweiter
  assert.equal(sichereSnapshot(stateMit(5), '2026-07-10'), false);
  assert.equal(snapshots().length, 1);
  assert.equal(snapshots()[0].sessions, 2);   // der erste bleibt erhalten
});

test('Snapshot: neuer Tag legt einen weiteren an, neueste zuerst', () => {
  frisch();
  sichereSnapshot(stateMit(1), '2026-07-10');
  sichereSnapshot(stateMit(3), '2026-07-11');
  const liste = snapshots();
  assert.equal(liste.length, 2);
  assert.equal(liste[0].datum, '2026-07-11');   // neuester vorn
  assert.equal(liste[1].datum, '2026-07-10');
});

test('Snapshot: nur die letzten MAX_SNAPSHOTS bleiben', () => {
  frisch();
  for (const [tag, n] of [['2026-07-10', 1], ['2026-07-11', 2], ['2026-07-12', 3], ['2026-07-13', 4]]) {
    sichereSnapshot(stateMit(n), tag);
  }
  const liste = snapshots();
  assert.equal(liste.length, MAX_SNAPSHOTS);
  assert.equal(liste[0].datum, '2026-07-13');
  // der älteste (10.) ist rausgefallen
  assert.ok(!liste.some(s => s.datum === '2026-07-10'));
});

test('Snapshot: merkt sich Umfang (Sessions/Übungen) für die Anzeige', () => {
  frisch();
  const s = stateMit(4);
  s.bibliothek.push({ id: 'a1', name: 'Bank', kategorie: 'kraft', messwerte: [], einstellungen: {}, alternativen: [] });
  sichereSnapshot(s, '2026-07-10');
  assert.equal(snapshots()[0].sessions, 4);
  assert.equal(snapshots()[0].uebungen, 1);
});

// ============================================================
// Zurückholen
// ============================================================

test('Snapshot: zurückholen liefert den Zustand von damals', () => {
  frisch();
  sichereSnapshot(stateMit(2), '2026-07-10');
  const marke = snapshots()[0].erstelltAm;

  const zurueck = ladeSnapshot(marke);
  assert.equal(zurueck.sessions.length, 2);
  assert.equal(zurueck.schema, 2);

  // Der gespeicherte Snapshot bleibt unberührt (echte Kopie)
  zurueck.sessions.push(neueSession({ datum: '2026-07-20' }));
  assert.equal(ladeSnapshot(marke).sessions.length, 2);
});

test('Snapshot: unbekannter Zeitstempel wirft verständlich', () => {
  frisch();
  sichereSnapshot(stateMit(1), '2026-07-10');
  assert.throws(() => ladeSnapshot('gibts-nicht'), /existiert nicht mehr/);
});

test('Snapshot: kaputte Session im Snapshot wird beim Zurückholen aussortiert', () => {
  frisch();
  const s = stateMit(1);
  s.sessions.push({ datum: 123, segmente: 'kaputt' });   // strukturell kaputt
  sichereSnapshot(s, '2026-07-10');
  const stillWarn = console.warn; console.warn = () => {};
  try {
    const zurueck = ladeSnapshot(snapshots()[0].erstelltAm);
    assert.equal(zurueck.sessions.length, 1);   // nur die heile bleibt
  } finally { console.warn = stillWarn; }
});

test('Snapshot: löschen entfernt alle', () => {
  frisch();
  sichereSnapshot(stateMit(1), '2026-07-10');
  loescheSnapshots();
  assert.deepEqual(snapshots(), []);
});

// ============================================================
// Robustheit: nichts davon darf die App stören
// ============================================================

test('Snapshot: unlesbare Liste ergibt [] statt Absturz', () => {
  frisch();
  speicher.set(SNAPSHOT_KEY, '{kein json');
  assert.deepEqual(snapshots(), []);
  // und ein neuer Snapshot lässt sich trotzdem anlegen
  assert.equal(sichereSnapshot(stateMit(1), '2026-07-10'), true);
  assert.equal(snapshots().length, 1);
});

test('Snapshot: voller Speicher wirft nicht, meldet nur false', () => {
  frisch();
  speicherVoll = true;
  const stillWarn = console.warn; console.warn = () => {};
  try {
    assert.equal(sichereSnapshot(stateMit(1), '2026-07-10'), false);
  } finally { console.warn = stillWarn; }
});

// ============================================================
// Export-Erinnerung
// ============================================================

test('Export-Erinnerung: ohne Daten keine Erinnerung', () => {
  frisch();
  assert.equal(brauchtExportErinnerung(leererZustand(), '2026-07-10'), false);
});

test('Export-Erinnerung: nie exportiert + Daten vorhanden → erinnern', () => {
  frisch();
  const s = stateMit(1);
  assert.equal(tageSeitExport(s, '2026-07-10'), null);
  assert.equal(brauchtExportErinnerung(s, '2026-07-10'), true);
});

test('Export-Erinnerung: frisch exportiert → Ruhe, nach 30 Tagen wieder', () => {
  frisch();
  const s = stateMit(1);
  merkeExport(s, '2026-07-10');
  assert.equal(tageSeitExport(s, '2026-07-10'), 0);
  assert.equal(brauchtExportErinnerung(s, '2026-07-10'), false);

  assert.equal(tageSeitExport(s, '2026-07-25'), 15);
  assert.equal(brauchtExportErinnerung(s, '2026-07-25'), false);

  assert.equal(tageSeitExport(s, '2026-08-09'), 30);
  assert.equal(brauchtExportErinnerung(s, '2026-08-09'), true);
});

test('Export-Erinnerung: „Später" legt sie 7 Tage still und holt sie zurück', () => {
  frisch();
  const s = stateMit(1);
  assert.equal(brauchtExportErinnerung(s, '2026-07-10'), true);

  verschiebeErinnerung(s, '2026-07-10');
  assert.equal(brauchtExportErinnerung(s, '2026-07-10'), false);   // sofort still
  assert.equal(brauchtExportErinnerung(s, '2026-07-16'), false);   // Tag 6: noch still
  assert.equal(brauchtExportErinnerung(s, '2026-07-17'), true);    // Tag 7: wieder da
});

test('Export-Erinnerung: Pause überlebt einen Monatswechsel', () => {
  frisch();
  const s = stateMit(1);
  verschiebeErinnerung(s, '2026-07-28');
  assert.equal(s.einstellungen.erinnerungPause, '2026-08-04');
  assert.equal(brauchtExportErinnerung(s, '2026-08-03'), false);
  assert.equal(brauchtExportErinnerung(s, '2026-08-04'), true);
});

test('Export-Erinnerung: ein Export hebt eine laufende Pause auf', () => {
  frisch();
  const s = stateMit(1);
  verschiebeErinnerung(s, '2026-07-10');
  merkeExport(s, '2026-07-11');
  assert.equal(s.einstellungen.erinnerungPause, undefined);
  assert.equal(brauchtExportErinnerung(s, '2026-07-11'), false);   // frisch exportiert
});
