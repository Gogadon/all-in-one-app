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
  archiviere, reaktiviere, entferneAktivitaet, wirdVerwendet, referenzenVonAktivitaet,
  addAlternative, entferneAlternative, alternativeWirdVerwendet,
  aktivitaetenNachKategorie, sucheAktivitaet, vorschlagMesswerte,
} from '../js/core/library.js';
import {
  planFuer, erstellePlan, entfernePlan,
  addEinheit, benenneEinheitUm, loescheEinheit, einheitenBibliothek, findeEinheit,
  addAktivitaetZuEinheit, entferneAktivitaetAusEinheit, verschiebeAktivitaetInEinheit,
  zyklusEinheiten, addZuZyklus, entferneAusZyklus, verschiebeImZyklus,
  naechsteEinheit, sessionAusEinheit,
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

test('Alternativen: verknüpfen (Verweis), in Session nutzen, Löschschutz', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  // Alternativen sind jetzt echte Übungen, die verlinkt werden.
  const kh = addAktivitaet(state, { name: 'KH-Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const maschine = addAktivitaet(state, { name: 'Brustpresse', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);
  addAlternative(state, bank.id, maschine.id);
  assert.deepEqual(bank.alternativen, [kh.id, maschine.id]);

  const s = neueSession();
  addEintrag(addSegment(s, neuesSegment(bank.id, { altOf: kh.id })), neuerEintrag({ gewicht: 30, wdh: 10 }));
  state.sessions.push(s);

  assert.equal(alternativeWirdVerwendet(state, kh.id), 1);
  assert.throws(() => entferneAlternative(state, bank.id, kh.id), /bleibt deshalb erhalten/);
  assert.equal(loeseSegmentAuf(state, s.segmente[0]).anzeigeName, 'KH-Bankdrücken');

  entferneAlternative(state, bank.id, maschine.id); // Verweis unbenutzt → ok
  assert.deepEqual(bank.alternativen, [kh.id]);
  // Die echte Übung bleibt in der Bibliothek erhalten
  assert.ok(state.bibliothek.some(a => a.id === maschine.id));
  // Eine Übung kann nicht ihre eigene Alternative sein
  assert.throws(() => addAlternative(state, bank.id, bank.id), /eigene Alternative/);
});

test('Bibliothek: Suche und Kategorie-Vorschläge', () => {
  const state = leererZustand();
  addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAktivitaet(state, { name: 'Schrägbankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAktivitaet(state, { name: 'E-Bike Tour', kategorie: 'rad', messwerte: vorschlagMesswerte('rad') });

  assert.equal(sucheAktivitaet(state, 'bank').length, 2);
  assert.equal(sucheAktivitaet(state, 'BIKE').length, 1);
  assert.deepEqual(sucheAktivitaet(state, '  '), []);
  assert.deepEqual(vorschlagMesswerte('schwimmen'), ['bahnen', 'dauer', 'puls_avg', 'puls_max']);
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
  const { state } = baueKraftWelt();
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
  state.plaene.kraft.position = 1;   // Cache-Wert setzen; der Test prüft die Backup-Runde
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

test('Alternativen: Löschen räumt tote Verweise + schützt Historie (Etappe 4)', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const chest = addAktivitaet(state, { name: 'Chest Press', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, chest.id);

  // Unbenutzte Alternative löschen → Verweis muss mitverschwinden (kein toter Verweis)
  entferneAktivitaet(state, chest.id);
  assert.deepEqual(bank.alternativen, []);
  assert.equal(state.bibliothek.find(a => a.id === chest.id), undefined);

  // Alternative, die in einer Session steckt, ist geschützt
  const chest2 = addAktivitaet(state, { name: 'Chest Press 2', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, chest2.id);
  const s = neueSession();
  addSegment(s, neuesSegment(bank.id, { altOf: chest2.id }));
  state.sessions.push(s);
  assert.throws(() => entferneAktivitaet(state, chest2.id), /Session/);
});

// ============================================================
// Regressionstest: Anker folgt beim Zyklus-Umbau der Einheit
// (Review-Punkt 5/6, 13.7. per Diagnose bestätigt und gefixt).
// aktuelleEinheit rechnet aus dem Anker — ohne Nachführen zeigte der
// Anker nach Löschen/Entfernen/Verschieben auf die falsche Einheit.
// ============================================================
test('Plan: Anker folgt der Einheit bei Zyklus-Umbau', async () => {
  const {
    addEinheit, addZuZyklus, setzeAnker, aktuelleEinheit,
    loescheEinheit, entferneAusZyklus, verschiebeImZyklus,
  } = await import('../js/core/plan.js');
  const { leererZustand } = await import('../js/core/storage.js');
  const HEUTE = '2026-07-13', M = 'kraft';

  function baue() {
    const state = leererZustand();
    const A = addEinheit(state, M, { name: 'A' });
    const B = addEinheit(state, M, { name: 'B' });
    const C = addEinheit(state, M, { name: 'C' });
    addZuZyklus(state, M, A.id); addZuZyklus(state, M, B.id); addZuZyklus(state, M, C.id);
    setzeAnker(state, M, 1, HEUTE);   // Anker auf Index 1 → B
    return { state, A, B, C };
  }
  const cur = s => aktuelleEinheit(s, M, HEUTE)?.name;

  // Vor dem Anker löschen → Anker bleibt auf B
  let { state, A } = baue();
  assert.equal(cur(state), 'B');
  loescheEinheit(state, M, A.id);
  assert.equal(cur(state), 'B');

  // Vor dem Anker aus dem Zyklus entfernen → B
  ({ state, A } = baue());
  entferneAusZyklus(state, M, 0);
  assert.equal(cur(state), 'B');

  // A und B tauschen → Anker folgt B
  ({ state } = baue());
  verschiebeImZyklus(state, M, 0, +1);
  assert.equal(cur(state), 'B');

  // Verankerte Einheit selbst löschen → kein Absturz, gültige Einheit
  const { state: s2, B } = baue();
  loescheEinheit(s2, M, B.id);
  assert.ok(cur(s2) === 'A' || cur(s2) === 'C');
});

// ==================================================================
// Rest Days: Einheit ausdrücklich als Ruhetag markieren
// ==================================================================

test('Ruhetag: Markierung setzen und wieder entfernen', async () => {
  const { addEinheit, setzeRuhetag, findeEinheit } = await import('../js/core/plan.js');
  const { leererZustand } = await import('../js/core/storage.js');
  const state = leererZustand();
  const e = addEinheit(state, 'kraft', { name: 'Sonntag frei' });
  assert.equal(e.typ, undefined);

  setzeRuhetag(state, 'kraft', e.id, true);
  assert.equal(findeEinheit(state, 'kraft', e.id).typ, 'rest');

  setzeRuhetag(state, 'kraft', e.id, false);
  assert.equal(findeEinheit(state, 'kraft', e.id).typ, undefined);
});

test('Ruhetag: markierte Einheit schaltet beim Tageswechsel automatisch weiter', async () => {
  const { addEinheit, addZuZyklus, addAktivitaetZuEinheit, setzeRuhetag, setzeAnker, aktuelleEinheit }
    = await import('../js/core/plan.js');
  const { addAktivitaet } = await import('../js/core/library.js');
  const { leererZustand } = await import('../js/core/storage.js');
  const M = 'kraft';
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });

  // Zyklus: Push (Kraft) → Frei (Ruhetag) → Pull (Kraft)
  const push = addEinheit(state, M, { name: 'Push' });
  const frei = addEinheit(state, M, { name: 'Frei' });
  const pull = addEinheit(state, M, { name: 'Pull' });
  addAktivitaetZuEinheit(state, M, push.id, bank.id);
  addAktivitaetZuEinheit(state, M, pull.id, bank.id);
  // „Frei" enthält eine Kraftübung — ohne Markierung wäre es KEIN Ruhetag.
  addAktivitaetZuEinheit(state, M, frei.id, bank.id);
  addZuZyklus(state, M, push.id); addZuZyklus(state, M, frei.id); addZuZyklus(state, M, pull.id);

  setzeAnker(state, M, 1, '2026-07-01');   // heute steht „Frei" an
  assert.equal(aktuelleEinheit(state, M, '2026-07-01').name, 'Frei');

  // Ohne Markierung: nichts erledigt → der Zyklus wartet auf „Frei"
  assert.equal(aktuelleEinheit(state, M, '2026-07-02').name, 'Frei');

  // Mit Markierung: der Ruhetag ist mit dem Kalendertag durch → morgen Pull
  setzeRuhetag(state, M, frei.id, true);
  assert.equal(aktuelleEinheit(state, M, '2026-07-02').name, 'Pull');
});

test('Ruhetag: unbekannte Einheit wirft', async () => {
  const { setzeRuhetag, erstellePlan } = await import('../js/core/plan.js');
  const { leererZustand } = await import('../js/core/storage.js');
  const state = leererZustand();
  erstellePlan(state, 'kraft');
  assert.throws(() => setzeRuhetag(state, 'kraft', 'gibts-nicht', true), /nicht gefunden/);
});

// ==================================================================
// Referenzen: Löschen darf keine toten Verweise hinterlassen
// ==================================================================

test('Referenzen: zählt Sessions, Plan-Einheiten und Alternativ-Verweise', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAktivitaet(state, { name: 'KH-Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);

  const push = addEinheit(state, 'kraft', { name: 'Push' });
  addAktivitaetZuEinheit(state, 'kraft', push.id, bank.id);

  const s = neueSession({ datum: '2026-07-05' });
  addEintrag(addSegment(s, neuesSegment(bank.id)), neuerEintrag({ gewicht: 80, wdh: 8 }));
  state.sessions.push(s);

  const ref = referenzenVonAktivitaet(state, bank.id);
  assert.equal(ref.sessions, 1);
  assert.equal(ref.einheiten, 1);
  assert.equal(ref.alternativen, 0);      // bank verlinkt kh, nicht umgekehrt
  assert.equal(referenzenVonAktivitaet(state, kh.id).alternativen, 1);
});

test('Referenzen: Übung im Plan lässt sich nicht löschen (Regression)', () => {
  const state = leererZustand();
  const uebung = addAktivitaet(state, { name: 'Neue Übung', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const einheit = addEinheit(state, 'kraft', { name: 'Rücken · Bizeps' });
  addAktivitaetZuEinheit(state, 'kraft', einheit.id, uebung.id);

  // Nie trainiert → die reine Session-Prüfung sagt „unbenutzt" …
  assert.equal(wirdVerwendet(state, uebung.id), 0);
  // … aber Löschen hätte im Plan einen Verweis ins Leere hinterlassen.
  assert.throws(() => entferneAktivitaet(state, uebung.id), /Plan-Einheit/);
  assert.equal(state.bibliothek.length, 1);

  // Erst aus der Einheit nehmen, dann geht es
  entferneAktivitaetAusEinheit(state, 'kraft', einheit.id, uebung.id);
  entferneAktivitaet(state, uebung.id);
  assert.equal(state.bibliothek.length, 0);
  assert.deepEqual(findeEinheit(state, 'kraft', einheit.id).segmente, []);
});

test('Referenzen: Alternativ-Verweis blockiert nicht, wird aber aufgeräumt', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAktivitaet(state, { name: 'KH-Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);

  entferneAktivitaet(state, kh.id);                 // nur verlinkt → löschbar
  assert.deepEqual(bank.alternativen, []);          // Verweis ist weg, nicht tot
});

// ==================================================================
// Zyklus-Stellen: Position und Anker bei mehrfachen Einheiten
// ==================================================================

test('Zyklus: Entfernen verschiebt die STELLE, nicht die Einheit', async () => {
  const P = await import('../js/core/plan.js');
  // Fehler war: die neue Stelle wurde per indexOf über die Einheiten-ID
  // gesucht. Bei A→B→A→C und dem Anker auf dem ZWEITEN A traf das immer das
  // erste — der Zeiger sprang eine Einheit zurück.
  const bau = () => {
    const state = leererZustand();
    const A = P.addEinheit(state, 'kraft', { name: 'A' });
    const B = P.addEinheit(state, 'kraft', { name: 'B' });
    const C = P.addEinheit(state, 'kraft', { name: 'C' });
    for (const e of [A, B, A, C]) P.addZuZyklus(state, 'kraft', e.id);
    return { state, A, B, C, plan: state.plaene.kraft };
  };

  // Stelle DAVOR entfernt → eine Stelle nach vorn
  let w = bau();
  P.setzeAnker(w.state, 'kraft', 2, '2026-09-05');
  P.entferneAusZyklus(w.state, 'kraft', 1);
  assert.deepEqual(w.plan.zyklus, [w.A.id, w.A.id, w.C.id]);
  assert.equal(w.plan.anker.index, 1, 'weiterhin das zweite A');
  assert.equal(w.plan.position, 1);

  // Stelle DAHINTER entfernt → unverändert
  w = bau();
  P.setzeAnker(w.state, 'kraft', 1, '2026-09-05');
  P.entferneAusZyklus(w.state, 'kraft', 3);
  assert.equal(w.plan.anker.index, 1);

  // Die Stelle SELBST entfernt → die nachrückende übernimmt
  w = bau();
  P.setzeAnker(w.state, 'kraft', 1, '2026-09-05');
  P.entferneAusZyklus(w.state, 'kraft', 1);
  assert.equal(w.plan.anker.index, 1, 'jetzt steht dort das zweite A');
  assert.equal(w.plan.zyklus[1], w.A.id);

  // Letzte Stelle entfernt, Anker war dort → läuft sauber um
  w = bau();
  P.setzeAnker(w.state, 'kraft', 3, '2026-09-05');
  P.entferneAusZyklus(w.state, 'kraft', 3);
  assert.equal(w.plan.anker.index, 0);
  assert.equal(w.plan.zyklus.length, 3);
});

test('Zyklus: Einheit löschen entfernt alle Vorkommen und rechnet richtig um', async () => {
  const P = await import('../js/core/plan.js');
  const state = leererZustand();
  const A = P.addEinheit(state, 'kraft', { name: 'A' });
  const B = P.addEinheit(state, 'kraft', { name: 'B' });
  const C = P.addEinheit(state, 'kraft', { name: 'C' });
  for (const e of [B, A, B, A, C]) P.addZuZyklus(state, 'kraft', e.id);
  const plan = state.plaene.kraft;
  P.setzeAnker(state, 'kraft', 3, '2026-09-05');      // zweites A
  P.loescheEinheit(state, 'kraft', B.id);             // zwei Stellen fallen weg
  assert.deepEqual(plan.zyklus, [A.id, A.id, C.id]);
  assert.equal(plan.anker.index, 1, 'immer noch das zweite A');

  // Alles gelöscht → Zyklus leer, Indizes auf 0
  P.loescheEinheit(state, 'kraft', A.id);
  P.loescheEinheit(state, 'kraft', C.id);
  assert.deepEqual(plan.zyklus, []);
  assert.equal(plan.anker.index, 0);
  assert.equal(plan.position, 0);
});

test('Zyklus: „Heute korrigieren" nach einem Überspringen landet nicht daneben', async () => {
  const P = await import('../js/core/plan.js');
  const HEUTE = '2026-09-05';
  const state = leererZustand();
  const r = P.addEinheit(state, 'kraft', { name: 'Rücken' });
  const b = P.addEinheit(state, 'kraft', { name: 'Brust' });
  const be = P.addEinheit(state, 'kraft', { name: 'Beine' });
  for (const e of [r, b, be]) P.addZuZyklus(state, 'kraft', e.id);
  P.setzeAnker(state, 'kraft', 0, HEUTE);
  assert.equal(P.aktuelleEinheit(state, 'kraft', HEUTE).name, 'Rücken');

  // Heute übersprungen → rückt sofort weiter. Das soll so bleiben.
  state.sessions.push({ id: 'sk1', datum: HEUTE, modul: 'kraft', uebersprungen: true, segmente: [] });
  assert.equal(P.aktuelleEinheit(state, 'kraft', HEUTE).name, 'Brust');

  // Jetzt ausdrücklich korrigieren: heute ist Beine. Der bereits verrechnete
  // Skip steckt in dieser Wahl — vorher wurde er ein zweites Mal addiert und
  // die Anzeige sprang bei drei Einheiten sogar wieder auf Rücken.
  P.setzeAnker(state, 'kraft', 2, HEUTE);
  assert.equal(P.aktuelleEinheit(state, 'kraft', HEUTE).name, 'Beine');

  // Ein SPÄTERER Skip rückt weiterhin ganz normal weiter.
  state.sessions.push({ id: 'sk2', datum: HEUTE, modul: 'kraft', uebersprungen: true, segmente: [] });
  assert.equal(P.aktuelleEinheit(state, 'kraft', HEUTE).name, 'Rücken');

  // Und am Folgetag zählt der Anker-Tag ganz normal mit.
  assert.equal(P.aktuelleEinheit(state, 'kraft', '2026-09-06').name, 'Brust');
});

// ============================================================
// „Alle Übungen" — Übersicht, Sheet, Wiederherstellen
// ============================================================

/** Kleine Welt: Übungen in Einheiten, Alternativen, Sessions. */
function uebungsWelt() {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAktivitaet(state, { name: 'KH-Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const aeh = addAktivitaet(state, { name: 'Ärmel-Curls', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const lauf = addAktivitaet(state, { name: 'Laufband', kategorie: 'sonstiges', messwerte: ['dauer'] });
  const zug = addAktivitaet(state, { name: 'Zugmaschine', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAktivitaet(state, { name: 'Radtour', kategorie: 'rad', messwerte: ['distanz'] });
  addAlternative(state, bank.id, kh.id);

  const push = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', push.id, bank.id);
  addAktivitaetZuEinheit(state, 'kraft', push.id, lauf.id);
  const push2 = addEinheit(state, 'kraft', { name: 'Push B' });
  addAktivitaetZuEinheit(state, 'kraft', push2.id, bank.id);

  /** Session mit Segmenten: [aktivitaetId, { alt, erledigt, saetze }] */
  const session = (datum, segs, { uebersprungen = false } = {}) => {
    const s = neueSession({ datum });
    s.modul = 'kraft';
    if (uebersprungen) s.uebersprungen = true;
    for (const [id, { alt = null, erledigt = true, saetze = 1 } = {}] of segs) {
      const seg = addSegment(s, neuesSegment(id, { altOf: alt }));
      seg.erledigt = erledigt;
      for (let i = 0; i < saetze; i++) addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 8 }));
    }
    state.sessions.push(s);
  };
  session('2026-09-01', [[bank.id], [lauf.id]]);
  session('2026-09-03', [[bank.id], [bank.id]]);                 // zweimal drin → einmal zählen
  session('2026-09-05', [[bank.id, { alt: kh.id }]]);           // ausgewichen → KH-Bank zählt
  session('2026-09-07', [[bank.id, { erledigt: false }]]);      // nicht abgehakt → zählt nicht
  session('2026-09-09', [[bank.id, { saetze: 0 }]]);            // abgehakt, aber leer → zählt nicht
  session('2026-09-11', [[bank.id]], { uebersprungen: true });  // übersprungen → zählt nicht
  return { state, bank, kh, aeh, lauf, zug };
}

test('Übersicht: „trainiert" zählt, was wirklich gemacht wurde', async () => {
  const { uebungsUebersicht } = await import('../js/modules/kraft/logik.js');
  const { state, bank, kh, lauf, zug } = uebungsWelt();
  const u = Object.fromEntries(uebungsUebersicht(state).map(x => [x.aktivitaet.id, x]));
  assert.equal(u[bank.id].trainiert, 2, 'nur 01.09. und 03.09.');
  assert.equal(u[kh.id].trainiert, 1, 'ausgewichen am 05.09. zählt für die Alternative');
  assert.equal(u[lauf.id].trainiert, 1);
  assert.equal(u[zug.id].trainiert, 0);
});

test('Übersicht: wo steckt die Übung', async () => {
  const { uebungsUebersicht } = await import('../js/modules/kraft/logik.js');
  const { state, bank, kh, aeh } = uebungsWelt();
  const u = Object.fromEntries(uebungsUebersicht(state).map(x => [x.aktivitaet.id, x]));
  assert.equal(u[bank.id].einheiten, 2, 'Push A und Push B');
  assert.equal(u[kh.id].einheiten, 0);
  assert.equal(u[kh.id].istAlternative, true);
  assert.equal(u[bank.id].istAlternative, false);
  assert.equal(u[aeh.id].einheiten, 0);
  assert.equal(u[aeh.id].istAlternative, false, 'eine Karteileiche');
});

test('Übersicht: nur Kraft und Cardio, deutsch sortiert, Archiv markiert', async () => {
  const { uebungsUebersicht } = await import('../js/modules/kraft/logik.js');
  const { state, zug } = uebungsWelt();
  archiviere(state, zug.id);
  const liste = uebungsUebersicht(state);
  assert.deepEqual(liste.map(x => x.aktivitaet.name),
    ['Ärmel-Curls', 'Bankdrücken', 'KH-Bank', 'Laufband', 'Zugmaschine'],
    'Radtour fehlt; „Ä" steht bei „A", nicht hinter „Z"');
  assert.equal(liste.find(x => x.aktivitaet.id === zug.id).archiviert, true);
});

/** Kraft-Modul mit Test-Kontext bauen. */
async function kraftMit(state) {
  const { installiereBrowserAttrappe, testKontext } = await import('./helpers/umgebung.js');
  installiereBrowserAttrappe();
  const { esc, formatDatum } = await import('../js/ui/components.js');
  const { erstelleKraftModul } = await import('../js/modules/kraft.js');
  const { ctx, protokoll } = testKontext(state, { esc, formatDatum });
  return { k: erstelleKraftModul(ctx), protokoll };
}

test('Alle Übungen: Knopf im Plan zählt ohne Archiv, Sheet zeigt alles', async () => {
  const { state, zug, kh } = uebungsWelt();
  archiviere(state, zug.id);
  const { k, protokoll } = await kraftMit(state);

  const plan = k.planHtml();
  assert.match(plan, /data-action="k\.bibliothek"[^>]*>Alle Übungen \(4\)</, 'fünf Übungen, eine archiviert');
  assert.ok(plan.indexOf('Alle Übungen') < plan.indexOf('Einheiten · Bibliothek'), 'über der Einheiten-Bibliothek');

  k.actions['k.bibliothek']({});
  const sheet = protokoll.sheet;
  assert.match(sheet, /<h3>Alle Übungen<\/h3>/);
  assert.match(sheet, /Bankdrücken[\s\S]*2 Einheiten · 2×/);
  assert.match(sheet, /KH-Bank[\s\S]*Alternative · 1×/);
  assert.match(sheet, /Ärmel-Curls[\s\S]*nirgends eingeplant · noch nie/);
  assert.doesNotMatch(sheet, /Radtour/);
  // Die archivierte steht unten, mit Wiederherstellen statt ⚙️-Weg.
  assert.match(sheet, /Archiviert \(1\)[\s\S]*Zugmaschine[\s\S]*k\.aktReaktiv/);
  // Jede aktive Zeile führt ins ⚙️-Sheet — mit Merker, woher man kam.
  assert.match(sheet, new RegExp(`data-action="k\\.einstellungen" data-akt="${kh.id}" data-von="bibliothek"`));
});

test('Alle Übungen: Suche filtert, auch im Archiv', async () => {
  const { state, zug } = uebungsWelt();
  archiviere(state, zug.id);
  const { k, protokoll } = await kraftMit(state);
  k.actions['k.bibliothek']({});
  k.actions['k.bibSuche']({}, { value: 'bank' });
  assert.match(protokoll.sheet, /Bankdrücken/);
  assert.match(protokoll.sheet, /KH-Bank/);
  assert.doesNotMatch(protokoll.sheet, /Laufband|Zugmaschine/);
  k.actions['k.bibSuche']({}, { value: 'xyz' });
  assert.match(protokoll.sheet, /Keine Treffer/);
});

test('Alle Übungen: Wiederherstellen holt die Übung zurück in die Auswahl', async () => {
  const { state, zug } = uebungsWelt();
  archiviere(state, zug.id);
  const { k, protokoll } = await kraftMit(state);
  k.actions['k.bibliothek']({});
  await k.actions['k.aktReaktiv']({ akt: zug.id });
  assert.equal(zug.archiviert, undefined);
  assert.equal(protokoll.saves, 1, 'gespeichert');
  assert.doesNotMatch(protokoll.sheet, /Archiviert/, 'Sheet bleibt offen, Archiv jetzt leer');
  assert.match(protokoll.sheet, /Zugmaschine/);
  // …und sie taucht wieder bei „Übung hinzufügen" auf.
  k.actions['k.uebungPlus']();
  assert.match(protokoll.sheet, /Zugmaschine/);
});

test('Alle Übungen: Zurück-Knopf nur, wenn man aus der Liste kommt', async () => {
  const { state, bank, kh } = uebungsWelt();
  const { k, protokoll } = await kraftMit(state);

  // Aus der Liste → Zurück-Knopf, und er führt mit der alten Suche zurück.
  k.actions['k.bibliothek']({});
  k.actions['k.bibSuche']({}, { value: 'bank' });
  k.actions['k.einstellungen']({ akt: bank.id, von: 'bibliothek' });
  assert.match(protokoll.sheet, /‹ Alle Übungen/);
  // Das ⚙️ einer Alternative im Sheet lässt den Weg zurück stehen.
  k.actions['k.einstellungen']({ akt: bank.id, alt: kh.id });
  k.actions['k.einstellungen']({ akt: bank.id, von: 'bibliothek' });
  assert.match(protokoll.sheet, /‹ Alle Übungen/);
  k.actions['k.bibliothek']({ behalten: '1' });
  assert.match(protokoll.sheet, /value="bank"/, 'Suche behalten');
  assert.doesNotMatch(protokoll.sheet, /Laufband/);

  // Über das ⚙️ im Plan → wie immer, kein Zurück-Knopf.
  k.actions['k.einstellungen']({ akt: bank.id });
  assert.doesNotMatch(protokoll.sheet, /‹ Alle Übungen/);
  // Frisch über den Plan-Knopf geöffnet → Suche wieder leer.
  k.actions['k.bibliothek']({});
  assert.match(protokoll.sheet, /value=""/);
});
