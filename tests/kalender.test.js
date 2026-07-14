// tests/kalender.test.js — Werkzeug B, Kern (Rückblick): Raster, Streifen,
// Tages-Detail (reine Orchestrierungs-Schicht, kein DOM)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag,
  neuerTermin, termineAmTag } = await import('../js/core/model.js');
const { gesichtFuer, tagMarker, wochenStreifen, monatsGitter, tagDetail } =
  await import('../js/kalender.js');

// ------------------------------------------------------------
// Hilfs-Fabrik
// ------------------------------------------------------------
function macheTour(state, { modul = 'rad', datum, abgeschlossen = true, uebersprungen = false } = {}) {
  const s = neueSession({ datum });
  if (modul !== null) s.modul = modul;
  if (abgeschlossen) s.abgeschlossen = true;
  if (uebersprungen) s.uebersprungen = true;
  const seg = addSegment(s, neuesSegment('akt-' + (modul ?? 'kraft')));
  addEintrag(seg, neuerEintrag({ distanz: 10000 }));
  state.sessions.push(s);
  return s;
}

/** Zelle mit gegebener ISO aus einem Raster/Streifen finden. */
function zelle(struktur, iso) {
  const alle = struktur.wochen ? struktur.wochen.flat() : struktur.tage;
  return alle.find(z => z.iso === iso);
}

function bauStandardState() {
  const state = { sessions: [], bibliothek: [] };
  macheTour(state, { modul: 'kraft', datum: '2026-07-01' });        // Vergangenheit, Tag mit 2 Modulen
  macheTour(state, { modul: 'rad', datum: '2026-07-01' });
  macheTour(state, { modul: 'wandern', datum: '2026-07-15' });      // „heute" in den Tests
  macheTour(state, { modul: 'rad', datum: '2026-07-15', abgeschlossen: false }); // offen → kein Punkt
  macheTour(state, { modul: 'kraft', datum: '2026-07-20', uebersprungen: true }); // übersprungen → kein Punkt
  macheTour(state, { modul: 'rad', datum: '2026-06-29' });          // Rand-Tag (Vormonat) im Juli-Raster
  macheTour(state, { modul: 'wandern', datum: '2026-08-01' });      // Rand-Tag (Folgemonat) im Juli-Raster
  return state;
}

const HEUTE = '2026-07-15';

// ------------------------------------------------------------
// gesichtFuer
// ------------------------------------------------------------
test('gesichtFuer: vergangen/heute/zukunft', () => {
  assert.equal(gesichtFuer('2026-07-01', HEUTE), 'vergangen');
  assert.equal(gesichtFuer('2026-07-15', HEUTE), 'heute');
  assert.equal(gesichtFuer('2026-07-20', HEUTE), 'zukunft');
});

// ------------------------------------------------------------
// tagMarker
// ------------------------------------------------------------
test('tagMarker: Module in Dashboard-Reihenfolge, Anzahl korrekt', () => {
  const state = bauStandardState();
  const m = tagMarker(state, '2026-07-01');
  assert.deepEqual(m.module, ['kraft', 'rad']);   // kraft vor rad (Dashboard-Reihenfolge)
  assert.equal(m.anzahl, 2);
});

test('tagMarker: offene und übersprungene Touren erzeugen keinen Punkt', () => {
  const state = bauStandardState();
  assert.deepEqual(tagMarker(state, '2026-07-15'), { module: ['wandern'], geplant: [], anzahl: 1 }); // offenes Rad raus
  assert.deepEqual(tagMarker(state, '2026-07-20'), { module: [], geplant: [], anzahl: 0 });           // übersprungen raus
});

test('tagMarker: leerer Tag ist sauber leer', () => {
  const state = bauStandardState();
  assert.deepEqual(tagMarker(state, '2026-07-10'), { module: [], geplant: [], anzahl: 0 });
});

test('tagMarker: Alt-Session ohne modul-Feld zählt als Kraft', () => {
  const state = { sessions: [], bibliothek: [] };
  macheTour(state, { modul: null, datum: '2026-07-03' });
  assert.deepEqual(tagMarker(state, '2026-07-03').module, ['kraft']);
});

