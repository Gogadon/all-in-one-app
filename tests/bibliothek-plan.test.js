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
  addEinheit, benenneEinheitUm, loescheEinheit, einheitenBibliothek, findeEinheit,
  addAktivitaetZuEinheit, entferneAktivitaetAusEinheit, verschiebeAktivitaetInEinheit,
  zyklusEinheiten, addZuZyklus, entferneAusZyklus, verschiebeImZyklus, setzePosition,
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

/** Manuels Welt: Einheiten-Bibliothek + Verweis-Zyklus (dieselbe Einheit mehrfach). */
function baueKraftWelt() {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kniebeuge = addAktivitaet(state, { name: 'Kniebeuge', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const laufband = addAktivitaet(state, { name: 'Laufband', kategorie: 'sonstiges', messwerte: ['dauer', 'puls_avg', 'puls_max'] });

  // Bibliothek
  const push = addEinheit(state, 'kraft', { name: 'Push' });
  const beine = addEinheit(state, 'kraft', { name: 'Beine · Nacken' });
  const rest = addEinheit(state, 'kraft', { name: 'Active Rest' });

  addAktivitaetZuEinheit(state, 'kraft', push.id, laufband.id); // Cardio im Kraft-Tag
  addAktivitaetZuEinheit(state, 'kraft', push.id, bank.id);
  addAktivitaetZuEinheit(state, 'kraft', beine.id, kniebeuge.id);

  // Zyklus: Push, Beine, Rest, Push, Rest  → Push kommt 2× vor
  for (const e of [push, beine, rest, push, rest]) addZuZyklus(state, 'kraft', e.id);

  return { state, bank, kniebeuge, laufband, push, beine, rest };
}

test('Plan: optional pro Modul — kein Plan ist der Normalzustand', () => {
  const state = leererZustand();
  assert.equal(planFuer(state, 'rad'), null);
  assert.equal(naechsteEinheit(state, 'rad'), null);
  erstellePlan(state, 'rad');
  assert.equal(naechsteEinheit(state, 'rad'), null); // Plan da, aber leerer Zyklus → null
  entfernePlan(state, 'rad');
  assert.equal(planFuer(state, 'rad'), null);
});

test('Bibliothek vs. Zyklus: dieselbe Einheit mehrfach, Übungen & Historie geteilt', () => {
  const { state, push } = baueKraftWelt();
  assert.equal(einheitenBibliothek(state, 'kraft').length, 3);
  const z = zyklusEinheiten(state, 'kraft');
  assert.equal(z.length, 5);
  assert.deepEqual(z.map(e => e.name), ['Push', 'Beine · Nacken', 'Active Rest', 'Push', 'Active Rest']);
  // Push an Position 0 und 3 ist DASSELBE Objekt:
  assert.equal(z[0], z[3]);
  // Übung zu Push → an beiden Stellen sichtbar:
  assert.equal(z[0].segmente.length, 2);
  assert.equal(z[3].segmente.length, 2);
});

test('Plan: Zyklus-Struktur und Wrap-around (dynamische Position)', () => {
  const { state } = baueKraftWelt();
  // Die Position wird jetzt dynamisch aus Anker + Verlauf berechnet.
  // Ohne Verlauf steht der Zeiger am Anker (Position 0 = Push).
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Push');
  // Der Zyklus selbst ist rund (5 Stellen, wrap-around über Modulo):
  const namen = zyklusEinheiten(state, 'kraft').map(e => e.name);
  assert.deepEqual(namen, ['Push', 'Beine · Nacken', 'Active Rest', 'Push', 'Active Rest']);
});

test('Zyklus: Stelle verschieben/entfernen — Struktur bleibt korrekt', () => {
  const { state } = baueKraftWelt();
  // Beine (Stelle 1) nach unten
  verschiebeImZyklus(state, 'kraft', 1, +1);
  assert.deepEqual(zyklusEinheiten(state, 'kraft').map(e => e.name),
    ['Push', 'Active Rest', 'Beine · Nacken', 'Push', 'Active Rest']);
  // Stelle entfernen
  entferneAusZyklus(state, 'kraft', 0);
  assert.deepEqual(zyklusEinheiten(state, 'kraft').map(e => e.name),
    ['Active Rest', 'Beine · Nacken', 'Push', 'Active Rest']);
});

test('Einheit löschen entfernt ALLE Zyklus-Vorkommen', () => {
  const { state, push } = baueKraftWelt();
  loescheEinheit(state, 'kraft', push.id);
  assert.ok(!zyklusEinheiten(state, 'kraft').some(e => e.name === 'Push'));
  assert.ok(!einheitenBibliothek(state, 'kraft').some(e => e.id === push.id));
  assert.deepEqual(zyklusEinheiten(state, 'kraft').map(e => e.name), ['Beine · Nacken', 'Active Rest', 'Active Rest']);
});

test('Plan: Aktivitäten in Einheit pflegen (add, entfernen, ▲▼)', () => {
  const { state, push, bank, laufband, kniebeuge } = baueKraftWelt();
  addAktivitaetZuEinheit(state, 'kraft', push.id, kniebeuge.id);
  assert.deepEqual(push.segmente.map(s => s.aktivitaetId), [laufband.id, bank.id, kniebeuge.id]);

  verschiebeAktivitaetInEinheit(state, 'kraft', push.id, 2, -1);
  assert.deepEqual(push.segmente.map(s => s.aktivitaetId), [laufband.id, kniebeuge.id, bank.id]);
  verschiebeAktivitaetInEinheit(state, 'kraft', push.id, 0, -1); // oben bleibt oben
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
  assert.equal(state.sessions.length, 0);
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Push');

  benenneEinheitUm(state, 'kraft', push.id, 'Push A');
  assert.equal(naechsteEinheit(state, 'kraft').name, 'Push A'); // wirkt an allen Stellen
});

test('Plan + Bibliothek überleben die Backup-Runde', () => {
  const { state, push } = baueKraftWelt();
  schalteWeiter(state, 'kraft');
  const zurueck = importBackup(exportBackup(state));
  assert.equal(zurueck.plaene.kraft.position, 1);
  assert.equal(zurueck.plaene.kraft.einheiten.length, 3);
  assert.equal(zurueck.plaene.kraft.zyklus.length, 5);
  assert.equal(zurueck.plaene.kraft.zyklus[0], push.id);
  assert.equal(zurueck.bibliothek.length, 3);
});

test('Dynamische Position: erledigte Krafttage + automatische Ruhetage', async () => {
  const { addEinheit, addZuZyklus, addAktivitaetZuEinheit, aktuelleEinheit } = await import('../js/core/plan.js');
  const { neueSession } = await import('../js/core/model.js');
  const { addAktivitaet } = await import('../js/core/library.js');
  const { leererZustand } = await import('../js/core/storage.js');
  const state = leererZustand();
  // Kraftübungen + eine Cardio-Übung für den Ruhetag
  const bank = addAktivitaet(state, { name: 'Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const laufen = addAktivitaet(state, { name: 'Laufband', kategorie: 'kraft', messwerte: ['dauer'] });
  laufen.cardio = true;   // als Cardio markieren (→ Active Rest = Ruhetag)
  // Mini-Zyklus: Push(Kraft) → Rest(Cardio) → Pull(Kraft)
  const push = addEinheit(state, 'kraft', { name: 'Push' });
  const rest = addEinheit(state, 'kraft', { name: 'Active Rest' });
  const pull = addEinheit(state, 'kraft', { name: 'Pull' });
  addAktivitaetZuEinheit(state, 'kraft', push.id, bank.id);
  addAktivitaetZuEinheit(state, 'kraft', rest.id, laufen.id);   // nur Cardio → Ruhetag
  addAktivitaetZuEinheit(state, 'kraft', pull.id, bank.id);
  [push, rest, pull].forEach(e => addZuZyklus(state, 'kraft', e.id));
  state.plaene.kraft.anker = { iso: '2026-07-01', index: 0 };

  // Am 01.07. Push abgeschlossen
  const s = neueSession({ datum: '2026-07-01' }); s.modul = 'kraft'; s.abgeschlossen = true;
  state.sessions.push(s);

  // 02.07.: Push war erledigt → Rest ist dran
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-02').name, 'Active Rest');
  // 03.07.: Rest rückt automatisch (kein Abschließen nötig) → Pull
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-03').name, 'Pull');
  // Pull nicht abgeschlossen → bleibt am 04. und 05. auf Pull
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-04').name, 'Pull');
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-05').name, 'Pull');
});

test('Dynamische Position: Abschließen rückt NICHT am selben Tag', async () => {
  const { addEinheit, addZuZyklus, aktuelleEinheit } = await import('../js/core/plan.js');
  const { neueSession } = await import('../js/core/model.js');
  const { leererZustand } = await import('../js/core/storage.js');
  const state = leererZustand();
  const push = addEinheit(state, 'kraft', { name: 'Push' });
  const pull = addEinheit(state, 'kraft', { name: 'Pull' });
  [push, pull].forEach(e => addZuZyklus(state, 'kraft', e.id));
  state.plaene.kraft.anker = { iso: '2026-07-01', index: 0 };
  // Heute (01.07.) Push abschließen
  const s = neueSession({ datum: '2026-07-01' }); s.modul = 'kraft'; s.abgeschlossen = true;
  state.sessions.push(s);
  // Am SELBEN Tag zeigt es weiterhin Push (rückt nicht sofort)
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-01').name, 'Push');
  // Erst am nächsten Tag Pull
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-02').name, 'Pull');
});

test('Überspringen: mehrfach am selben Tag möglich (Variante A)', async () => {
  const { addEinheit, addZuZyklus, addAktivitaetZuEinheit, aktuelleEinheit } = await import('../js/core/plan.js');
  const { addAktivitaet } = await import('../js/core/library.js');
  const { neueSession } = await import('../js/core/model.js');
  const { leererZustand } = await import('../js/core/storage.js');
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bank', kategorie: 'kraft', messwerte: ['gewicht'] });
  const lauf = addAktivitaet(state, { name: 'Laufband', kategorie: 'kraft', messwerte: ['dauer'] });
  lauf.cardio = true;
  const namen = ['Rücken', 'Brust', 'Rest', 'Beine'];
  namen.forEach(n => {
    const e = addEinheit(state, 'kraft', { name: n });
    addAktivitaetZuEinheit(state, 'kraft', e.id, n === 'Rest' ? lauf.id : bank.id);
    addZuZyklus(state, 'kraft', e.id);
  });
  state.plaene.kraft.anker = { iso: '2026-07-09', index: 0 };
  const skip = () => {
    const s = neueSession({ datum: '2026-07-09' }); s.modul = 'kraft'; s.uebersprungen = true;
    state.sessions.push(s);
  };
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-09').name, 'Rücken');
  skip(); assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-09').name, 'Brust');
  skip(); assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-09').name, 'Rest');
  skip(); assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-09').name, 'Beine');
});

test('Überspringen: geskippter Ruhetag rückt nicht doppelt', async () => {
  const { addEinheit, addZuZyklus, addAktivitaetZuEinheit, aktuelleEinheit } = await import('../js/core/plan.js');
  const { addAktivitaet } = await import('../js/core/library.js');
  const { neueSession } = await import('../js/core/model.js');
  const { leererZustand } = await import('../js/core/storage.js');
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bank', kategorie: 'kraft', messwerte: ['gewicht'] });
  const lauf = addAktivitaet(state, { name: 'Laufband', kategorie: 'kraft', messwerte: ['dauer'] });
  lauf.cardio = true;
  const rest = addEinheit(state, 'kraft', { name: 'Rest' });
  addAktivitaetZuEinheit(state, 'kraft', rest.id, lauf.id);
  const r = addEinheit(state, 'kraft', { name: 'Rücken' });
  addAktivitaetZuEinheit(state, 'kraft', r.id, bank.id);
  [rest, r].forEach(e => addZuZyklus(state, 'kraft', e.id));
  state.plaene.kraft.anker = { iso: '2026-07-09', index: 0 };
  const s = neueSession({ datum: '2026-07-09' }); s.modul = 'kraft'; s.uebersprungen = true;
  state.sessions.push(s);
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-09').name, 'Rücken');
  // Morgen: der geskippte Ruhetag darf nicht nochmal automatisch rücken
  assert.equal(aktuelleEinheit(state, 'kraft', '2026-07-10').name, 'Rücken');
});
