// ============================================================
// Tests für Schritt 2: library.js + plan.js
// Laufen mit:  node --test tests/*.test.js   (oder: npm test)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leererZustand, exportBackup, importBackup } from '../js/core/storage.js';
import {
  neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag,
  loeseSegmentAuf,
} from '../js/core/model.js';
import {
  addAktivitaet, benenneUm, setzeEinstellungen, setzeMesswerte,
  archiviere, reaktiviere, entferneAktivitaet, wirdVerwendet,
  addAlternative, entferneAlternative, alternativeWirdVerwendet,
  aktivitaetenNachKategorie, sucheAktivitaet, vorschlagMesswerte,
} from '../js/core/library.js';
import {
  planFuer, erstellePlan, entfernePlan,
  addEinheit, benenneEinheitUm, entferneEinheit, verschiebeEinheit,
  addAktivitaetZuEinheit, entferneAktivitaetAusEinheit, verschiebeAktivitaetInEinheit,
  naechsteEinheit, schalteWeiter, sessionAusEinheit,
} from '../js/core/plan.js';

// ==================================================================
// Bibliothek
// ==================================================================

test('Bibliothek: anlegen, umbenennen, Einstellungen, Messwerte', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: vorschlagMesswerte('kraft') });
  assert.deepEqual(bank.messwerte, ['gewicht', 'wdh']);

  benenneUm(state, bank.id, 'Bankdrücken (LH)');
  setzeEinstellungen(state, bank.id, { progression: 'double' });
  setzeEinstellungen(state, bank.id, { einarmig: false });
  assert.equal(state.bibliothek[0].name, 'Bankdrücken (LH)');
  assert.deepEqual(state.bibliothek[0].einstellungen, { progression: 'double', einarmig: false });

  setzeMesswerte(state, bank.id, ['gewicht', 'wdh', 'dauer']);
  assert.deepEqual(state.bibliothek[0].messwerte, ['gewicht', 'wdh', 'dauer']);
  assert.throws(() => setzeMesswerte(state, bank.id, ['bizeps']), /Unbekannte Messwerte/);
  assert.throws(() => benenneUm(state, bank.id, '  '), /leer/);
});

test('Bibliothek: Archivieren ist der Normalweg, hartes Löschen nur wenn unbenutzt', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const dips = addAktivitaet(state, { name: 'Dips', kategorie: 'kraft', messwerte: ['wdh'] });

  // Bankdrücken in einer Session benutzen
  const s = neueSession({ datum: '2026-07-05' });
  addEintrag(addSegment(s, neuesSegment(bank.id)), neuerEintrag({ gewicht: 80, wdh: 8 }));
  state.sessions.push(s);

  assert.equal(wirdVerwendet(state, bank.id), 1);
  assert.throws(() => entferneAktivitaet(state, bank.id), /archivieren/);

  archiviere(state, bank.id);
  assert.deepEqual(aktivitaetenNachKategorie(state, 'kraft').map(a => a.name), ['Dips']);
  assert.equal(aktivitaetenNachKategorie(state, 'kraft', { mitArchivierten: true }).length, 2);
  // Verlauf bleibt lesbar:
  assert.equal(loeseSegmentAuf(state, s.segmente[0]).anzeigeName, 'Bankdrücken');

  reaktiviere(state, bank.id);
  assert.equal(aktivitaetenNachKategorie(state, 'kraft').length, 2);

  // Dips sind unbenutzt → hartes Löschen ok
  entferneAktivitaet(state, dips.id);
  assert.equal(state.bibliothek.length, 1);
});

test('Alternativen: anlegen, in Session nutzen, Löschschutz', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAlternative(state, bank.id, { name: 'KH-Bankdrücken' });
  const maschine = addAlternative(state, bank.id, { name: 'Brustpresse' });

  const s = neueSession();
  addEintrag(addSegment(s, neuesSegment(bank.id, { altOf: kh.id })), neuerEintrag({ gewicht: 30, wdh: 10 }));
  state.sessions.push(s);

  assert.equal(alternativeWirdVerwendet(state, kh.id), 1);
  assert.throws(() => entferneAlternative(state, bank.id, kh.id), /bleibt deshalb erhalten/);
  assert.equal(loeseSegmentAuf(state, s.segmente[0]).anzeigeName, 'KH-Bankdrücken');

  entferneAlternative(state, bank.id, maschine.id); // unbenutzt → ok
  assert.equal(state.bibliothek[0].alternativen.length, 1);
});

