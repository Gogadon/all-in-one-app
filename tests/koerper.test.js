// tests/koerper.test.js — Körperwerte: eigene Liste, kein Training.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  KOERPER_WERTE, istKoerperWert, standardWerte, formatKoerperWert,
  messungen, messungAmTag, verlauf, letzterWert, veraenderung,
  neueMessung, setzeMessung, entferneMessung, istLeer,
} = await import('../js/core/koerper.js');
const { leererZustand, migriere } = await import('../js/core/storage.js');
const { wochenUebersicht } = await import('../js/dashboard.js');

function leer() { return leererZustand(); }

/** Zustand mit ein paar Messungen (bewusst unsortiert eingefügt). */
function mitVerlauf() {
  const s = leer();
  setzeMessung(s, '2026-07-20', { gewicht: 96.3, kfa: 23.9 });
  setzeMessung(s, '2026-07-06', { gewicht: 97.0 });
  setzeMessung(s, '2026-07-27', { gewicht: 95.1, kfa: 23.5 });
  return s;
}

// ============================================================
// Grundform & Register
// ============================================================

test('Körper: frischer Zustand hat die Liste, alte Stände bekommen sie nachgetragen', () => {
  assert.deepEqual(leer().koerper, []);
  const alt = { schema: 2, bibliothek: [], sessions: [] };
  assert.deepEqual(migriere(alt).koerper, []);
});

test('Körper: Register kennt Gewicht und KFA als Standard, weitere optional', () => {
  assert.ok(istKoerperWert('gewicht'));
  assert.ok(istKoerperWert('muskelmasse'));
  assert.ok(!istKoerperWert('bizeps'));
  assert.deepEqual(standardWerte(), ['gewicht', 'kfa']);
  // Die Werte einer Gym-Waage sind vorbereitet
  for (const t of ['muskelmasse', 'wasser', 'knochenmasse', 'viszeralfett', 'bmi']) {
    assert.ok(KOERPER_WERTE[t], t + ' fehlt im Register');
  }
});

test('Körper: Formatierung mit deutscher Schreibweise und Einheit', () => {
  assert.equal(formatKoerperWert('gewicht', 95.1), '95,1 kg');
  assert.equal(formatKoerperWert('kfa', 23.5), '23,5 %');
  assert.equal(formatKoerperWert('bmi', 27.4), '27,4');     // ohne Einheit
  assert.equal(formatKoerperWert('gewicht', null), '–');
  assert.throws(() => formatKoerperWert('bizeps', 1), /Unbekannter Körperwert/);
});

// ============================================================
// Schreiben: eine Messung pro Tag
// ============================================================

test('Körper: Messung anlegen und am Tag wiederfinden', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  assert.equal(s.koerper.length, 1);
  assert.equal(messungAmTag(s, '2026-07-27').werte.gewicht, 95.1);
  assert.equal(messungAmTag(s, '2026-07-26'), null);
});

test('Körper: zweiter Eintrag am selben Tag ergänzt, statt zu doppeln', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  setzeMessung(s, '2026-07-27', { kfa: 23.5 });          // Waage im Gym nachgetragen
  assert.equal(s.koerper.length, 1);
  const m = messungAmTag(s, '2026-07-27');
  assert.equal(m.werte.gewicht, 95.1);                    // bleibt erhalten
  assert.equal(m.werte.kfa, 23.5);
});

test('Körper: vorhandenen Wert überschreiben und einzeln löschen', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1, kfa: 23.5 });
  setzeMessung(s, '2026-07-27', { gewicht: 94.8 });       // korrigiert
  assert.equal(messungAmTag(s, '2026-07-27').werte.gewicht, 94.8);
  setzeMessung(s, '2026-07-27', { kfa: null });            // Tippfehler wieder raus
  assert.equal(messungAmTag(s, '2026-07-27').werte.kfa, undefined);
  assert.equal(messungAmTag(s, '2026-07-27').werte.gewicht, 94.8);
});

test('Körper: unbekannte Werte werden abgelehnt', () => {
  const s = leer();
  assert.throws(() => setzeMessung(s, '2026-07-27', { bizeps: 42 }), /Unbekannte Körperwerte/);
  assert.throws(() => neueMessung({ werte: { bizeps: 42 } }), /Unbekannte Körperwerte/);
});

test('Körper: Messung löschen', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  assert.equal(entferneMessung(s, '2026-07-27'), true);
  assert.deepEqual(s.koerper, []);
  assert.equal(entferneMessung(s, '2026-07-27'), false);
});

test('Körper: leere Messung ist als solche erkennbar', () => {
  assert.ok(istLeer(neueMessung({ datum: '2026-07-27' })));
  assert.ok(!istLeer(neueMessung({ datum: '2026-07-27', werte: { gewicht: 95 } })));
});

// ============================================================
// Lesen: Verlauf, letzter Wert, Veränderung
// ============================================================

test('Körper: Liste kommt neueste zuerst, Verlauf älteste zuerst', () => {
  const s = mitVerlauf();
  assert.deepEqual(messungen(s).map(m => m.datum), ['2026-07-27', '2026-07-20', '2026-07-06']);
  assert.deepEqual(verlauf(s, 'gewicht').map(p => p.datum), ['2026-07-06', '2026-07-20', '2026-07-27']);
});

test('Körper: Verlauf enthält nur Messungen mit diesem Wert', () => {
  const s = mitVerlauf();   // KFA fehlt am 06.07.
  assert.deepEqual(verlauf(s, 'kfa').map(p => p.datum), ['2026-07-20', '2026-07-27']);
  assert.deepEqual(verlauf(s, 'muskelmasse'), []);
});

test('Körper: letzter Wert ist der jüngste, nicht der zuletzt eingetragene', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  setzeMessung(s, '2026-07-06', { gewicht: 97.0 });   // älterer Tag NACH dem neueren erfasst
  assert.deepEqual(letzterWert(s, 'gewicht'), { datum: '2026-07-27', wert: 95.1 });
  assert.equal(letzterWert(s, 'kfa'), null);
});

test('Körper: Veränderung vergleicht mit der vorherigen Messung', () => {
  const s = mitVerlauf();
  const v = veraenderung(s, 'gewicht');
  assert.equal(v.jetzt, 95.1);
  assert.equal(v.vorher, 96.3);
  assert.ok(Math.abs(v.diff - (-1.2)) < 1e-9);
  assert.equal(v.seit, '2026-07-20');
});

test('Körper: ohne Vergleichswert gibt es keine Veränderung', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  assert.equal(veraenderung(s, 'gewicht'), null);
});

// ============================================================
// Darf die Trainings-Zahlen NICHT anfassen
// ============================================================

test('Körper: Messungen erzeugen keine Sessions und keine Aktivitäten', () => {
  const s = leer();
  setzeMessung(s, '2026-07-06', { gewicht: 97.0 });
  setzeMessung(s, '2026-07-08', { gewicht: 96.5 });
  assert.equal(s.sessions.length, 0);
  const u = wochenUebersicht(s, '2026-07-08');
  assert.equal(u.aktivitaeten, 0);
  assert.equal(u.aktiveTage, 0);
});
