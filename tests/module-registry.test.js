// ============================================================
// tests/module-registry.test.js
//
// Die Registry ist die eine Stelle, an der ein Modul eingetragen wird.
// Diese Tests prüfen deshalb weniger einzelne Werte als die Vollständigkeit:
// Wer ein siebtes Modul hinzufügt und ein Feld vergisst, soll das hier
// erfahren — und nicht daran, dass irgendwo „undefined" in der Navi steht.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installiereBrowserAttrappe, testKontext } from './helpers/umgebung.js';

installiereBrowserAttrappe();

const { leererZustand } = await import('../js/core/storage.js');
const { esc, formatDatum } = await import('../js/ui/components.js');
const {
  MODULE, modulNach, sessionNameFuer, erstelleModule,
  PLANBARE_MODULE, MODUL_TABS, MODUL_LABEL,
  KRAFT, RAD, WANDERN, SCHWIMMEN, KOERPER, CHALLENGE,
} = await import('../js/module-registry.js');

test('Registry: jedes Modul ist vollständig beschrieben', () => {
  assert.ok(MODULE.length >= 6);
  for (const m of MODULE) {
    assert.equal(typeof m.id, 'string', 'id');
    assert.ok(m.label?.length, `${m.id}: label`);
    assert.match(m.icon ?? '', /^<svg /, `${m.id}: icon`);
    assert.equal(typeof m.erstelle, 'function', `${m.id}: erstelle`);
    assert.equal(typeof m.status, 'function', `${m.id}: status`);
    assert.ok(Array.isArray(m.tabs) && m.tabs.length, `${m.id}: tabs`);
    assert.equal(m.tabs[0], 'dashboard', `${m.id}: „Start" führt heim`);
    assert.ok(m.tabs.includes('heute'), `${m.id}: hat einen Heute-Tab`);
    assert.equal(typeof m.planbar, 'boolean', `${m.id}: planbar`);
  }
});

test('Registry: IDs sind eindeutig und auffindbar', () => {
  const ids = MODULE.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length, 'keine doppelte ID');
  for (const id of ids) assert.equal(modulNach(id)?.id, id);
  assert.equal(modulNach('gibtsnicht'), null);
});

test('Registry: die abgeleiteten Tabellen passen zur Liste', () => {
  assert.deepEqual(Object.keys(MODUL_TABS), MODULE.map(m => m.id));
  assert.deepEqual(Object.keys(MODUL_LABEL), MODULE.map(m => m.id));
  assert.deepEqual(PLANBARE_MODULE, [KRAFT, RAD, WANDERN, SCHWIMMEN]);
  // Körper und Challenge sind nichts, was man in den Kalender plant.
  assert.ok(!PLANBARE_MODULE.includes(KOERPER));
  assert.ok(!PLANBARE_MODULE.includes(CHALLENGE));
  // Nur Kraft hat einen Zyklus-Plan.
  assert.ok(MODUL_TABS[KRAFT].includes('plan'));
  for (const id of [RAD, WANDERN, SCHWIMMEN, KOERPER, CHALLENGE]) {
    assert.ok(!MODUL_TABS[id].includes('plan'), `${id} hat keinen Plan-Tab`);
  }
});

test('Registry: jedes Touren-Modul bringt seinen eigenen Session-Namen mit', () => {
  // Genau hier lag der Fehler: eine Tabelle kannte Schwimmen nicht, also
  // hieß jede Schwimmeinheit „Wanderung".
  const namen = [RAD, WANDERN, SCHWIMMEN].map(sessionNameFuer);
  assert.equal(new Set(namen).size, 3, 'drei verschiedene Namen');
  for (const n of namen) assert.ok(n?.length, 'kein leerer Name');
  assert.match(sessionNameFuer(SCHWIMMEN), /Schwimm/);
  // Kraft-Sessions heißen nach ihrer Einheit, brauchen also keinen Fallback.
  assert.equal(sessionNameFuer(KRAFT), null);
  assert.equal(sessionNameFuer('gibtsnicht'), null);
});

test('Registry: Touren-Module haben eine eigene Verlauf-Ansicht, Kraft nicht', () => {
  for (const id of [RAD, WANDERN, SCHWIMMEN]) {
    const m = modulNach(id);
    assert.equal(m.tour, true);
    assert.equal(typeof m.verlaufHtml, 'function', `${id}: eigene Verlauf-Ansicht`);
    assert.equal(m.verlaufLabel, 'Statistik');
  }
  // Kraft behält den Feed der Hülle — kein verlaufHtml in der Registry.
  assert.equal(modulNach(KRAFT).verlaufHtml, undefined);
});

test('Registry: Statuszeilen liefern auch im leeren Zustand sauberen Text', () => {
  const state = leererZustand();
  for (const m of MODULE) {
    const s = m.status(state);
    assert.equal(typeof s, 'string', `${m.id}: Status ist Text`);
    assert.ok(s.length > 0, `${m.id}: Status nicht leer`);
    for (const muell of ['undefined', 'NaN', 'null']) {
      assert.ok(!s.includes(muell), `${m.id}: Status zeigt „${muell}"`);
    }
  }
});

test('Registry: erstelleModule baut jedes Modul und findet es wieder', () => {
  const state = leererZustand();
  const { ctx } = testKontext(state, { esc, formatDatum });
  const gebaut = erstelleModule(ctx);

  assert.equal(gebaut.liste.length, MODULE.length);
  for (const m of gebaut.liste) {
    assert.equal(typeof m.instanz.heuteHtml, 'function', `${m.id}: heuteHtml`);
    assert.ok(m.instanz.actions, `${m.id}: actions`);
    assert.equal(gebaut.nach(m.id)?.id, m.id);
  }
  assert.equal(gebaut.nach('gibtsnicht'), null);
  // Kraft ist das einzige Modul mit Plan-Ansicht.
  assert.equal(typeof gebaut.nach(KRAFT).instanz.planHtml, 'function');
});

test('Registry: keine zwei Module beanspruchen denselben Aktionsnamen', () => {
  // Alle Aktionen landen in EINER Tabelle. Kollidieren zwei Namen, gewinnt
  // stillschweigend das später gebaute Modul — ein Fehler, der sich als
  // „der Knopf tut das Falsche" zeigt und schwer zu finden ist.
  const state = leererZustand();
  const { ctx } = testKontext(state, { esc, formatDatum });
  const gebaut = erstelleModule(ctx);

  const gesehen = new Map();
  for (const m of gebaut.liste) {
    for (const name of Object.keys(m.instanz.actions)) {
      assert.ok(!gesehen.has(name),
        `Aktion „${name}" gibt es in ${gesehen.get(name)} UND in ${m.id}`);
      gesehen.set(name, m.id);
    }
  }
  // und die Sammeltabelle hat wirklich alle.
  assert.equal(Object.keys(gebaut.actions).length, gesehen.size);
});