test('Bibliothek: Suche und Kategorie-Vorschläge', () => {
  const state = leererZustand();
  addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAktivitaet(state, { name: 'Schrägbankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAktivitaet(state, { name: 'E-Bike Tour', kategorie: 'rad', messwerte: vorschlagMesswerte('rad') });

  assert.equal(sucheAktivitaet(state, 'bank').length, 2);
  assert.equal(sucheAktivitaet(state, 'BIKE').length, 1);
  assert.deepEqual(sucheAktivitaet(state, '  '), []);
  assert.deepEqual(vorschlagMesswerte('schwimmen'), ['dauer', 'puls_avg', 'puls_max']);
});

// ==================================================================
// Plan
// ==================================================================

/** Mini-Version von Manuels Welt: 3 Kraft-Einheiten im Zyklus. */
function baueKraftWelt() {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kniebeuge = addAktivitaet(state, { name: 'Kniebeuge', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const laufband = addAktivitaet(state, { name: 'Laufband', kategorie: 'sonstiges', messwerte: ['dauer', 'puls_avg', 'puls_max'] });

  const push = addEinheit(state, 'kraft', { name: 'Push' });
  const beine = addEinheit(state, 'kraft', { name: 'Beine · Nacken' });
  const pull = addEinheit(state, 'kraft', { name: 'Pull' });

  addAktivitaetZuEinheit(state, 'kraft', push.id, laufband.id); // Warmup — Cardio im Kraft-Tag!
  addAktivitaetZuEinheit(state, 'kraft', push.id, bank.id);
  addAktivitaetZuEinheit(state, 'kraft', beine.id, kniebeuge.id);

  return { state, bank, kniebeuge, laufband, push, beine, pull };
}

test('Plan: optional pro Modul — kein Plan ist der Normalzustand', () => {
  const state = leererZustand();
  assert.equal(planFuer(state, 'rad'), null);
  assert.equal(naechsteEinheit(state, 'rad'), null);
  erstellePlan(state, 'rad');
  assert.equal(naechsteEinheit(state, 'rad'), null); // Plan da, aber leer → weiterhin null
  entfernePlan(state, 'rad');
  assert.equal(planFuer(state, 'rad'), null);
});

test('Plan: Zyklus läuft rund (nächste Einheit, weiterschalten, Wrap-around)', () => {
  const { state } = baueKraftWelt();
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Push');
  assert.equal(schalteWeiter(state, 'kraft').name, 'Beine · Nacken');
  assert.equal(schalteWeiter(state, 'kraft').name, 'Pull');
  assert.equal(schalteWeiter(state, 'kraft').name, 'Push'); // wieder von vorn
});

test('Plan: Einheiten verschieben/löschen — der Zeiger bleibt bei „seiner" Einheit', () => {
  const { state, beine, pull } = baueKraftWelt();
  schalteWeiter(state, 'kraft'); // Zeiger steht auf „Beine · Nacken"

  // „Beine · Nacken" ans Ende schieben → Zeiger wandert mit
  verschiebeEinheit(state, 'kraft', beine.id, +1);
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Beine · Nacken');
  assert.deepEqual(planFuer(state, 'kraft').einheiten.map(e => e.name), ['Push', 'Pull', 'Beine · Nacken']);

  // Einheit VOR dem Zeiger löschen → Zeiger rückt nach, zeigt weiter auf dieselbe Einheit
  entferneEinheit(state, 'kraft', pull.id);
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Beine · Nacken');

  // Die Zeiger-Einheit selbst löschen → Zeiger landet sauber im Zyklus
  entferneEinheit(state, 'kraft', beine.id);
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Push');
});

test('Plan: Aktivitäten in Einheit pflegen (add, entfernen, ▲▼)', () => {
  const { state, push, bank, laufband, kniebeuge } = baueKraftWelt();
  addAktivitaetZuEinheit(state, 'kraft', push.id, kniebeuge.id);
  assert.deepEqual(push.segmente.map(s => s.aktivitaetId), [laufband.id, bank.id, kniebeuge.id]);

  verschiebeAktivitaetInEinheit(state, 'kraft', push.id, 2, -1); // Kniebeuge eins hoch
  assert.deepEqual(push.segmente.map(s => s.aktivitaetId), [laufband.id, kniebeuge.id, bank.id]);
  verschiebeAktivitaetInEinheit(state, 'kraft', push.id, 0, -1); // oben bleibt oben (kein Fehler)
  assert.equal(push.segmente[0].aktivitaetId, laufband.id);

  entferneAktivitaetAusEinheit(state, 'kraft', push.id, kniebeuge.id);
  assert.equal(push.segmente.length, 2);
  assert.throws(() => entferneAktivitaetAusEinheit(state, 'kraft', push.id, kniebeuge.id), /nicht in dieser Einheit/);
});

test('Plan → Session: Brücke füllt Segmente vor, schaltet aber NICHT weiter', () => {
  const { state, push, laufband, bank } = baueKraftWelt();
  const session = sessionAusEinheit(state, 'kraft', push.id, { datum: '2026-07-06' });

  assert.equal(session.ausPlan, push.id);
  assert.deepEqual(session.segmente.map(s => s.aktivitaetId), [laufband.id, bank.id]);
  assert.ok(session.segmente.every(s => s.eintraege.length === 0));
  assert.equal(state.sessions.length, 0);                        // nichts automatisch eingehängt
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Push');    // Zyklus unverändert

  // Umbenennen zwischendurch schadet nicht
  benenneEinheitUm(state, 'kraft', push.id, 'Push A');
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Push A');
});

test('Plan + Bibliothek überleben die Backup-Runde', () => {
  const { state, push } = baueKraftWelt();
  schalteWeiter(state, 'kraft');
  const zurueck = importBackup(exportBackup(state));
  assert.equal(zurueck.plaene.kraft.position, 1);
  assert.equal(zurueck.plaene.kraft.einheiten[0].id, push.id);
  assert.equal(zurueck.bibliothek.length, 3);
});
