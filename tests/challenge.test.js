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
