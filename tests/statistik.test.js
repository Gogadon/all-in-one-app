// tests/statistik.test.js — Zeitraum-Aggregation (reiner Kern, kein DOM)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag,
  zeitraum, verschiebeZeitraum, sortiereNeuesteZuerst,
} = await import('../js/core/model.js');
const {
  zeitraumStatistik, aggregiereTouren, tourenImZeitraum,
  gewichtGleich, gewichtNachGroesse, zeitraumLabel,
} = await import('../js/core/statistik.js');

// ------------------------------------------------------------
// Hilfs-Fabrik: eine fertige Tour direkt bauen (ohne Modul-UI).
// Rad/Wandern-Struktur: 1 Segment, 1 Eintrag mit den Messwerten.
// ------------------------------------------------------------
function macheTour(state, { modul = 'rad', datum, mw = {}, abgeschlossen = true, uebersprungen = false } = {}) {
  const s = neueSession({ datum });
  s.modul = modul;
  if (abgeschlossen) s.abgeschlossen = true;
  if (uebersprungen) s.uebersprungen = true;
  const seg = addSegment(s, neuesSegment('akt-' + modul));
  addEintrag(seg, neuerEintrag(mw));
  state.sessions.push(s);
  return s;
}

function leererState() { return { sessions: [] }; }

// ============================================================
// zeitraum() — Grenzen (bis exklusiv)
// ============================================================

test('zeitraum: Woche = Montag bis nächster Montag (exklusiv)', () => {
  // 2026-07-08 ist ein Mittwoch → Woche Mo 06.07. bis (exkl.) Mo 13.07.
  assert.deepEqual(zeitraum('woche', '2026-07-08'), { von: '2026-07-06', bis: '2026-07-13' });
});

test('zeitraum: Monat = 1. bis 1. des Folgemonats (exklusiv)', () => {
  assert.deepEqual(zeitraum('monat', '2026-07-08'), { von: '2026-07-01', bis: '2026-08-01' });
  // Jahreswechsel korrekt
  assert.deepEqual(zeitraum('monat', '2026-12-20'), { von: '2026-12-01', bis: '2027-01-01' });
});

test('zeitraum: Jahr = 1.1. bis 1.1. Folgejahr (exklusiv)', () => {
  assert.deepEqual(zeitraum('jahr', '2026-07-08'), { von: '2026-01-01', bis: '2027-01-01' });
});

test('zeitraum: unbekannte Art wirft', () => {
  assert.throws(() => zeitraum('quartal', '2026-07-08'), /Unbekannte Zeitraum-Art/);
});

// ============================================================
// Grundfälle: summe / mittel / max
// ============================================================

test('Statistik: summe addiert, mittel = Ø der Touren, max = Maximum', () => {
  const state = leererState();
  macheTour(state, { datum: '2026-07-06', mw: { distanz: 10000, dauer: 3600, tempo_avg: 20, tempo_max: 35, puls_avg: 130 } });
  macheTour(state, { datum: '2026-07-12', mw: { distanz: 30000, dauer: 3600, tempo_avg: 30, tempo_max: 40 } });

  const r = zeitraumStatistik(state, 'rad', 'woche', '2026-07-08');
  assert.equal(r.anzahl, 2);
  assert.equal(r.von, '2026-07-06');
  assert.equal(r.bis, '2026-07-13');

  // summe
  assert.equal(r.kennzahlen.distanz, 40000);
  assert.equal(r.kennzahlen.dauer, 7200);
  // mittel (Gleichgewicht): einfacher Ø der Touren-Werte
  assert.equal(r.kennzahlen.tempo_avg, 25);        // (20+30)/2
  // max
  assert.equal(r.kennzahlen.tempo_max, 40);        // max(35,40)
  // mittel mit fehlenden Werten: nur Touren, die den Wert haben
  assert.equal(r.kennzahlen.puls_avg, 130);        // nur Tour 1 hatte Puls
});

test('Statistik: leerer Zeitraum → anzahl 0, keine Kennzahlen', () => {
  const state = leererState();
  macheTour(state, { datum: '2026-07-06', mw: { distanz: 10000 } });
  const r = zeitraumStatistik(state, 'rad', 'woche', '2020-01-01');
  assert.equal(r.anzahl, 0);
  assert.deepEqual(r.kennzahlen, {});
  assert.deepEqual(r.sessions, []);
});

