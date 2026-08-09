// ============================================================
// tests/render-smoke.test.js — Render-Smoke-Tests
//
// WARUM ES DIESE DATEI GIBT
// Die beiden Anzeigefehler, die ein Review gefunden hat (im Kraft-Verlauf
// stand die Hauptübung statt der benutzten Alternative; im Tages-Sheet hieß
// jede Schwimmeinheit „Wanderung"), waren durch KEINEN Unit-Test zu sehen.
// `loeseSegmentAuf` war getestet und richtig — die Oberfläche hat es nur
// nicht benutzt. Die Lücke lag also nicht in der Logik, sondern zwischen
// Logik und HTML.
//
// Diese Tests schließen genau diese Lücke: sie rufen die HTML-Funktionen der
// Module mit einem realistischen Zustand auf und prüfen, was drinsteht.
// Kein Browser nötig — die Module geben Strings zurück.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installiereBrowserAttrappe, testKontext } from './helpers/umgebung.js';

installiereBrowserAttrappe();

const { leererZustand } = await import('../js/core/storage.js');
const { esc, formatDatum } = await import('../js/ui/components.js');
const { neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag } = await import('../js/core/model.js');
const { addAktivitaet, addAlternative } = await import('../js/core/library.js');
const { addEinheit, addAktivitaetZuEinheit, addZuZyklus } = await import('../js/core/plan.js');
const { setzeMessung } = await import('../js/core/koerper.js');

const { erstelleKraftModul } = await import('../js/modules/kraft.js');
const { erstelleRadModul } = await import('../js/modules/rad.js');
const { erstelleWanderModul } = await import('../js/modules/wandern.js');
const { erstelleSchwimmModul } = await import('../js/modules/schwimmen.js');
const { erstelleKoerperModul } = await import('../js/modules/koerper.js');
const { erstelleChallengeModul } = await import('../js/modules/challenge.js');

const HEUTE = new Date().toISOString().slice(0, 10);

function modul(fabrik, state) {
  const { ctx, protokoll } = testKontext(state, { esc, formatDatum });
  return { m: fabrik(ctx), protokoll };
}

/** Eine fertige Tour-Session (Rad/Wandern/Schwimmen) direkt in den Zustand. */
function tour(state, modulName, aktName, messwerte, { datum = HEUTE, name } = {}) {
  // Kategorie = Modulname: so legt die Touren-Fabrik ihre Aktivitäten auch an.
  const akt = addAktivitaet(state, { name: aktName, kategorie: modulName, messwerte: Object.keys(messwerte) });
  const s = neueSession({ datum });
  s.modul = modulName;
  s.abgeschlossen = true;
  if (name) s.name = name;
  const seg = addSegment(s, neuesSegment(akt.id));
  seg.erledigt = true;
  addEintrag(seg, neuerEintrag(messwerte));
  state.sessions.push(s);
  return s;
}

// ==================================================================
// Kraft
// ==================================================================

test('Smoke Kraft: laufende Einheit zeigt Übungsnamen und eingetragene Werte', async () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const e = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', e.id, bank.id);
  addZuZyklus(state, 'kraft', e.id);

  const { m: kraft } = modul(erstelleKraftModul, state);

  // Vor dem Start: der Plan-Name steht auf dem Startbildschirm.
  assert.match(kraft.heuteHtml(), /Push A/);

  await kraft.actions['k.start']({ einheit: e.id });
  const seg = state.sessions[0].segmente[0];
  await kraft.actions['k.wert']({ seg: seg.id, eintrag: seg.eintraege[0].id, typ: 'gewicht' }, { value: '82,5' });

  const html = kraft.heuteHtml();
  assert.match(html, /Bankdrücken/);
  assert.match(html, /82,5/, 'der eingetragene Wert steht im Feld');
});

