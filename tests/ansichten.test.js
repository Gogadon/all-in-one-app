// ============================================================
// tests/ansichten.test.js — die aus app.js herausgelösten Ansichten.
//
// Solange Tages-Sheet, Kalender und Datenseite in app.js steckten, waren sie
// nicht prüfbar: app.js fasst beim Laden das DOM an und lässt sich in Node gar
// nicht erst importieren. Genau deshalb konnte dort ein Anzeigefehler wohnen
// („Wanderung" für jede Schwimmeinheit), ohne dass ein Test etwas merkte.
// Jetzt sind es Funktionen mit Argumenten — und damit prüfbar.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installiereBrowserAttrappe } from './helpers/umgebung.js';

installiereBrowserAttrappe();

const { leererZustand } = await import('../js/core/storage.js');
const { neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag,
  neuerTermin, markiereAusfall } = await import('../js/core/model.js');
const { addAktivitaet, addAlternative } = await import('../js/core/library.js');
const { addEinheit, addAktivitaetZuEinheit } = await import('../js/core/plan.js');
const { tagSheetHtml, kalenderStreifenHtml, kalenderMonatHtml, langesDatum, kalPunkte } =
  await import('../js/views/kalender-ansicht.js');
const { datenHtml, exportStatusText } = await import('../js/views/daten-ansicht.js');
const { erledigteSegmentZeilen } = await import('../js/views/session-zeilen.js');

const HEUTE = new Date().toISOString().slice(0, 10);
const tagPlus = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Fertige Session eines Moduls in den Zustand legen. */
function session(state, { datum, modul, aktName, messwerte, name, altOf = null, ausPlan }) {
  const akt = addAktivitaet(state, {
    name: aktName, kategorie: modul, messwerte: Object.keys(messwerte),
  });
  const s = neueSession({ datum });
  s.modul = modul;
  s.abgeschlossen = true;
  if (name) s.name = name;
  if (ausPlan) s.ausPlan = ausPlan;
  const seg = addSegment(s, neuesSegment(akt.id, { altOf }));
  seg.erledigt = true;
  addEintrag(seg, neuerEintrag(messwerte));
  state.sessions.push(s);
  return { session: s, aktivitaet: akt, segment: seg };
}

// ==================================================================
// Tages-Sheet
// ==================================================================

test('Tages-Sheet: jede Sportart trägt ihren eigenen Namen', () => {
  // Der Fehler von damals: eine Tabelle kannte Schwimmen nicht, also hieß
  // jede Schwimmeinheit „Wanderung".
  const state = leererZustand();
  session(state, { datum: HEUTE, modul: 'schwimmen', aktName: 'Schwimmen', messwerte: { bahnen: 20, dauer: 1800 } });
  session(state, { datum: HEUTE, modul: 'rad', aktName: 'Radfahren', messwerte: { distanz: 24300, dauer: 3600 }, name: 'Hausrunde' });

  const html = tagSheetHtml(state, HEUTE);
  assert.match(html, /Schwimmeinheit/, 'die Schwimmeinheit heißt nach ihrem Modul');
  assert.doesNotMatch(html, /Wanderung/, 'und ganz sicher nicht Wanderung');
  assert.match(html, /Hausrunde/, 'ein eigener Name schlägt den Standardnamen');
  assert.match(html, /24,3 km/, 'die Distanz steht daneben');
});

test('Tages-Sheet: Kraft-Session heißt nach ihrer Einheit, sonst „Freie Session"', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const e = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', e.id, bank.id);

  const frei = leererZustand();
  session(frei, { datum: HEUTE, modul: 'kraft', aktName: 'Bankdrücken', messwerte: { gewicht: 80, wdh: 8 } });
  assert.match(tagSheetHtml(frei, HEUTE), /Freie Session/);

  const s = neueSession({ datum: HEUTE });
  s.modul = 'kraft'; s.abgeschlossen = true; s.ausPlan = e.id;
  const seg = addSegment(s, neuesSegment(bank.id));
  seg.erledigt = true;
  addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 8 }));
  state.sessions.push(s);

  const html = tagSheetHtml(state, HEUTE);
  assert.match(html, /Push A/);
  assert.match(html, /640 kg/, 'das bewegte Volumen steht daneben');
});

