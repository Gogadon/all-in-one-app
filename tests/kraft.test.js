// ============================================================
// Tests für Schritt 3: Kraft-Logik + AKZEPTANZTEST
// Laufen mit:  node --test tests/*.test.js   (oder: npm test)
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MESSWERTE } from '../js/core/metrics.js';
import { leererZustand } from '../js/core/storage.js';
import {
  neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag,
} from '../js/core/model.js';
import { addAktivitaet, addAlternative } from '../js/core/library.js';
import {
  berechneVorschlag, bestVorTag, eintragPR, letzteSaetze, verlaufLetzte,
  prefillEintrag, identVon, segmentZusammenfassungKraft, segmentZusammenfassungWerte,
  sessionVolumenErledigt, fmtSatz, dauerInputWert, eintragInputsHtml, PROG_DEFAULTS,
  effektiveWdh, istEinarmig, satzVolumen, erstelleKraftModul,
} from '../js/modules/kraft.js';

const HEUTE = '2026-07-05';

/** Erledigte Session mit einer Übung + Sätzen anlegen. */
function session(state, datum, aktId, saetze, { altOf = null, erledigt = true } = {}) {
  const s = neueSession({ datum });
  const seg = addSegment(s, neuesSegment(aktId, { altOf }));
  seg.erledigt = erledigt;
  for (const [gewicht, wdh, warm] of saetze) {
    addEintrag(seg, neuerEintrag({ gewicht, wdh }, { flags: warm ? ['aufwaermsatz'] : [] }));
  }
  state.sessions.push(s);
  return s;
}

function welt() {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  return { state, bank };
}

// ==================================================================
test('Progression double: nur Sätze beim HÖCHSTEN Gewicht zählen (Gym-App-Regel)', () => {
  const { state, bank } = welt();
  const prog = { art: 'double' }; // Defaults: 4 Sätze, 8–12 Wdh, +2,5 kg

  // Gemischte Gewichte: 3× 80 kg @12 + 1× 77,5 @12 → NICHT fertig (nur 3 Top-Sätze)
  session(state, '2026-07-01', bank.id, [[77.5, 12], [80, 12], [80, 12], [80, 12]]);
  let v = berechneVorschlag(state, bank.id, prog, HEUTE);
  assert.equal(v.art, 'halten');
  assert.match(v.text, /80 kg halten/);

  // 4× 80 @12 → steigern auf 82,5
  const { state: s2, bank: b2 } = welt();
  session(s2, '2026-07-01', b2.id, [[40, 12, true], [80, 12], [80, 12], [80, 12], [80, 12]]);
  v = berechneVorschlag(s2, b2.id, prog, HEUTE);
  assert.equal(v.art, 'steigern');
  assert.equal(v.nextKg, 82.5);
  assert.match(v.text, /82,5 kg steigern/);

  // Aufwärmsatz mit höherem "Gewicht"? Aufwärmsätze fließen gar nicht ein.
  // off/technik:
  assert.equal(berechneVorschlag(s2, b2.id, { art: 'off' }, HEUTE), null);
  assert.equal(berechneVorschlag(s2, b2.id, null, HEUTE), null);
  assert.equal(berechneVorschlag(s2, b2.id, { art: 'technik' }, HEUTE).art, 'technik');
});

test('Progression strength: eigenes Ziel, eigene Defaults', () => {
  const { state, bank } = welt();
  session(state, '2026-07-01', bank.id, [[100, 12], [100, 12], [100, 12], [100, 12]]);
  const v = berechneVorschlag(state, bank.id, { art: 'strength', saetze: 4, wdh: 12, schritt: 5 }, HEUTE);
  assert.equal(v.nextKg, 105);
  // Noch nicht am Ziel:
  const { state: s2, bank: b2 } = welt();
  session(s2, '2026-07-01', b2.id, [[100, 12], [100, 11], [100, 12], [100, 12]]);
  assert.equal(berechneVorschlag(s2, b2.id, { art: 'strength' }, HEUTE).art, 'halten');
});