test('Smoke Kraft: benutzte Alternative steht im HTML, nicht die Hauptübung', async () => {
  // Das ist der Fehler aus dem Review — hier als Test festgenagelt.
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAktivitaet(state, { name: 'Kurzhantel-Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);

  const e = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', e.id, bank.id);
  addZuZyklus(state, 'kraft', e.id);

  const { m: kraft } = modul(erstelleKraftModul, state);
  await kraft.actions['k.start']({ einheit: e.id });
  const seg = state.sessions[0].segmente[0];
  await kraft.actions['k.altWahl']({ seg: seg.id, alt: kh.id });

  const html = kraft.heuteHtml();
  assert.match(html, /Kurzhantel-Bankdrücken/, 'die benutzte Alternative muss dastehen');
});

test('Smoke Kraft: Plan- und Fortschritts-Ansicht rendern mit Inhalt', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const e = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', e.id, bank.id);
  addZuZyklus(state, 'kraft', e.id);

  const alt = neueSession({ datum: '2026-01-05' });
  alt.modul = 'kraft'; alt.abgeschlossen = true;
  const seg = addSegment(alt, neuesSegment(bank.id));
  seg.erledigt = true;
  addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 8 }));
  state.sessions.push(alt);

  const { m: kraft } = modul(erstelleKraftModul, state);
  assert.match(kraft.planHtml(), /Push A/);
  // Die Übungen einer Einheit stehen erst im HTML, wenn die Karte aufgeklappt
  // ist — also aufklappen wie der Nutzer und dann nachsehen.
  assert.doesNotMatch(kraft.planHtml(), /Bankdrücken/, 'zugeklappt: nur der Name der Einheit');
  kraft.actions['k.planAuf']({ einheit: e.id });
  assert.match(kraft.planHtml(), /Bankdrücken/, 'aufgeklappt: die Übungen der Einheit');
  assert.match(kraft.fortschrittHtml(), /Bankdrücken/);
});

// ==================================================================
// Touren-Module: jedes muss seine EIGENE Sprache sprechen
// ==================================================================

test('Smoke Touren: Rad rechnet in km, Schwimmen in Bahnen', () => {
  const state = leererZustand();
  tour(state, 'rad', 'Radfahren', { distanz: 24300, dauer: 3600 }, { name: 'Hausrunde' });
  tour(state, 'schwimmen', 'Schwimmen', { bahnen: 20, dauer: 1800 }, { name: 'Hallenbad' });

  const radHtml = modul(erstelleRadModul, state).m.heuteHtml();
  assert.match(radHtml, /Hausrunde/);
  assert.match(radHtml, /24,3/, 'Meter werden als km angezeigt');
  assert.doesNotMatch(radHtml, /Bahnen/);

  const schwimmHtml = modul(erstelleSchwimmModul, state).m.heuteHtml();
  assert.match(schwimmHtml, /Hallenbad/);
  assert.match(schwimmHtml, /20/);
  assert.match(schwimmHtml, /Bahnen/, 'Schwimmen zählt in Bahnen, nicht in km');
  assert.doesNotMatch(schwimmHtml, /Hausrunde/, 'die Radtour hat hier nichts verloren');
});

test('Smoke Touren: Statistik-Ansicht rendert je Modul mit eigenen Kennzahlen', () => {
  const state = leererZustand();
  tour(state, 'rad', 'Radfahren', { distanz: 24300, dauer: 3600, hoehenmeter: 210 });
  tour(state, 'wandern', 'Wandern', { distanz: 8100, dauer: 7200, hoehenmeter: 340 });
  tour(state, 'schwimmen', 'Schwimmen', { bahnen: 20, dauer: 1800 });

  assert.match(modul(erstelleRadModul, state).m.statistikHtml(), /24,3|24/);
  assert.match(modul(erstelleWanderModul, state).m.statistikHtml(), /8,1|8/);
  assert.match(modul(erstelleSchwimmModul, state).m.statistikHtml(), /Bahnen/);
});

