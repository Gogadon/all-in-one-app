// ============================================================
// Tests fürs Fundament (Schritt 1): metrics + model + storage
// Laufen mit:  node --test tests/     (oder: npm test)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSWERTE, aggregiere, formatWert, formatDauer, parseDauer, parseZahl,
  berechneGeschwindigkeit,
} from '../js/core/metrics.js';
import {
  neueAktivitaet, neueSession, neuesSegment, neuerEintrag,
  addSegment, addEintrag, segmentWert, sessionWert,
  segmentVolumen, sessionVolumen, loeseSegmentAuf, sessionKategorien,
  sessionsMitAktivitaet,
} from '../js/core/model.js';
import {
  load, save, exportBackup, importBackup, leererZustand, migriere, STORAGE_KEY,
} from '../js/core/storage.js';

// --- localStorage-Attrappe für Node ------------------------------
const speicher = new Map();
globalThis.localStorage = {
  getItem: k => (speicher.has(k) ? speicher.get(k) : null),
  setItem: (k, v) => speicher.set(k, String(v)),
  removeItem: k => speicher.delete(k),
};

// --- Testdaten: eine kleine Bibliothek ----------------------------
function baueState() {
  const state = leererZustand();
  const bank = neueAktivitaet({ name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  // Alternative ist jetzt eine echte Übung (V2), hier mit fester ID für den Test.
  const khAlt = neueAktivitaet({ name: 'KH-Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  khAlt.id = 'alt-1';
  bank.alternativen.push('alt-1');
  const laufband = neueAktivitaet({ name: 'Laufband', kategorie: 'sonstiges', messwerte: ['dauer', 'puls_avg', 'puls_max'] });
  const ebike = neueAktivitaet({ name: 'E-Bike Tour', kategorie: 'rad', messwerte: ['distanz', 'hoehenmeter', 'dauer', 'puls_avg', 'puls_max'] });
  const kraulen = neueAktivitaet({ name: 'Kraulen', kategorie: 'schwimmen', messwerte: ['distanz', 'dauer'] });
  const plank = neueAktivitaet({ name: 'Plank', kategorie: 'kraft', messwerte: ['dauer'] });
  state.bibliothek.push(bank, khAlt, laufband, ebike, kraulen, plank);
  return { state, bank, laufband, ebike, kraulen, plank };
}

// ==================================================================
test('Kraft: Segment mit mehreren Einträgen (Sätzen) — Volumen & Summen', () => {
  const { state, bank } = baueState();
  const s = neueSession({ datum: '2026-07-05' });
  const seg = addSegment(s, neuesSegment(bank.id));
  addEintrag(seg, neuerEintrag({ gewicht: 40, wdh: 12 }, { flags: ['aufwaermsatz'] }));
  addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 8 }));
  addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 7 }));
  addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 6 }));
  state.sessions.push(s);

  // Volumen zählt Aufwärmsatz NICHT: 80×8 + 80×7 + 80×6 = 1680
  assert.equal(segmentVolumen(seg), 1680);
  assert.equal(sessionVolumen(s), 1680);
  // Wdh-Summe ohne Aufwärmsatz: 21
  assert.equal(segmentWert(seg, 'wdh', { ohneFlag: 'aufwaermsatz' }), 21);
  // … mit Aufwärmsatz: 33
  assert.equal(segmentWert(seg, 'wdh'), 33);
});

test('Cardio: Segment mit genau EINEM Eintrag — gleiche Funktionen, gleiche Ergebnisse', () => {
  const { state, ebike } = baueState();
  const s = neueSession({ datum: '2026-07-04' });
  const seg = addSegment(s, neuesSegment(ebike.id));
  addEintrag(seg, neuerEintrag({ distanz: 24300, hoehenmeter: 312, dauer: 5400, puls_avg: 118, puls_max: 156 }));
  state.sessions.push(s);

  assert.equal(segmentWert(seg, 'distanz'), 24300);
  assert.equal(segmentWert(seg, 'puls_avg'), 118);
  assert.equal(formatWert('distanz', segmentWert(seg, 'distanz'), { kategorie: 'rad' }), '24,3 km');
  assert.equal(formatWert('dauer', 5400), '1:30 h');
  assert.equal(Math.round(berechneGeschwindigkeit(24300, 5400) * 10) / 10, 16.2);
});