test('PR-Logik: Gewichts- und Wdh-Rekord, erste Session zählt nicht, Aufwärmen nie', () => {
  const { state, bank } = welt();

  // Noch keine Historie → kein PR
  const e0 = neuerEintrag({ gewicht: 80, wdh: 8 });
  assert.equal(eintragPR(state, bank.id, e0, HEUTE), null);

  session(state, '2026-06-20', bank.id, [[80, 8], [80, 7]]);
  session(state, '2026-06-28', bank.id, [[82.5, 6]]);

  assert.deepEqual(bestVorTag(state, bank.id, HEUTE), { maxKg: 82.5, wdhBeiMax: 6 });
  assert.equal(eintragPR(state, bank.id, neuerEintrag({ gewicht: 85, wdh: 5 }), HEUTE), 'gewicht');
  assert.equal(eintragPR(state, bank.id, neuerEintrag({ gewicht: 82.5, wdh: 7 }), HEUTE), 'wdh');
  assert.equal(eintragPR(state, bank.id, neuerEintrag({ gewicht: 82.5, wdh: 6 }), HEUTE), null);
  assert.equal(eintragPR(state, bank.id, neuerEintrag({ gewicht: 90, wdh: 10 }, { flags: ['aufwaermsatz'] }), HEUTE), null);
});

test('Historie zählt NUR erledigte Segmente (exCountsOnDay-Lektion aus der Gym-App)', () => {
  const { state, bank } = welt();
  session(state, '2026-06-20', bank.id, [[80, 8]], { erledigt: false }); // nicht abgehakt
  assert.equal(letzteSaetze(state, bank.id, HEUTE), null);
  session(state, '2026-06-25', bank.id, [[60, 10]]);
  assert.equal(letzteSaetze(state, bank.id, HEUTE).eintraege[0].messwerte.gewicht, 60);
});