test('Smoke Touren: leerer Zustand zeigt einen Hinweis statt einer leeren Seite', () => {
  const state = leererZustand();
  for (const fabrik of [erstelleRadModul, erstelleWanderModul, erstelleSchwimmModul]) {
    const html = modul(fabrik, state).m.heuteHtml();
    assert.ok(html.trim().length > 40, 'auch leer darf die Seite nicht leer sein');
  }
});

// ==================================================================
// Körper & Challenge
// ==================================================================

test('Smoke Körper: letzter Wert samt Einheit steht im HTML', () => {
  const state = leererZustand();
  setzeMessung(state, '2026-07-01', { gewicht: 92.4 });
  setzeMessung(state, HEUTE, { gewicht: 90.1 });

  const html = modul(erstelleKoerperModul, state).m.heuteHtml();
  assert.match(html, /90,1/, 'der jüngste Wert, deutsch formatiert');
  assert.match(html, /kg/);
});

test('Smoke Challenge: Ziel zeigt Ist, Soll und Einheit', () => {
  const state = leererZustand();
  tour(state, 'rad', 'Radfahren', { distanz: 30000, dauer: 3600 });
  state.challenges.push({ id: 'z1', was: 'rad_km', zielwert: 100, zeitraum: 'monat' });

  const html = modul(erstelleChallengeModul, state).m.heuteHtml();
  assert.match(html, /Rad-Kilometer/);
  assert.match(html, /100/, 'der Zielwert');
  assert.match(html, /km/);
});

// ==================================================================
// Querschnitt: kein Modul darf Platzhalter-Müll ausspucken
// ==================================================================

test('Smoke: keine Ansicht zeigt undefined, NaN oder [object Object]', () => {
  // Ein voller Zustand, an dem jedes Modul etwas zu zeigen hat.
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const e = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', e.id, bank.id);
  addZuZyklus(state, 'kraft', e.id);
  const ks = neueSession({ datum: '2026-01-05' });
  ks.modul = 'kraft'; ks.abgeschlossen = true;
  const kseg = addSegment(ks, neuesSegment(bank.id));
  kseg.erledigt = true;
  addEintrag(kseg, neuerEintrag({ gewicht: 80, wdh: 8 }));
  state.sessions.push(ks);

  tour(state, 'rad', 'Radfahren', { distanz: 24300, dauer: 3600, hoehenmeter: 210 });
  tour(state, 'wandern', 'Wandern', { distanz: 8100, dauer: 7200, hoehenmeter: 340 });
  tour(state, 'schwimmen', 'Schwimmen', { bahnen: 20, dauer: 1800, bahnlaenge: 25 });
  setzeMessung(state, HEUTE, { gewicht: 90.1 });
  state.challenges.push({ id: 'z1', was: 'rad_km', zielwert: 100, zeitraum: 'monat' });

  const kraft = modul(erstelleKraftModul, state).m;
  const ansichten = {
    'kraft/heute': kraft.heuteHtml(),
    'kraft/plan': kraft.planHtml(),
    'kraft/fortschritt': kraft.fortschrittHtml(),
    'rad/heute': modul(erstelleRadModul, state).m.heuteHtml(),
    'rad/statistik': modul(erstelleRadModul, state).m.statistikHtml(),
    'wandern/heute': modul(erstelleWanderModul, state).m.heuteHtml(),
    'wandern/statistik': modul(erstelleWanderModul, state).m.statistikHtml(),
    'schwimmen/heute': modul(erstelleSchwimmModul, state).m.heuteHtml(),
    'schwimmen/statistik': modul(erstelleSchwimmModul, state).m.statistikHtml(),
    'koerper/heute': modul(erstelleKoerperModul, state).m.heuteHtml(),
    'challenge/heute': modul(erstelleChallengeModul, state).m.heuteHtml(),
  };

  for (const [name, html] of Object.entries(ansichten)) {
    assert.ok(html.length > 40, `${name} rendert überhaupt etwas`);
    for (const muell of ['undefined', 'NaN', '[object Object]', 'null']) {
      assert.ok(!html.includes(muell), `${name} zeigt „${muell}"`);
    }
  }
});