test('Ein-Pfad-Check (Vorstufe zum Akzeptanztest): Kontext A und B laufen durch DENSELBEN Code', () => {
  const { state, bank, laufband, ebike } = baueState();

  // Kontext A: reine Cardio-Session (Radtag)
  const a = neueSession({ datum: '2026-07-01' });
  addEintrag(addSegment(a, neuesSegment(ebike.id)),
    neuerEintrag({ distanz: 12000, dauer: 2400, puls_avg: 132, puls_max: 158 }));

  // Kontext B: Cardio-Segment INNERHALB eines Kraft-Tags (Laufband-Warmup)
  const b = neueSession({ datum: '2026-07-02' });
  addEintrag(addSegment(b, neuesSegment(laufband.id)),
    neuerEintrag({ dauer: 600, puls_avg: 110, puls_max: 128 }));
  const kraftSeg = addSegment(b, neuesSegment(bank.id));
  addEintrag(kraftSeg, neuerEintrag({ gewicht: 80, wdh: 8 }));

  state.sessions.push(a, b);

  // Für JEDEN Messwert-Typ aus der Registry funktioniert dieselbe Abfrage
  // in beiden Kontexten — ohne Cardio-Sonderpfad:
  for (const typ of Object.keys(MESSWERTE)) {
    assert.doesNotThrow(() => sessionWert(a, typ));
    assert.doesNotThrow(() => sessionWert(b, typ));
  }
  assert.equal(sessionWert(a, 'puls_avg'), 132);
  assert.equal(sessionWert(b, 'puls_avg'), 110); // nur das Laufband hat Puls — Kraft-Sätze stören nicht
  assert.equal(sessionWert(b, 'dauer'), 600);

  // Beide Sessions haben dasselbe Notiz-Feld (die alte Drift kann nicht entstehen):
  assert.ok('notiz' in a && 'notiz' in b);
});

test('Sonderfälle: Plank ({dauer} statt {gewicht, wdh}) und Schwimmen (Anzeige in m)', () => {
  const { state, plank, kraulen } = baueState();
  const s = neueSession();
  addEintrag(addSegment(s, neuesSegment(plank.id)), neuerEintrag({ dauer: 75 }));
  const schwimmSeg = addSegment(s, neuesSegment(kraulen.id));
  addEintrag(schwimmSeg, neuerEintrag({ distanz: 800, dauer: 1500 }));
  state.sessions.push(s);

  assert.equal(formatWert('dauer', 75), '1:15 min');
  assert.equal(formatWert('distanz', 800, { kategorie: 'schwimmen' }), '800 m');
  assert.equal(sessionVolumen(s), 0); // kein gewicht×wdh → kein Volumen, kein Fehler
});

test('Alternativen: altOf löst Name auf, Typ bleibt bei der Hauptaktivität', () => {
  const { state, bank } = baueState();
  const s = neueSession();
  const seg = addSegment(s, neuesSegment(bank.id, { altOf: 'alt-1' }));
  const { aktivitaet, alternative, anzeigeName } = loeseSegmentAuf(state, seg);
  assert.equal(anzeigeName, 'KH-Bankdrücken');
  assert.equal(aktivitaet.kategorie, 'kraft');
  assert.ok(alternative);
});

test('Abfragen: sessionsMitAktivitaet (neueste zuerst) und sessionKategorien', () => {
  const { state, bank, ebike } = baueState();
  for (const datum of ['2026-06-20', '2026-07-01', '2026-06-25']) {
    const s = neueSession({ datum });
    addEintrag(addSegment(s, neuesSegment(bank.id)), neuerEintrag({ gewicht: 60, wdh: 10 }));
    state.sessions.push(s);
  }
  const mix = neueSession({ datum: '2026-07-03' });
  addSegment(mix, neuesSegment(bank.id));
  addSegment(mix, neuesSegment(ebike.id));
  state.sessions.push(mix);

  const treffer = sessionsMitAktivitaet(state, bank.id, { limit: 2 });
  assert.deepEqual(treffer.map(s => s.datum), ['2026-07-03', '2026-07-01']);
  assert.deepEqual(sessionKategorien(state, mix).sort(), ['kraft', 'rad']);
});

test('Storage: save → load Runde, leerer Start, kaputte Daten → Rettungskopie', async () => {
  speicher.clear();
  // leerer Start
  const frisch = await load();
  assert.equal(frisch.sessions.length, 0);

  // Runde
  const { state, bank } = baueState();
  const s = neueSession({ datum: '2026-07-05', notiz: 'guter Tag' });
  addEintrag(addSegment(s, neuesSegment(bank.id)), neuerEintrag({ gewicht: 80, wdh: 8 }));
  state.sessions.push(s);
  await save(state);
  const geladen = await load();
  assert.equal(geladen.sessions[0].notiz, 'guter Tag');
  assert.equal(sessionVolumen(geladen.sessions[0]), 640);

  // kaputte Daten
  localStorage.setItem(STORAGE_KEY, '{kaputt');
  const notfall = await load();
  assert.equal(notfall.sessions.length, 0);
  assert.equal(localStorage.getItem(STORAGE_KEY + '_defekt'), '{kaputt');
});