// ------------------------------------------------------------
// wochenStreifen
// ------------------------------------------------------------
test('wochenStreifen: 7 Tage, Montag zuerst, Sonntag zuletzt', () => {
  const state = bauStandardState();
  const s = wochenStreifen(state, HEUTE, HEUTE);
  assert.equal(s.tage.length, 7);
  assert.equal(s.tage[0].iso, '2026-07-13');
  assert.equal(s.tage[0].kurz, 'Mo');
  assert.equal(s.tage[6].iso, '2026-07-19');
  assert.equal(s.tage[6].kurz, 'So');
});

test('wochenStreifen: heute markiert, Punkte am richtigen Tag', () => {
  const state = bauStandardState();
  const heute = zelle(wochenStreifen(state, HEUTE, HEUTE), '2026-07-15');
  assert.equal(heute.istHeute, true);
  assert.equal(heute.istZukunft, false);
  assert.deepEqual(heute.module, ['wandern']);
});

// ------------------------------------------------------------
// monatsGitter
// ------------------------------------------------------------
test('monatsGitter: Kopfdaten und Rechteck-Form (volle Wochen)', () => {
  const state = bauStandardState();
  const g = monatsGitter(state, HEUTE, HEUTE);
  assert.equal(g.label, 'Juli 2026');
  assert.equal(g.jahr, 2026);
  assert.equal(g.monat, 7);
  assert.equal(g.wochen.length, 5);                 // 29. Juni – 2. Aug = 5 Wochen
  for (const w of g.wochen) assert.equal(w.length, 7);
});

test('monatsGitter: Rand-Tage der Nachbarmonate sind imMonat:false', () => {
  const state = bauStandardState();
  const g = monatsGitter(state, HEUTE, HEUTE);
  const erste = g.wochen[0][0];
  const letzte = g.wochen.at(-1).at(-1);
  assert.equal(erste.iso, '2026-06-29');
  assert.equal(erste.imMonat, false);
  assert.deepEqual(erste.module, ['rad']);          // Vormonats-Tour trägt trotzdem ihren Punkt
  assert.equal(letzte.iso, '2026-08-02');
  assert.equal(letzte.imMonat, false);
  assert.deepEqual(zelle(g, '2026-08-01').module, ['wandern']);
});

test('monatsGitter: heute, Zukunft und Mehr-Modul-Tag landen richtig', () => {
  const state = bauStandardState();
  const g = monatsGitter(state, HEUTE, HEUTE);
  const heute = zelle(g, '2026-07-15');
  assert.equal(heute.istHeute, true);
  assert.equal(heute.imMonat, true);
  assert.deepEqual(heute.module, ['wandern']);

  assert.equal(zelle(g, '2026-07-20').istZukunft, true);
  assert.deepEqual(zelle(g, '2026-07-20').module, []);      // übersprungen → kein Punkt

  assert.deepEqual(zelle(g, '2026-07-01').module, ['kraft', 'rad']);
});

test('monatsGitter: Jahreswechsel (Dezember → Januar) läuft sauber durch', () => {
  const state = bauStandardState();
  const g = monatsGitter(state, '2026-12-15', '2026-12-15');
  assert.equal(g.label, 'Dezember 2026');
  assert.equal(g.wochen[0][0].iso, '2026-11-30');          // Montag vor dem 1.12.
  const letzte = g.wochen.at(-1).at(-1);
  assert.ok(letzte.iso.startsWith('2027-01'));             // Raster reicht in den Januar
  assert.equal(letzte.imMonat, false);
});

test('monatsGitter: Monat mit anderem Zeitzonen-Risiko (März) ist stabil', () => {
  const state = bauStandardState();
  const g = monatsGitter(state, '2026-03-11', '2026-03-11');
  assert.equal(g.label, 'März 2026');
  assert.equal(zelle(g, '2026-03-01').imMonat, true);
  assert.equal(zelle(g, '2026-03-31').imMonat, true);
});