test('Statistik: Kennzahlen stehen in Registry-Reihenfolge', () => {
  const state = leererState();
  macheTour(state, { datum: '2026-07-06', mw: { puls_avg: 120, distanz: 10000, dauer: 3600 } });
  const r = zeitraumStatistik(state, 'rad', 'woche', '2026-07-08');
  // Registry-Reihenfolge: distanz kommt vor dauer, dauer vor puls_avg
  assert.deepEqual(Object.keys(r.kennzahlen), ['distanz', 'dauer', 'puls_avg']);
});

// ============================================================
// Zeitraum-Grenzen im Zusammenspiel mit echten Touren
// ============================================================

test('Statistik: Woche/Monat/Jahr grenzen korrekt ab', () => {
  const state = leererState();
  macheTour(state, { datum: '2026-06-30', mw: { distanz: 5000 } });   // Vormonat, gleiches Jahr
  macheTour(state, { datum: '2026-07-01', mw: { distanz: 5000 } });   // Monat + Jahr
  macheTour(state, { datum: '2026-07-06', mw: { distanz: 10000 } });  // Woche + Monat + Jahr
  macheTour(state, { datum: '2026-07-12', mw: { distanz: 30000 } });  // Woche (So) + Monat + Jahr
  macheTour(state, { datum: '2026-07-13', mw: { distanz: 20000 } });  // nächste Woche, noch im Monat

  const woche = zeitraumStatistik(state, 'rad', 'woche', '2026-07-08');
  assert.equal(woche.anzahl, 2);                 // 06. + 12.
  assert.equal(woche.kennzahlen.distanz, 40000);

  const monat = zeitraumStatistik(state, 'rad', 'monat', '2026-07-08');
  assert.equal(monat.anzahl, 4);                 // 01./06./12./13.
  assert.equal(monat.kennzahlen.distanz, 65000);

  const jahr = zeitraumStatistik(state, 'rad', 'jahr', '2026-07-08');
  assert.equal(jahr.anzahl, 5);                  // alle
  assert.equal(jahr.kennzahlen.distanz, 70000);
});

// ============================================================
// Abgrenzung: Modul, offene & übersprungene Touren
// ============================================================

test('Statistik: fremdes Modul zählt nicht mit', () => {
  const state = leererState();
  macheTour(state, { modul: 'rad', datum: '2026-07-06', mw: { distanz: 10000 } });
  macheTour(state, { modul: 'wandern', datum: '2026-07-06', mw: { distanz: 8000 } });

  const rad = zeitraumStatistik(state, 'rad', 'woche', '2026-07-08');
  assert.equal(rad.anzahl, 1);
  assert.equal(rad.kennzahlen.distanz, 10000);

  const wandern = zeitraumStatistik(state, 'wandern', 'woche', '2026-07-08');
  assert.equal(wandern.anzahl, 1);
  assert.equal(wandern.kennzahlen.distanz, 8000);
});

test('Statistik: offene und übersprungene Touren zählen nicht', () => {
  const state = leererState();
  macheTour(state, { datum: '2026-07-06', mw: { distanz: 10000 } });                          // fertig
  macheTour(state, { datum: '2026-07-07', mw: { distanz: 99000 }, abgeschlossen: false });    // offen
  macheTour(state, { datum: '2026-07-08', mw: { distanz: 88000 }, uebersprungen: true });     // übersprungen

  const r = zeitraumStatistik(state, 'rad', 'woche', '2026-07-08');
  assert.equal(r.anzahl, 1);
  assert.equal(r.kennzahlen.distanz, 10000);
});

test('Statistik: sessions sind neueste zuerst', () => {
  const state = leererState();
  macheTour(state, { datum: '2026-07-06', mw: { distanz: 10000 } });
  macheTour(state, { datum: '2026-07-12', mw: { distanz: 30000 } });
  const r = zeitraumStatistik(state, 'rad', 'woche', '2026-07-08');
  assert.deepEqual(r.sessions.map(s => s.datum), ['2026-07-12', '2026-07-06']);
});

// ============================================================
// Migrations-Seam: gewichteter Mittelwert
// ============================================================