test('Backup: Export → Import Runde; Müll wird sauber abgelehnt', () => {
  const { state, ebike } = baueState();
  const s = neueSession({ datum: '2026-07-04' });
  addEintrag(addSegment(s, neuesSegment(ebike.id)),
    neuerEintrag({ distanz: 24300, dauer: 5400 }));
  state.sessions.push(s);

  const json = exportBackup(state);
  const zurueck = importBackup(json);
  assert.equal(zurueck.sessions[0].segmente[0].eintraege[0].messwerte.distanz, 24300);
  assert.equal(zurueck.schema, 2);

  // auch "nackter" Zustand ohne Backup-Hülle wird akzeptiert
  const nackt = importBackup(JSON.stringify(state));
  assert.equal(nackt.sessions.length, 1);

  assert.throws(() => importBackup('kein json'), /keine gültige JSON/);
  assert.throws(() => importBackup('{"foo": 1}'), /nicht wie ein Backup/);
});

test('Parsen & Formatieren: deutsches Komma, Dauer-Eingabe', () => {
  assert.equal(parseZahl('82,5'), 82.5);
  assert.equal(parseZahl('82.5'), 82.5);
  assert.equal(parseZahl(''), null);
  assert.equal(parseDauer('1:52'), 6720);   // H:MM
  assert.equal(parseDauer('45'), 2700);     // nackte Zahl = Minuten
  assert.equal(formatDauer(6720), '1:52 h');
  assert.equal(formatDauer(2300), '38:20 min');
  assert.equal(formatWert('gewicht', 82.5), '82,5 kg');
});

test('Fabriken wehren Unsinn ab', () => {
  assert.throws(() => neueAktivitaet({ name: 'X', kategorie: 'yoga' }), /Kategorie/);
  assert.throws(() => neueAktivitaet({ name: 'X', kategorie: 'kraft', messwerte: ['bizepsumfang'] }), /Unbekannte Messwerte/);
  assert.throws(() => neuerEintrag({ quatsch: 1 }), /Unbekannte Messwerte/);
  assert.throws(() => aggregiere('quatsch', [1]), /Unbekannter Messwert-Typ/);
});

test('Migration V1→V2: Alternativen werden echte Übungen (zusammengeführt)', async () => {
  const { migriereV1zuV2 } = await import('../js/core/storage.js');
  const state = {
    schema: 1,
    bibliothek: [
      { id: 'bank', name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'],
        alternativen: [
          { id: 'e1', name: 'Chest Press', einstellungen: {} },
          { id: 'e2', name: 'Face Pulls', einstellungen: {} },
        ] },
      { id: 'nacken', name: 'Nackenheben', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'],
        alternativen: [
          { id: 'e3', name: 'Face Pulls', einstellungen: {} },   // gleichnamig → zusammenführen
        ] },
      { id: 'lauf', name: 'Laufband', kategorie: 'kraft', messwerte: ['dauer'], cardio: true,
        alternativen: [
          { id: 'e4', name: 'Fahrrad', einstellungen: {} },      // existiert als Hauptübung
        ] },
      { id: 'rad', name: 'Fahrrad', kategorie: 'kraft', messwerte: ['dauer'], cardio: true,
        alternativen: [] },
    ],
    sessions: [
      { id: 's1', datum: '2026-07-01', modul: 'kraft',
        segmente: [{ id: 'seg1', aktivitaetId: 'bank', altOf: 'e2', eintraege: [] }] },  // nutzte "Face Pulls"
    ],
  };
  migriereV1zuV2(state);
  const bib = state.bibliothek;
  const ids = new Set(bib.map(a => a.id));

  // Alle Alternativen sind IDs, alle gültig
  for (const a of bib) for (const ref of a.alternativen) {
    assert.equal(typeof ref, 'string');
    assert.ok(ids.has(ref), `Verweis ${ref} muss existieren`);
  }
  // Face Pulls nur einmal, bei beiden verlinkt
  const fp = bib.filter(a => a.name === 'Face Pulls');
  assert.equal(fp.length, 1);
  const fpVerlinkt = bib.filter(a => a.alternativen.includes(fp[0].id));
  assert.equal(fpVerlinkt.length, 2);
  // Fahrrad bleibt einmalig (Alternative → echte Hauptübung)
  assert.equal(bib.filter(a => a.name === 'Fahrrad').length, 1);
  const lauf = bib.find(a => a.name === 'Laufband');
  assert.ok(lauf.alternativen.includes('rad'), 'Laufband-Alternative zeigt auf echte Fahrrad-id');
  // Historie: seg.altOf wurde auf die neue Face-Pulls-id umgezogen
  assert.equal(state.sessions[0].segmente[0].altOf, fp[0].id);
});

test('Grundzustand & Migration: termine-Liste vorhanden bzw. nachgetragen', () => {
  // Frischer Zustand hat die Liste
  assert.deepEqual(leererZustand().termine, []);
  // Alter Stand ohne termine bekommt sie beim Migrieren ergänzt
  const alt = { schema: 2, bibliothek: [], sessions: [] };
  const migriert = migriere(alt);
  assert.ok(Array.isArray(migriert.termine));
  assert.equal(migriert.termine.length, 0);
});