test('Alternativen haben eigene Historie (identVon = altOf)', () => {
  const { state, bank } = welt();
  const kh = addAktivitaet(state, { name: 'KH-Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);
  session(state, '2026-06-20', bank.id, [[80, 8]]);                      // Hauptübung
  session(state, '2026-06-27', bank.id, [[32, 10]], { altOf: kh.id });   // Alternative

  const seg = neuesSegment(bank.id, { altOf: kh.id });
  assert.equal(identVon(seg), kh.id);
  assert.equal(letzteSaetze(state, kh.id, HEUTE).eintraege[0].messwerte.gewicht, 32);
  assert.equal(letzteSaetze(state, bank.id, HEUTE).eintraege[0].messwerte.gewicht, 80);
  assert.deepEqual(bestVorTag(state, kh.id, HEUTE), { maxKg: 32, wdhBeiMax: 10 });
});

test('Prefill & Verlauf: erster Arbeitssatz kommt wieder, Verlauf liefert letzte 4', () => {
  const { state, bank } = welt();
  for (const [d, kg] of [['2026-06-01', 70], ['2026-06-10', 72.5], ['2026-06-18', 75], ['2026-06-25', 77.5], ['2026-07-01', 80]]) {
    session(state, d, bank.id, [[kg * 0.5, 12, true], [kg, 8], [kg, 7]]);
  }
  const pf = prefillEintrag(state, bank.id, HEUTE);
  assert.deepEqual(pf.messwerte, { gewicht: 80, wdh: 8 });
  assert.equal(pf.quelle, 'prefill');

  const verlauf = verlaufLetzte(state, bank.id, 4, HEUTE);
  assert.equal(verlauf.length, 4);
  assert.equal(verlauf[0].datum, '2026-07-01'); // neueste zuerst
  assert.equal(fmtSatz(verlauf[0].segment.eintraege[0]), 'A 40×12');
  assert.equal(fmtSatz(verlauf[0].segment.eintraege[1]), '80×8');
});

test('Zusammenfassungen & Session-Volumen (nur erledigt, ohne Aufwärmen)', () => {
  const { state, bank } = welt();
  const s = session(state, HEUTE, bank.id, [[40, 12, true], [80, 8], [82.5, 6]]);
  assert.equal(segmentZusammenfassungKraft(s.segmente[0]), '3 Sätze · 1 Aufw. · 80–82,5 kg');
  assert.equal(sessionVolumenErledigt(s), 80 * 8 + 82.5 * 6);

  s.segmente[0].erledigt = false;
  assert.equal(sessionVolumenErledigt(s), 0); // nicht abgehakt → zählt nicht

  // Cardio-Zusammenfassung
  const laufband = addAktivitaet(state, { name: 'Laufband', kategorie: 'sonstiges', messwerte: ['dauer', 'puls_avg', 'puls_max'] });
  const seg = neuesSegment(laufband.id);
  addEintrag(seg, neuerEintrag({ dauer: 600, puls_avg: 110, puls_max: 128 }));
  assert.equal(segmentZusammenfassungWerte(laufband, seg), '10:00 min · Ø 110 bpm · max 128 bpm');
});

test('Dauer-Eingabefeld: Sekunden ↔ Anzeigewert', () => {
  assert.equal(dauerInputWert(5400), '1:30');
  assert.equal(dauerInputWert(2700), '45');
  assert.equal(dauerInputWert(null), '');
});

// ==================================================================
// ★ AKZEPTANZTEST (Pflicht aus dem Konzept):
// Ein neuer Messwert-Typ muss automatisch in BEIDEN Kontexten
// auftauchen — reine Cardio-Session UND Cardio-Segment im
// Kraft-Tag — weil beide durch eintragInputsHtml() laufen.
// ==================================================================
test('★ AKZEPTANZTEST: ein Eingabe-Pfad für Cardio solo und Cardio im Kraft-Tag', () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  // "Neuer" Messwert simuliert: kalorien war bisher nirgends im UI verdrahtet —
  // er steht NUR in der Registry und in aktivitaet.messwerte:
  const mwListe = ['dauer', 'puls_avg', 'puls_max', 'kalorien'];
  const ebike = addAktivitaet(state, { name: 'E-Bike', kategorie: 'rad', messwerte: mwListe });
  const laufband = addAktivitaet(state, { name: 'Laufband', kategorie: 'sonstiges', messwerte: mwListe });

  // Kontext A: reine Cardio-Session
  const a = neueSession({ datum: HEUTE });
  const segA = addSegment(a, neuesSegment(ebike.id));
  const eA = addEintrag(segA, neuerEintrag({ dauer: 2400 }));

  // Kontext B: Cardio-Segment im Kraft-Tag
  const b = neueSession({ datum: HEUTE });
  addSegment(b, neuesSegment(bank.id));
  const segB = addSegment(b, neuesSegment(laufband.id));
  const eB = addEintrag(segB, neuerEintrag({}));

  const htmlA = eintragInputsHtml(ebike, segA, eA);
  const htmlB = eintragInputsHtml(laufband, segB, eB);

  // JEDER Messwert der Aktivität erscheint in BEIDEN Kontexten als Eingabefeld:
  for (const typ of mwListe) {
    assert.ok(htmlA.includes(`data-typ="${typ}"`), `A: ${typ} fehlt`);
    assert.ok(htmlB.includes(`data-typ="${typ}"`), `B: ${typ} fehlt`);
  }
  // Kraftsätze laufen durch DIESELBE Funktion:
  const segK = b.segmente[0];
  const eK = addEintrag(segK, neuerEintrag({ gewicht: 80, wdh: 8 }));
  const htmlK = eintragInputsHtml(bank, segK, eK);
  assert.ok(htmlK.includes('data-typ="gewicht"') && htmlK.includes('data-typ="wdh"'));

  // Und die Registry ist die einzige Quelle der Feld-Definitionen:
  for (const typ of mwListe) assert.ok(MESSWERTE[typ], `${typ} in Registry`);
});

test('PROG_DEFAULTS entsprechen der Gym-App (4 Sätze, 8–12, +2,5 / 4×12, +2,5)', () => {
  assert.deepEqual(PROG_DEFAULTS.double, { saetze: 4, wdhMin: 8, wdhMax: 12, schritt: 2.5 });
  assert.deepEqual(PROG_DEFAULTS.strength, { saetze: 4, wdh: 12, schritt: 2.5 });
});

// ==================================================================
// 3b: EINARMIG (L/R) & ASSISTIERT (negatives Gewicht)
// ==================================================================

function sessMit(state, datum, aktId, saetze, { erledigt = true } = {}) {
  const s = neueSession({ datum });
  const seg = addSegment(s, neuesSegment(aktId)); seg.erledigt = erledigt;
  for (const mw of saetze) addEintrag(seg, neuerEintrag(mw));
  state.sessions.push(s); return s;
}

test('Einarmig: effektiveWdh = schwächere Seite, Volumen = L+R, fmtSatz L/R', () => {
  const e = neuerEintrag({ gewicht: 32.5, wdh_l: 11, wdh_r: 12 });
  assert.equal(istEinarmig(e), true);
  assert.equal(effektiveWdh(e), 11);
  assert.equal(satzVolumen(e), 32.5 * 23);
  assert.equal(fmtSatz(e), '32,5×11/12');
});

test('Einarmig: steigern erst wenn BEIDE Seiten das Ziel schaffen', () => {
  const state = leererZustand();
  const r = addAktivitaet(state, { name: 'Rudern', kategorie: 'kraft', messwerte: ['gewicht', 'wdh_l', 'wdh_r'] });
  sessMit(state, '2026-07-01', r.id, [
    { gewicht: 32.5, wdh_l: 11, wdh_r: 12 }, { gewicht: 32.5, wdh_l: 11, wdh_r: 12 },
    { gewicht: 32.5, wdh_l: 12, wdh_r: 12 }, { gewicht: 32.5, wdh_l: 12, wdh_r: 12 },
  ]);
  assert.equal(berechneVorschlag(state, r.id, { art: 'double' }, HEUTE).art, 'halten');

  const s2 = leererZustand();
  const r2 = addAktivitaet(s2, { name: 'R', kategorie: 'kraft', messwerte: ['gewicht', 'wdh_l', 'wdh_r'] });
  sessMit(s2, '2026-07-01', r2.id, [
    { gewicht: 32.5, wdh_l: 12, wdh_r: 12 }, { gewicht: 32.5, wdh_l: 12, wdh_r: 12 },
    { gewicht: 32.5, wdh_l: 12, wdh_r: 13 }, { gewicht: 32.5, wdh_l: 12, wdh_r: 12 },
  ]);
  const v = berechneVorschlag(s2, r2.id, { art: 'double' }, HEUTE);
  assert.equal(v.art, 'steigern');
  assert.equal(v.nextKg, 35);
});

test('Einarmig: PR über schwächere Seite, Prefill übernimmt L/R', () => {
  const state = leererZustand();
  const r = addAktivitaet(state, { name: 'R', kategorie: 'kraft', messwerte: ['gewicht', 'wdh_l', 'wdh_r'] });
  sessMit(state, '2026-06-20', r.id, [{ gewicht: 32.5, wdh_l: 10, wdh_r: 11 }]);
  assert.deepEqual(bestVorTag(state, r.id, HEUTE), { maxKg: 32.5, wdhBeiMax: 10 });
  assert.equal(eintragPR(state, r.id, neuerEintrag({ gewicht: 32.5, wdh_l: 11, wdh_r: 11 }), HEUTE), 'wdh');
  assert.deepEqual(prefillEintrag(state, r.id, HEUTE).messwerte, { gewicht: 32.5, wdh_l: 10, wdh_r: 11 });
});

test('Assistiert: negatives Gewicht trägt 0 zum Volumen, weniger Hilfe = Fortschritt', () => {
  const e = neuerEintrag({ gewicht: -15, wdh: 12 });
  assert.equal(satzVolumen(e), 0);
  assert.equal(fmtSatz(e), '-15×12');

  const state = leererZustand();
  const d = addAktivitaet(state, { name: 'Dips', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  sessMit(state, '2026-07-01', d.id, [
    { gewicht: -15, wdh: 12 }, { gewicht: -15, wdh: 12 }, { gewicht: -15, wdh: 12 }, { gewicht: -15, wdh: 12 },
  ]);
  const v = berechneVorschlag(state, d.id, { art: 'double' }, HEUTE);
  assert.equal(v.art, 'steigern');
  assert.equal(v.nextKg, -12.5); // weniger Hilfe
});

test('Assistiert: weniger Hilfe und Übergang zu Zusatzgewicht sind PRs', () => {
  const state = leererZustand();
  const d = addAktivitaet(state, { name: 'D', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  sessMit(state, '2026-06-20', d.id, [{ gewicht: -15, wdh: 10 }]);
  assert.equal(eintragPR(state, d.id, neuerEintrag({ gewicht: -12.5, wdh: 8 }), HEUTE), 'gewicht');
  assert.equal(eintragPR(state, d.id, neuerEintrag({ gewicht: 5, wdh: 5 }), HEUTE), 'gewicht');
  const s = sessMit(state, '2026-07-05', d.id, [{ gewicht: -12.5, wdh: 10 }]);
  assert.equal(sessionVolumenErledigt(s), 0);
});

test('Alternative aus Bibliothek wählen (Etappe 3): verknüpfen + neu anlegen', async () => {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const chest = addAktivitaet(state, { name: 'Chest Press', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  let sheetInhalt = '';
  const ctx = {
    get state() { return state; }, save: async () => {}, render: () => {},
    sheet: { oeffne(h) { sheetInhalt = h; }, schliesse() { sheetInhalt = ''; }, aktualisiere(h) { sheetInhalt = h; } },
    esc: t => String(t ?? ''), formatDatum: i => i, tabWechsel: () => {},
  };
  const k = erstelleKraftModul(ctx);

  // Bestehende Übung als Alternative
  k.actions['k.altWaehlen']({ akt: bank.id });
  assert.ok(sheetInhalt.includes('Alternative wählen'));
  assert.ok(!sheetInhalt.includes(`data-akt="${bank.id}"`), 'Basis nicht wählbar');
  await k.actions['k.waehle']({ akt: chest.id });
  assert.deepEqual(bank.alternativen, [chest.id]);

  // Schon verlinkte ausgeblendet
  k.actions['k.altWaehlen']({ akt: bank.id });
  assert.ok(!sheetInhalt.includes('Chest Press'));

  // Neue Übung als Alternative anlegen
  k.actions['k.altWaehlen']({ akt: bank.id });
  k.actions['k.suche']({}, { value: 'Kurzhantel-Bank' });
  await k.actions['k.neu']({ kat: 'kraft' });
  const neu = state.bibliothek.find(a => a.name === 'Kurzhantel-Bank');
  assert.ok(neu && bank.alternativen.includes(neu.id));
});

// ==================================================================
// Invariante: höchstens EINE Kraft-Session pro Kalendertag
// ==================================================================

test('Kraft: pro Tag ist nur eine Einheit erlaubt', async () => {
  const { kannKraftSessionStarten, kraftSessionAmTag } = await import('../js/modules/kraft.js');
  const state = leererZustand();
  const TAG = '2026-08-08';

  assert.equal(kannKraftSessionStarten(state, TAG), true);
  assert.equal(kraftSessionAmTag(state, TAG), null);

  const s = neueSession({ datum: TAG }); s.modul = 'kraft';
  state.sessions.push(s);
  assert.equal(kannKraftSessionStarten(state, TAG), false);
  assert.equal(kraftSessionAmTag(state, TAG)?.id, s.id);

  // Auch eine bereits ABGESCHLOSSENE blockiert — sonst käme abends eine zweite dazu
  s.abgeschlossen = true;
  assert.equal(kannKraftSessionStarten(state, TAG), false);

  // Andere Tage bleiben frei
  assert.equal(kannKraftSessionStarten(state, '2026-08-09'), true);
});

test('Kraft: übersprungene Tage blockieren nicht', async () => {
  const { kannKraftSessionStarten } = await import('../js/modules/kraft.js');
  const state = leererZustand();
  const s = neueSession({ datum: '2026-08-08' });
  s.modul = 'kraft'; s.uebersprungen = true;
  state.sessions.push(s);
  // Übersprungen ist das Gegenteil einer Einheit — danach darf man loslegen
  assert.equal(kannKraftSessionStarten(state, '2026-08-08'), true);
});

test('Kraft: Alt-Session ohne modul-Feld zählt als Kraft', async () => {
  const { kannKraftSessionStarten } = await import('../js/modules/kraft.js');
  const state = leererZustand();
  state.sessions.push(neueSession({ datum: '2026-08-08' }));   // kein .modul
  assert.equal(kannKraftSessionStarten(state, '2026-08-08'), false);
});

// ==================================================================
// Vorschlag vs. getippter Wert beim Wechsel auf eine Alternative
// ==================================================================

test('nurVorschlaege: nur unberührte Prefill-Sätze zählen', async () => {
  const { nurVorschlaege } = await import('../js/modules/kraft.js');
  assert.equal(nurVorschlaege({ eintraege: [] }), false, 'leer ist kein Vorschlag');
  assert.equal(nurVorschlaege({ eintraege: [neuerEintrag({ gewicht: 80 }, { quelle: 'prefill' })] }), true);
  assert.equal(nurVorschlaege({ eintraege: [neuerEintrag({ gewicht: 80 })] }), false, 'manuell zählt nicht');
  assert.equal(nurVorschlaege({
    eintraege: [neuerEintrag({}, { quelle: 'prefill' }), neuerEintrag({ gewicht: 80 })],
  }), false, 'ein getippter Satz reicht');
});

test('Alternativ-Wechsel: Vorschlag wird ersetzt, getippte Werte bleiben', async () => {
  const { erstelleKraftModul, nurVorschlaege } = await import('../js/modules/kraft.js');
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAktivitaet(state, { name: 'KH-Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const chest = addAktivitaet(state, { name: 'Chest Press', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);
  addAlternative(state, bank.id, chest.id);

  const heute = new Date().toISOString().slice(0, 10);
  session(state, '2026-01-02', bank.id, [[80, 8]]);                    // Historie Hauptübung
  session(state, '2026-01-09', kh.id, [[32, 10]], { altOf: kh.id });   // Historie Alternative

  const heuteSession = neueSession({ datum: heute });
  heuteSession.modul = 'kraft';
  const seg = addSegment(heuteSession, neuesSegment(bank.id));
  state.sessions.push(heuteSession);

  const ctx = {
    get state() { return state; }, save: async () => {}, render: () => {},
    sheet: { oeffne() {}, schliesse() {}, aktualisiere() {} },
    esc: t => String(t ?? ''), formatDatum: i => i, tabWechsel: () => {},
  };
  const k = erstelleKraftModul(ctx);
  // k.wert frischt die Volumen-Anzeige direkt im DOM auf — hier reicht ein Stub.
  globalThis.document = { getElementById: () => null };

  // Startzustand: Vorschlag aus der Historie der Hauptübung
  addEintrag(seg, prefillEintrag(state, bank.id, heute));
  assert.deepEqual(seg.eintraege[0].messwerte, { gewicht: 80, wdh: 8 });
  assert.equal(nurVorschlaege(seg), true);

  // → Alternative MIT Historie: deren eigener Vorschlag
  await k.actions['k.altWahl']({ seg: seg.id, alt: kh.id });
  assert.equal(seg.eintraege.length, 1);
  assert.deepEqual(seg.eintraege[0].messwerte, { gewicht: 32, wdh: 10 });

  // → Alternative OHNE Historie: leeres Feld statt fremder Zahlen
  await k.actions['k.altWahl']({ seg: seg.id, alt: chest.id });
  assert.deepEqual(seg.eintraege[0].messwerte, {});

  // Getippter Wert überlebt den Wechsel zurück auf die Hauptübung
  await k.actions['k.wert']({ seg: seg.id, eintrag: seg.eintraege[0].id, typ: 'gewicht' }, { value: '45' });
  assert.equal(seg.eintraege[0].quelle, 'manuell');
  await k.actions['k.altWahl']({ seg: seg.id, alt: '' });
  assert.equal(seg.altOf, null);
  assert.equal(seg.eintraege[0].messwerte.gewicht, 45, 'getippte Werte bleiben stehen');
});

test('Progressionsart umschalten: gleiche Art behält die Werte, andere Art startet frisch', async () => {
  const { erstelleKraftModul, PROG_DEFAULTS } = await import('../js/modules/kraft.js');
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });

  const ctx = {
    get state() { return state; }, save: async () => {}, render: () => {},
    sheet: { oeffne() {}, schliesse() {}, aktualisiere() {} },
    esc: t => String(t ?? ''), formatDatum: i => i, tabWechsel: () => {},
  };
  const k = erstelleKraftModul(ctx);

  // Erstmal einschalten → Standardwerte der Art, und `art` ist gesetzt.
  await k.actions['k.progArt']({ akt: bank.id, art: 'double' });
  assert.equal(bank.einstellungen.prog.art, 'double');
  assert.equal(bank.einstellungen.prog.schritt, PROG_DEFAULTS.double.schritt);

  // Eigener Wert bleibt beim erneuten Wählen DERSELBEN Art erhalten.
  bank.einstellungen.prog.schritt = 1.25;
  await k.actions['k.progArt']({ akt: bank.id, art: 'double' });
  assert.equal(bank.einstellungen.prog.schritt, 1.25, 'eigener Schritt überlebt');
  assert.equal(bank.einstellungen.prog.art, 'double');

  // Andere Art → deren Standardwerte, und `art` zeigt wirklich die neue Art.
  await k.actions['k.progArt']({ akt: bank.id, art: 'strength' });
  assert.equal(bank.einstellungen.prog.art, 'strength', 'art wird nicht überschrieben');
  assert.equal(bank.einstellungen.prog.wdh, PROG_DEFAULTS.strength.wdh);
  assert.equal(bank.einstellungen.prog.schritt, PROG_DEFAULTS.strength.schritt);

  // Ausschalten entfernt die Einstellung ganz.
  await k.actions['k.progArt']({ akt: bank.id, art: 'off' });
  assert.equal(bank.einstellungen.prog, undefined);
});

// ==================================================================
// „Nicht sauber": Doppelprogression braucht vergleichbare Wiederholungen
// ==================================================================

test('Doppelprogression: 4×12 sauber → steigern', () => {
  const { state, bank } = welt();
  session(state, '2026-07-01', bank.id, [[80, 12], [80, 12], [80, 12], [80, 12]]);
  const v = berechneVorschlag(state, bank.id, { art: 'double' }, HEUTE);
  assert.equal(v.art, 'steigern');
  assert.equal(v.nextKg, 82.5);
});

test('Doppelprogression: ein unsauberer Satz hält das Gewicht — und sagt warum', async () => {
  const { hatFlag } = await import('../js/core/model.js');
  const { state, bank } = welt();
  const s = neueSession({ datum: '2026-07-01' });
  const seg = addSegment(s, neuesSegment(bank.id));
  seg.erledigt = true;
  for (let i = 0; i < 4; i++) {
    // Der letzte Satz: zwölf geschafft, aber die letzte Wdh war gegrindet.
    addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 12 }, { flags: i === 3 ? ['unsauber'] : [] }));
  }
  state.sessions.push(s);

  const v = berechneVorschlag(state, bank.id, { art: 'double' }, HEUTE);
  assert.equal(v.art, 'halten', 'nicht steigern');
  assert.equal(v.grund, 'unsauber');
  assert.match(v.text, /80 kg halten/);
  assert.match(v.text, /12 erreicht/, 'die Zahlen werden anerkannt');
  assert.match(v.text, /ein Satz war nicht sauber/, 'und der Grund benannt');

  // Zurücknehmen → wieder steigern.
  seg.eintraege[3].flags = [];
  assert.equal(berechneVorschlag(state, bank.id, { art: 'double' }, HEUTE).art, 'steigern');
  assert.equal(hatFlag(seg.eintraege[3], 'unsauber'), false);
});

test('Nicht sauber: mehrere Sätze werden richtig gezählt', () => {
  const { state, bank } = welt();
  const s = neueSession({ datum: '2026-07-01' });
  const seg = addSegment(s, neuesSegment(bank.id));
  seg.erledigt = true;
  for (let i = 0; i < 4; i++) {
    addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 12 }, { flags: i >= 2 ? ['unsauber'] : [] }));
  }
  state.sessions.push(s);
  assert.match(berechneVorschlag(state, bank.id, { art: 'double' }, HEUTE).text, /2 Sätze waren nicht sauber/);
});

test('Nicht sauber: gilt auch für die Strength-Progression', () => {
  const { state, bank } = welt();
  const s = neueSession({ datum: '2026-07-01' });
  const seg = addSegment(s, neuesSegment(bank.id));
  seg.erledigt = true;
  for (let i = 0; i < 4; i++) {
    addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 12 }, { flags: i === 0 ? ['unsauber'] : [] }));
  }
  state.sessions.push(s);
  assert.equal(berechneVorschlag(state, bank.id, { art: 'strength' }, HEUTE).art, 'halten');
});

