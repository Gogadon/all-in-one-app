// tests/ausfall.test.js — Ausfall-Tage (krank o.Ä.): eigene Liste, wie termine
// getrennt von den Sessions und ohne Einfluss auf Statistik/Wochenzahlen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  neuerAusfallTag, ausfallAmTag, markiereAusfall, entferneAusfall,
  neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag,
} = await import('../js/core/model.js');
const { leererZustand, migriere } = await import('../js/core/storage.js');
const { tagMarker, tagDetail } = await import('../js/kalender.js');
const { wochenUebersicht } = await import('../js/dashboard.js');
const { zeitraumStatistik } = await import('../js/core/statistik.js');

function leer() { return leererZustand(); }

// ============================================================
// Grundform
// ============================================================

test('Ausfall: frischer Zustand hat die Liste, alte Stände bekommen sie nachgetragen', () => {
  assert.deepEqual(leer().ausfallTage, []);
  const alt = { schema: 2, bibliothek: [], sessions: [] };
  assert.deepEqual(migriere(alt).ausfallTage, []);
});

test('Ausfall: Eintrag trägt Datum, Typ und Zeitstempel', () => {
  const a = neuerAusfallTag({ datum: '2026-07-20', notiz: 'Magen-Darm' });
  assert.equal(a.datum, '2026-07-20');
  assert.equal(a.typ, 'krank');          // Standard-Typ
  assert.equal(a.notiz, 'Magen-Darm');
  assert.ok(a.id && a.erstelltAm);
});

test('Ausfall: ohne Datum wirft', () => {
  assert.throws(() => neuerAusfallTag({}), /braucht ein Datum/);
});

// ============================================================
// Markieren / Entfernen
// ============================================================

test('Ausfall: einzelnen Tag markieren und wieder entfernen', () => {
  const s = leer();
  assert.equal(markiereAusfall(s, '2026-07-20'), 1);
  assert.equal(ausfallAmTag(s, '2026-07-20').typ, 'krank');
  assert.equal(ausfallAmTag(s, '2026-07-21'), null);

  assert.equal(entferneAusfall(s, '2026-07-20'), true);
  assert.equal(ausfallAmTag(s, '2026-07-20'), null);
  assert.equal(entferneAusfall(s, '2026-07-20'), false);   // zweites Mal: nichts mehr da
});

test('Ausfall: Zeitraum markiert beide Grenzen inklusive', () => {
  const s = leer();
  assert.equal(markiereAusfall(s, '2026-07-20', '2026-07-24'), 5);
  for (const t of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']) {
    assert.ok(ausfallAmTag(s, t), t + ' sollte markiert sein');
  }
  assert.equal(ausfallAmTag(s, '2026-07-25'), null);
});

test('Ausfall: vertauschte Grenzen werden gedreht', () => {
  const s = leer();
  assert.equal(markiereAusfall(s, '2026-07-24', '2026-07-22'), 3);
  assert.ok(ausfallAmTag(s, '2026-07-22'));
  assert.ok(ausfallAmTag(s, '2026-07-24'));
});

test('Ausfall: Zeitraum über den Monatswechsel', () => {
  const s = leer();
  assert.equal(markiereAusfall(s, '2026-07-30', '2026-08-02'), 4);
  assert.ok(ausfallAmTag(s, '2026-07-31'));
  assert.ok(ausfallAmTag(s, '2026-08-01'));
});

test('Ausfall: schon markierte Tage bleiben unangetastet (kein Duplikat)', () => {
  const s = leer();
  markiereAusfall(s, '2026-07-21', '2026-07-21', { notiz: 'zuerst' });
  // Überlappender Zeitraum: nur die noch freien Tage kommen dazu
  assert.equal(markiereAusfall(s, '2026-07-20', '2026-07-22', { notiz: 'danach' }), 2);
  assert.equal(s.ausfallTage.filter(a => a.datum === '2026-07-21').length, 1);
  assert.equal(ausfallAmTag(s, '2026-07-21').notiz, 'zuerst');   // Original gewinnt
});

// ============================================================
// Sichtbarkeit im Kalender
// ============================================================

test('Ausfall: taucht im Tages-Marker und im Tages-Detail auf', () => {
  const s = leer();
  markiereAusfall(s, '2026-07-20');
  assert.equal(tagMarker(s, '2026-07-20').ausfall, 'krank');
  assert.equal(tagMarker(s, '2026-07-21').ausfall, null);
  assert.equal(tagDetail(s, '2026-07-20', '2026-07-25').ausfall.typ, 'krank');
  assert.equal(tagDetail(s, '2026-07-21', '2026-07-25').ausfall, null);
});

test('Ausfall: verdrängt eine trotzdem absolvierte Einheit nicht', () => {
  const s = leer();
  const sess = neueSession({ datum: '2026-07-20' });
  sess.modul = 'rad'; sess.abgeschlossen = true;
  addEintrag(addSegment(sess, neuesSegment('akt-rad')), neuerEintrag({ distanz: 10000 }));
  s.sessions.push(sess);
  markiereAusfall(s, '2026-07-20');

  const m = tagMarker(s, '2026-07-20');
  assert.equal(m.ausfall, 'krank');
  assert.deepEqual(m.module, ['rad']);   // beides wird gezeigt
  assert.equal(m.anzahl, 1);
});

// ============================================================
// Darf Zahlen NICHT verfälschen (wie termine)
// ============================================================

test('Ausfall: fließt nicht in Wochenstatistik oder Zeitraum-Statistik ein', () => {
  const s = leer();
  markiereAusfall(s, '2026-07-06', '2026-07-10');   // ganze Arbeitswoche krank
  const u = wochenUebersicht(s, '2026-07-08');
  assert.equal(u.aktivitaeten, 0);
  assert.equal(u.aktiveTage, 0);
  assert.equal(zeitraumStatistik(s, 'rad', 'woche', '2026-07-08').anzahl, 0);
});

test('Ausfall: erzeugt keine Sessions', () => {
  const s = leer();
  markiereAusfall(s, '2026-07-20', '2026-07-24');
  assert.equal(s.sessions.length, 0);
});