test('Seam: gewichteter Mittelwert unterscheidet sich vom einfachen', () => {
  const state = leererState();
  // 10 km @ 20 km/h, 30 km @ 30 km/h
  macheTour(state, { datum: '2026-07-06', mw: { distanz: 10000, tempo_avg: 20 } });
  macheTour(state, { datum: '2026-07-12', mw: { distanz: 30000, tempo_avg: 30 } });

  // Default (Gleichgewicht): (20+30)/2 = 25
  const einfach = zeitraumStatistik(state, 'rad', 'woche', '2026-07-08');
  assert.equal(einfach.kennzahlen.tempo_avg, 25);

  // Nach Distanz gewichtet: (20·10000 + 30·30000)/40000 = 27,5
  const gewichtet = zeitraumStatistik(state, 'rad', 'woche', '2026-07-08', { gewicht: gewichtNachGroesse });
  assert.equal(gewichtet.kennzahlen.tempo_avg, 27.5);

  // summe/max bleiben von der Gewichtung unberührt
  assert.equal(gewichtet.kennzahlen.distanz, 40000);
});

test('Seam: gewichtGleich ist der Default', () => {
  const state = leererState();
  macheTour(state, { datum: '2026-07-06', mw: { distanz: 10000, tempo_avg: 20 } });
  macheTour(state, { datum: '2026-07-12', mw: { distanz: 30000, tempo_avg: 30 } });
  const explizit = aggregiereTouren(state.sessions, { gewicht: gewichtGleich });
  const default_ = aggregiereTouren(state.sessions);
  assert.deepEqual(default_.kennzahlen, explizit.kennzahlen);
});

test('Seam: Ø-Bahnlänge gewichtet nach Bahnen = Gesamt-Meter / Gesamt-Bahnen', () => {
  const state = leererState();
  // 5 Bahnen à 10 m (kleines Becken) + 50 Bahnen à 25 m (großes Becken)
  macheTour(state, { modul: 'schwimmen', datum: '2026-07-06', mw: { bahnen: 5, bahnlaenge: 10, distanz: 50 } });
  macheTour(state, { modul: 'schwimmen', datum: '2026-07-12', mw: { bahnen: 50, bahnlaenge: 25, distanz: 1250 } });

  // Einfach: (10 + 25) / 2 = 17,5 m — als hätte man beide Becken gleich viel genutzt.
  const einfach = zeitraumStatistik(state, 'schwimmen', 'woche', '2026-07-08');
  assert.equal(einfach.kennzahlen.bahnlaenge, 17.5);

  // Nach Bahnen gewichtet: (10·5 + 25·50) / 55 = 1300/55 ≈ 23,6 m.
  const gewichtet = zeitraumStatistik(state, 'schwimmen', 'woche', '2026-07-08', { gewicht: gewichtNachGroesse });
  assert.equal(gewichtet.kennzahlen.bahnlaenge, 1300 / 55);
  // … und das ist exakt Gesamt-Meter ÷ Gesamt-Bahnen.
  assert.equal(gewichtet.kennzahlen.bahnlaenge, gewichtet.kennzahlen.distanz / gewichtet.kennzahlen.bahnen);
});

// ============================================================
// aggregiereTouren direkt (untere Ebene)
// ============================================================

test('aggregiereTouren: leere Liste → anzahl 0, keine Kennzahlen', () => {
  const r = aggregiereTouren([]);
  assert.equal(r.anzahl, 0);
  assert.deepEqual(r.kennzahlen, {});
});

test('tourenImZeitraum: filtert exklusiv am oberen Rand', () => {
  const state = leererState();
  macheTour(state, { datum: '2026-07-12', mw: { distanz: 1000 } });
  macheTour(state, { datum: '2026-07-13', mw: { distanz: 2000 } });
  const drin = tourenImZeitraum(state, 'rad', '2026-07-06', '2026-07-13');
  assert.deepEqual(drin.map(s => s.datum), ['2026-07-12']);   // 13. ist EXKLUSIV draußen
});

// ============================================================
// verschiebeZeitraum() — vor/zurück-Navigation
// ============================================================

test('verschiebeZeitraum: Woche zurück/vor', () => {
  assert.equal(zeitraum('woche', verschiebeZeitraum('woche', '2026-07-08', -1)).von, '2026-06-29');
  assert.equal(zeitraum('woche', verschiebeZeitraum('woche', '2026-07-08', +1)).von, '2026-07-13');
});

test('verschiebeZeitraum: Monat zurück/vor (inkl. Jahreswechsel)', () => {
  assert.equal(zeitraum('monat', verschiebeZeitraum('monat', '2026-07-08', -1)).von, '2026-06-01');
  assert.equal(zeitraum('monat', verschiebeZeitraum('monat', '2026-07-08', +1)).von, '2026-08-01');
  assert.equal(zeitraum('monat', verschiebeZeitraum('monat', '2026-01-15', -1)).von, '2025-12-01');
});