test('Nicht sauber: die Arbeit zählt weiter fürs Volumen', () => {
  const { state, bank } = welt();
  const s = neueSession({ datum: '2026-07-01' });
  const seg = addSegment(s, neuesSegment(bank.id));
  seg.erledigt = true;
  addEintrag(seg, neuerEintrag({ gewicht: 80, wdh: 10 }, { flags: ['unsauber'] }));
  state.sessions.push(s);
  // Der Satz war da, also zählt er — markiert ist nur die Aussagekraft fürs Ziel.
  assert.equal(sessionVolumenErledigt(s), 800);
});

test('Nicht sauber: im Satz-Text sichtbar, Aufwärmsatz bleibt daneben lesbar', () => {
  const roh = neuerEintrag({ gewicht: 80, wdh: 12 });
  assert.equal(fmtSatz(roh), '80×12');
  assert.equal(fmtSatz(neuerEintrag({ gewicht: 80, wdh: 12 }, { flags: ['unsauber'] })), '80×12~');
  assert.equal(fmtSatz(neuerEintrag({ gewicht: 40, wdh: 12 }, { flags: ['aufwaermsatz'] })), 'A 40×12');
});

test('Satz-Art: ein Knopf schaltet normal → Aufwärmsatz → nicht sauber → normal', async () => {
  const { erstelleKraftModul } = await import('../js/modules/kraft.js');
  const { hatFlag } = await import('../js/core/model.js');
  const { addEinheit, addAktivitaetZuEinheit, addZuZyklus } = await import('../js/core/plan.js');
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const e = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', e.id, bank.id);
  addZuZyklus(state, 'kraft', e.id);

  const ctx = {
    get state() { return state; }, save: async () => {}, render: () => {},
    sheet: { oeffne() {}, schliesse() {}, aktualisiere() {} },
    esc: t => String(t ?? ''), formatDatum: i => i, tabWechsel: () => {},
  };
  const k = erstelleKraftModul(ctx);
  await k.actions['k.start']({ einheit: e.id });
  const seg = state.sessions[0].segmente[0];
  const satz = seg.eintraege[0];
  const art = () => [hatFlag(satz, 'aufwaermsatz'), hatFlag(satz, 'unsauber')];
  const schalten = () => k.actions['k.satzArt']({ seg: seg.id, eintrag: satz.id });

  assert.deepEqual(art(), [false, false], 'Start: normaler Satz');
  await schalten();
  assert.deepEqual(art(), [true, false], '1× → Aufwärmsatz');
  await schalten();
  assert.deepEqual(art(), [false, true], '2× → nicht sauber');
  await schalten();
  assert.deepEqual(art(), [false, false], '3× → wieder normal');

  // Nie beides gleichzeitig, egal wie oft man tippt.
  for (let i = 0; i < 7; i++) {
    await schalten();
    assert.ok(!(hatFlag(satz, 'aufwaermsatz') && hatFlag(satz, 'unsauber')),
      'Aufwärmsatz und „nicht sauber" schließen sich aus');
  }
});