test('Tages-Sheet: aufgeklappte Zeile zeigt die benutzte Alternative', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAktivitaet(state, { name: 'Kurzhantel-Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);

  const s = neueSession({ datum: HEUTE });
  s.modul = 'kraft'; s.abgeschlossen = true;
  const seg = addSegment(s, neuesSegment(bank.id, { altOf: kh.id }));
  seg.erledigt = true;
  addEintrag(seg, neuerEintrag({ gewicht: 32.5, wdh: 10 }));
  state.sessions.push(s);

  assert.doesNotMatch(tagSheetHtml(state, HEUTE), /Kurzhantel-Bank/, 'zugeklappt: nur die Kopfzeile');
  const auf = tagSheetHtml(state, HEUTE, { offen: new Set([s.id]) });
  assert.match(auf, /Kurzhantel-Bank/, 'aufgeklappt: die benutzte Alternative');
  assert.doesNotMatch(auf, /Bankdrücken/, 'nicht die Hauptübung');
});

test('Tages-Sheet: Vergangenheit, Heute und Zukunft zeigen Verschiedenes', () => {
  const state = leererZustand();

  const zukunft = tagSheetHtml(state, tagPlus(5));
  assert.match(zukunft, /Vorschau/);
  assert.match(zukunft, /Planung/);
  assert.doesNotMatch(zukunft, /Krank melden/, 'krank melden wäre in der Zukunft eine Vorhersage');

  const heute = tagSheetHtml(state, HEUTE);
  assert.match(heute, /Heute/);
  assert.match(heute, /Geplant/);
  assert.match(heute, /Krank melden/);

  const gestern = tagSheetHtml(state, tagPlus(-1));
  assert.match(gestern, /nichts eingetragen/);
  assert.match(gestern, /Krank melden/);
  assert.doesNotMatch(gestern, /Geplant|Planung/, 'Vergangenes plant man nicht mehr');
});

test('Tages-Sheet: Termine und Krankmeldung erscheinen', () => {
  const state = leererZustand();
  const morgen = tagPlus(1);
  state.termine.push(neuerTermin({ datum: morgen, modul: 'rad', notiz: 'Feierabendrunde' }));
  const html = tagSheetHtml(state, morgen);
  assert.match(html, /Feierabendrunde/);
  assert.match(html, /Rad/);

  markiereAusfall(state, tagPlus(-2), 'krank');
  const krank = tagSheetHtml(state, tagPlus(-2));
  assert.match(krank, /Krank gemeldet/);
  assert.match(krank, /Zurücknehmen/);
});

test('Tages-Sheet: der Kopf trägt das ausgeschriebene Datum', () => {
  assert.equal(langesDatum('2026-07-13'), 'Montag, 13. Juli 2026');
  assert.match(tagSheetHtml(leererZustand(), '2026-07-13'), /Montag, 13\. Juli 2026/);
});

// ==================================================================
// Kalender
// ==================================================================

test('Kalender: Streifen zeigt sieben Tage, Monatsraster volle Wochen', () => {
  const state = leererZustand();
  session(state, { datum: HEUTE, modul: 'rad', aktName: 'Radfahren', messwerte: { distanz: 10000, dauer: 1800 } });

  const streifen = kalenderStreifenHtml(state);
  assert.equal((streifen.match(/data-action="tag\.auf"/g) ?? []).length, 7);
  assert.match(streifen, /kal-tag heute/);
  assert.match(streifen, /punkt rad/, 'der gefahrene Tag bekommt einen Punkt');

  const monat = kalenderMonatHtml(state, HEUTE);
  const zellen = (monat.match(/data-action="tag\.auf"/g) ?? []).length;
  assert.equal(zellen % 7, 0, 'volle Wochen');
  assert.ok(zellen >= 28 && zellen <= 42);
});

test('Kalender: erledigt ist gefüllt, geplant ist Umriss, krank hat ein eigenes Zeichen', () => {
  assert.equal(kalPunkte([], [], null), '');
  assert.match(kalPunkte(['rad'], [], null), /class="punkt rad"/);
  assert.match(kalPunkte([], ['kraft'], null), /class="punkt umriss kraft"/);
  const krank = kalPunkte(['rad'], [], 'krank');
  assert.match(krank, /punkt ausfall krank/);
  assert.match(krank, /punkt rad/, 'wer trotz Erkältung radeln war, sieht beides');
});

// ==================================================================
// Datenseite
// ==================================================================

test('Datenseite: Export-Status in Worten', () => {
  const state = leererZustand();
  assert.match(exportStatusText(state), /noch nie/i);
  state.einstellungen.letzterExport = HEUTE;
  assert.match(exportStatusText(state), /heute/);
  state.einstellungen.letzterExport = tagPlus(-1);
  assert.match(exportStatusText(state), /gestern/);
  state.einstellungen.letzterExport = tagPlus(-9);
  assert.match(exportStatusText(state), /vor 9 Tagen/);
});

test('Datenseite: zeigt Umfang, Knöpfe und den Hinweis ohne Wiederherstellungspunkte', () => {
  const state = leererZustand();
  session(state, { datum: HEUTE, modul: 'rad', aktName: 'Radfahren', messwerte: { distanz: 10000, dauer: 1800 } });

  const html = datenHtml(state);
  assert.match(html, /1 Sessions · 1 Übungen/);
  assert.match(html, /data-action="daten\.export"/);
  assert.match(html, /data-action="daten\.import"/);
  assert.match(html, /data-action="daten\.reset"/);
  assert.match(html, /Noch keine Punkte/);
  for (const muell of ['undefined', 'NaN', '[object Object]']) {
    assert.ok(!html.includes(muell), `Datenseite zeigt „${muell}"`);
  }
});

// ==================================================================
// Session-Zeilen (gemeinsam von Kraft-Verlauf und Tages-Sheet genutzt)
// ==================================================================

test('Session-Zeilen: nur Abgehaktes, mit Alternativ-Namen', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAktivitaet(state, { name: 'Kurzhantel-Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);

  const s = neueSession({ datum: HEUTE });
  const erledigt = addSegment(s, neuesSegment(bank.id, { altOf: kh.id }));
  erledigt.erledigt = true;
  addEintrag(erledigt, neuerEintrag({ gewicht: 32.5, wdh: 10 }));
  const offen = addSegment(s, neuesSegment(bank.id));
  addEintrag(offen, neuerEintrag({ gewicht: 80, wdh: 8 }));

  const html = erledigteSegmentZeilen(state, s);
  assert.match(html, /Kurzhantel-Bank/);
  assert.doesNotMatch(html, /Bankdrücken/, 'das nicht abgehakte Segment fehlt');
  assert.equal((html.match(/verlauf-zeile/g) ?? []).length, 1);
});