test('verschiebeZeitraum: Jahr zurück/vor', () => {
  assert.equal(zeitraum('jahr', verschiebeZeitraum('jahr', '2026-07-08', -1)).von, '2025-01-01');
  assert.equal(zeitraum('jahr', verschiebeZeitraum('jahr', '2026-07-08', +1)).von, '2027-01-01');
});

test('verschiebeZeitraum: zurück dann vor landet wieder im selben Zeitraum', () => {
  for (const art of ['woche', 'monat', 'jahr']) {
    const heim = zeitraum(art, '2026-07-08').von;
    const zurueck = verschiebeZeitraum(art, '2026-07-08', -1);
    const wieder = verschiebeZeitraum(art, zurueck, +1);
    assert.equal(zeitraum(art, wieder).von, heim);
  }
});

// ============================================================
// zeitraumLabel() — Anzeige-Beschriftung
// ============================================================

test('zeitraumLabel: Jahr = nur die Jahreszahl', () => {
  assert.equal(zeitraumLabel('jahr', '2026-07-08'), '2026');
});

test('zeitraumLabel: Monat = Monat + Jahr', () => {
  assert.equal(zeitraumLabel('monat', '2026-07-08'), 'Juli 2026');
});

test('zeitraumLabel: Woche im selben Monat', () => {
  assert.equal(zeitraumLabel('woche', '2026-07-08'), '6.–12. Juli 2026');
});

test('zeitraumLabel: Woche über Monatsgrenze', () => {
  // Woche um den 1. Juli 2026: Mo 29.06. – So 05.07.
  assert.equal(zeitraumLabel('woche', '2026-07-01'), '29. Juni – 5. Juli 2026');
});

test('zeitraumLabel: Woche über Jahresgrenze nennt beide Jahre', () => {
  const label = zeitraumLabel('woche', '2026-12-31');
  assert.ok(label.includes('2026') && label.includes('2027'));
  assert.ok(label.includes('Dezember') && label.includes('Januar'));
});

// ============================================================
// Sortierung: gleicher Tag → zuletzt eingetragene zuerst
// ============================================================

test('neueSession: setzt einen erstelltAm-Zeitstempel', () => {
  const s = neueSession({ datum: '2026-07-08' });
  assert.equal(typeof s.erstelltAm, 'string');
  assert.ok(!Number.isNaN(Date.parse(s.erstelltAm)));
});

test('tourenImZeitraum: bei gleichem Tag steht die zuletzt eingetragene oben', () => {
  const state = leererState();
  const frueh = macheTour(state, { datum: '2026-07-08', mw: { distanz: 6500 } });   // zuerst eingetragen
  const spaet = macheTour(state, { datum: '2026-07-08', mw: { distanz: 21500 } });  // danach eingetragen
  const liste = tourenImZeitraum(state, 'rad', '2026-07-06', '2026-07-13');
  assert.equal(liste[0].id, spaet.id);   // spätere Tour oben
  assert.equal(liste[1].id, frueh.id);
});

test('sortiereNeuesteZuerst: erstelltAm sticht die Einfüge-Reihenfolge', () => {
  // A steht im Array vorne, wurde aber SPÄTER eingetragen (erstelltAm) → A gehört nach oben.
  const liste = [
    { id: 'A', datum: '2026-07-08', erstelltAm: '2026-07-08T18:00:00.000Z' },
    { id: 'B', datum: '2026-07-08', erstelltAm: '2026-07-08T09:00:00.000Z' },
  ];
  assert.deepEqual(sortiereNeuesteZuerst(liste).map(x => x.id), ['A', 'B']);
});

test('sortiereNeuesteZuerst: ohne erstelltAm zählt die Einfüge-Reihenfolge (später = oben)', () => {
  const liste = [
    { id: 'alt',  datum: '2026-07-08' },   // Index 0 = früher eingetragen
    { id: 'neu',  datum: '2026-07-08' },   // Index 1 = später eingetragen
  ];
  assert.deepEqual(sortiereNeuesteZuerst(liste).map(x => x.id), ['neu', 'alt']);
});

test('sortiereNeuesteZuerst: verschiedene Tage bleiben nach Datum absteigend', () => {
  const liste = [
    { id: 'a', datum: '2026-07-06' },
    { id: 'b', datum: '2026-07-12' },
    { id: 'c', datum: '2026-07-09' },
  ];
  assert.deepEqual(sortiereNeuesteZuerst(liste).map(x => x.id), ['b', 'c', 'a']);
});