test('Satz-Art: andere Flags bleiben beim Umschalten erhalten', async () => {
  const { erstelleKraftModul } = await import('../js/modules/kraft.js');
  const { hatFlag } = await import('../js/core/model.js');
  const { addEinheit, addAktivitaetZuEinheit, addZuZyklus } = await import('../js/core/plan.js');
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const e = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', e.id, bank.id);
  addZuZyklus(state, 'kraft', e.id);
  const ctx = {
    get state() { return state; }, save: async () => {}, render: () => {},
    sheet: { oeffne() {}, schliesse() {}, aktualisiere() {} },
    esc: t => String(t ?? ''), formatDatum: i => i, tabWechsel: () => {},
  };
  const k = erstelleKraftModul(ctx);
  await k.actions['k.start']({ einheit: e.id });
  const seg = state.sessions[0].segmente[0];
  const satz = seg.eintraege[0];
  satz.flags = [...satz.flags, 'irgendwas'];

  await k.actions['k.satzArt']({ seg: seg.id, eintrag: satz.id });
  await k.actions['k.satzArt']({ seg: seg.id, eintrag: satz.id });
  await k.actions['k.satzArt']({ seg: seg.id, eintrag: satz.id });
  assert.ok(hatFlag(satz, 'irgendwas'), 'fremde Flags überleben den Durchlauf');
});