// ------------------------------------------------------------
// tagDetail
// ------------------------------------------------------------
test('tagDetail: Gesicht + rohe Sessions (neueste zuerst)', () => {
  const state = bauStandardState();
  const d = tagDetail(state, '2026-07-01', HEUTE);
  assert.equal(d.gesicht, 'vergangen');
  assert.equal(d.sessions.length, 2);
});

test('tagDetail: liefert AUCH offene Sessions des Tages (Filterung macht die UI)', () => {
  const state = bauStandardState();
  const d = tagDetail(state, '2026-07-15', HEUTE);
  assert.equal(d.gesicht, 'heute');
  assert.equal(d.sessions.length, 2);   // abgeschlossenes Wandern + offenes Rad
});

test('tagDetail: leerer Zukunftstag hat Gesicht zukunft und keine Sessions', () => {
  const state = bauStandardState();
  const d = tagDetail(state, '2026-09-09', HEUTE);
  assert.equal(d.gesicht, 'zukunft');
  assert.equal(d.sessions.length, 0);
});

// ------------------------------------------------------------
// Planung (Termine) — Etappe 4
// ------------------------------------------------------------
test('neuerTermin: Grundform mit id, datum, modul, erstelltAm, leerer Notiz', () => {
  const t = neuerTermin({ datum: '2026-07-16', modul: 'rad' });
  assert.ok(t.id);
  assert.equal(t.datum, '2026-07-16');
  assert.equal(t.modul, 'rad');
  assert.equal(t.notiz, '');
  assert.ok(t.erstelltAm);
});

test('termineAmTag: filtert nach Datum', () => {
  const state = { sessions: [], bibliothek: [], termine: [
    neuerTermin({ datum: '2026-07-16', modul: 'kraft' }),
    neuerTermin({ datum: '2026-07-17', modul: 'rad' }),
  ] };
  assert.equal(termineAmTag(state, '2026-07-16').length, 1);
  assert.equal(termineAmTag(state, '2026-07-16')[0].modul, 'kraft');
});

test('termineAmTag: ohne termine-Feld liefert leere Liste (robust)', () => {
  assert.deepEqual(termineAmTag({ sessions: [] }, '2026-07-16'), []);
});

test('tagMarker: geplante Module erscheinen als geplant, getrennt von erledigt', () => {
  const state = { sessions: [], bibliothek: [], termine: [
    neuerTermin({ datum: '2026-07-16', modul: 'wandern' }),
    neuerTermin({ datum: '2026-07-16', modul: 'kraft' }),
  ] };
  const m = tagMarker(state, '2026-07-16');
  assert.deepEqual(m.module, []);
  assert.deepEqual(m.geplant, ['kraft', 'wandern']);   // Dashboard-Reihenfolge
  assert.equal(m.anzahl, 0);
});

test('tagMarker: erledigt schlägt geplant — kein Doppelpunkt fürs selbe Modul', () => {
  const state = { sessions: [], bibliothek: [], termine: [
    neuerTermin({ datum: '2026-07-16', modul: 'rad' }),     // rad geplant …
    neuerTermin({ datum: '2026-07-16', modul: 'kraft' }),
  ] };
  macheTour(state, { modul: 'rad', datum: '2026-07-16' });   // … aber rad auch erledigt
  const m = tagMarker(state, '2026-07-16');
  assert.deepEqual(m.module, ['rad']);        // rad gefüllt
  assert.deepEqual(m.geplant, ['kraft']);     // rad rausgefiltert, nur kraft bleibt Umriss
});

test('tagDetail: liefert die Termine des Tages', () => {
  const state = { sessions: [], bibliothek: [], termine: [
    neuerTermin({ datum: '2026-07-16', modul: 'kraft', notiz: 'Beine' }),
  ] };
  const d = tagDetail(state, '2026-07-16', HEUTE);
  assert.equal(d.gesicht, 'zukunft');
  assert.equal(d.termine.length, 1);
  assert.equal(d.termine[0].notiz, 'Beine');
});
