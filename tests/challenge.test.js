// tests/challenge.test.js — Challenge-Modul (Mengenziele)
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
};

const { leererZustand } = await import('../js/core/storage.js');
const { neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag } = await import('../js/core/model.js');
const { addAktivitaet } = await import('../js/core/library.js');
const {
  fortschritt, zeitraumStart, zeitraumText,
} = await import('../js/modules/challenge.js');
// Datums-Helfer wohnen jetzt im Kern (model.js), nicht mehr im Challenge-Modul
const { wochenStart, monatsStart, jahresStart } = await import('../js/core/model.js');

const HEUTE = '2026-07-08'; // Mittwoch

function radTour(state, datum, km, hm = 0) {
  const s = neueSession({ datum }); s.modul = 'rad'; s.abgeschlossen = true;
  const seg = addSegment(s, neuesSegment('x')); seg.erledigt = true;
  addEintrag(seg, neuerEintrag({ distanz: km * 1000, hoehenmeter: hm }));
  state.sessions.push(s);
}
function kraftEinheit(state, datum, vol) {
  const s = neueSession({ datum }); s.modul = 'kraft'; s.abgeschlossen = true;
  const seg = addSegment(s, neuesSegment('x')); seg.erledigt = true;
  addEintrag(seg, neuerEintrag({ gewicht: vol / 10, wdh: 10 }));
  state.sessions.push(s);
}

test('Challenge: Zeitraum-Grenzen (Woche/Monat/Jahr)', () => {
  assert.equal(wochenStart(HEUTE), '2026-07-06');   // Montag
  assert.equal(monatsStart(HEUTE), '2026-07-01');
  assert.equal(jahresStart(HEUTE), '2026-01-01');
  assert.equal(zeitraumStart('gesamt', HEUTE), null);
  assert.equal(zeitraumStart('bis:2026-08-31', HEUTE), null);
});

test('Challenge: Rad-km über Zeiträume korrekt gezählt', () => {
  const state = leererZustand();
  radTour(state, '2026-06-28', 50);  // Vormonat
  radTour(state, '2026-07-02', 10);
  radTour(state, '2026-07-06', 20);  // Wochenstart
  radTour(state, '2026-07-08', 8);
  // Monat: 10+20+8 = 38
  assert.equal(fortschritt(state, { was: 'rad_km', zielwert: 100, zeitraum: 'monat' }, HEUTE).ist, 38);
  // Woche (ab Mo 06.07.): 20+8 = 28
  assert.equal(fortschritt(state, { was: 'rad_km', zielwert: 50, zeitraum: 'woche' }, HEUTE).ist, 28);
  // Gesamt: 88
  const g = fortschritt(state, { was: 'rad_km', zielwert: 88, zeitraum: 'gesamt' }, HEUTE);
  assert.equal(g.ist, 88);
  assert.equal(g.fertig, true);
});

test('Challenge: alle Größen (Touren, Höhenmeter, Kraft-Volumen, Einheiten)', () => {
  const state = leererZustand();
  radTour(state, '2026-07-02', 10, 143);
  radTour(state, '2026-07-06', 20, 250);
  kraftEinheit(state, '2026-07-07', 5000);
  kraftEinheit(state, '2026-07-08', 3000);
  assert.equal(fortschritt(state, { was: 'rad_touren', zielwert: 5, zeitraum: 'monat' }, HEUTE).ist, 2);
  assert.equal(fortschritt(state, { was: 'rad_hm', zielwert: 1000, zeitraum: 'gesamt' }, HEUTE).ist, 393);
  assert.equal(fortschritt(state, { was: 'kraft_volumen', zielwert: 10000, zeitraum: 'monat' }, HEUTE).ist, 8000);
  assert.equal(fortschritt(state, { was: 'kraft_einheiten', zielwert: 3, zeitraum: 'monat' }, HEUTE).ist, 2);
});

test('Challenge: Ziel mit Enddatum liefert Resttage', () => {
  const state = leererZustand();
  radTour(state, '2026-07-02', 40);
  const f = fortschritt(state, { was: 'rad_km', zielwert: 100, zeitraum: 'bis:2026-07-31' }, HEUTE);
  assert.equal(f.ist, 40);
  assert.equal(f.resttage, 23);      // 08.07. → 31.07.
  assert.equal(f.abgelaufen, false);
});

test('Challenge: fertig-Status bei Zielerreichung', () => {
  const state = leererZustand();
  radTour(state, '2026-07-02', 100);
  const f = fortschritt(state, { was: 'rad_km', zielwert: 100, zeitraum: 'monat' }, HEUTE);
  assert.equal(f.fertig, true);
  assert.equal(f.prozent, 100);
});

test('Challenge: übersprungene Sessions zählen nicht', () => {
  const state = leererZustand();
  radTour(state, '2026-07-02', 30);
  const skip = neueSession({ datum: '2026-07-03' });
  skip.modul = 'rad'; skip.uebersprungen = true;
  state.sessions.push(skip);
  assert.equal(fortschritt(state, { was: 'rad_km', zielwert: 100, zeitraum: 'monat' }, HEUTE).ist, 30);
});

test('Challenge: zeitraumText liefert lesbare Beschreibung', () => {
  assert.equal(zeitraumText('woche'), 'diese Woche');
  assert.equal(zeitraumText('monat'), 'diesen Monat');
  assert.equal(zeitraumText('gesamt'), 'insgesamt');
  assert.equal(zeitraumText('bis:2026-08-31'), 'bis 2026-08-31');
});

test('Datum: tageZwischen rechnet in UTC und ignoriert Zeitanteile', async () => {
  const { tageZwischen } = await import('../js/core/model.js');
  assert.equal(tageZwischen('2026-07-10', '2026-07-31'), 21);
  assert.equal(tageZwischen('2026-07-31', '2026-07-31'), 0);
  assert.equal(tageZwischen('2026-07-31', '2026-07-10'), -21);   // rückwärts
  assert.equal(tageZwischen('2026-03-28', '2026-04-04'), 7);     // über Sommerzeit
  assert.equal(tageZwischen('2025-12-29', '2026-01-01'), 3);     // über Jahreswechsel
  assert.equal(tageZwischen('2024-02-27', '2024-03-01'), 3);     // Schaltjahr
  // Zeitanteile dürfen das Ergebnis nicht verschieben (lokales Parsen wäre buggy)
  assert.equal(tageZwischen('2026-07-10T23:30:00', '2026-07-31T01:00:00'), 21);
});

test('Challenge: offene Radtour zählt NICHT in rad_km/rad_hm', () => {
  const state = leererZustand();
  radTour(state, '2026-07-08', 20, 300);           // abgeschlossen
  // offene Tour: abgeschlossen=false, mit Distanz + Höhenmetern
  const offen = neueSession({ datum: '2026-07-08' });
  offen.modul = 'rad'; offen.abgeschlossen = false;
  const seg = addSegment(offen, neuesSegment('x'));
  addEintrag(seg, neuerEintrag({ distanz: 99000, hoehenmeter: 5000 }));
  state.sessions.push(offen);

  assert.equal(fortschritt(state, { was: 'rad_km', zielwert: 100, zeitraum: 'monat' }, HEUTE).ist, 20);
  assert.equal(fortschritt(state, { was: 'rad_hm', zielwert: 1000, zeitraum: 'monat' }, HEUTE).ist, 300);
});
