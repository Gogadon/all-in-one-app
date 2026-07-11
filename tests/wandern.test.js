import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leererZustand } from '../js/core/storage.js';
import {
  erstelleWanderModul, wanderWerte, wanderHighlights, alleWanderungen, wanderStatistik,
} from '../js/modules/wandern.js';

function neuesModul() {
  const state = leererZustand();
  const tabs = { aktiv: 'heute' };
  const ctx = {
    get state() { return state; }, save: async () => {}, render: () => {},
    sheet: { oeffne() {}, schliesse() {}, aktualisiere() {} },
    esc: t => String(t ?? ''), formatDatum: i => i, tabWechsel: (t) => { tabs.aktiv = t; },
  };
  const wandern = erstelleWanderModul(ctx);
  return { state, wandern, tabs };
}

test('Wandern: Werte eintragen (Distanz km, Dauer Std:Min, Schritte)', async () => {
  const { state, wandern } = neuesModul();
  await wandern.actions['wandern.neu']();
  await wandern.actions['wandern.wert']({ typ: 'distanz' }, { value: '8,5' });
  await wandern.actions['wandern.wert']({ typ: 'hoehenmeter' }, { value: '420' });
  await wandern.actions['wandern.wert']({ typ: 'dauer' }, { value: '2:30' });
  await wandern.actions['wandern.wert']({ typ: 'schritte' }, { value: '12000' });

  const mw = wanderWerte(state.sessions[0]);
  assert.equal(mw.distanz, 8500);       // km → Meter
  assert.equal(mw.hoehenmeter, 420);
  assert.equal(mw.dauer, 9000);         // 2:30 = 2h30 = 9000s (Std:Min, nicht Min:Sek)
  assert.equal(mw.schritte, 12000);
});

test('Wandern: Dauer nackte Zahl = Minuten', async () => {
  const { state, wandern } = neuesModul();
  await wandern.actions['wandern.neu']();
  await wandern.actions['wandern.wert']({ typ: 'dauer' }, { value: '90' });
  assert.equal(wanderWerte(state.sessions[0]).dauer, 5400);   // 90 min = 5400s
});

test('Wandern: fertig setzt abgeschlossen', async () => {
  const { state, wandern } = neuesModul();
  await wandern.actions['wandern.neu']();
  await wandern.actions['wandern.wert']({ typ: 'distanz' }, { value: '5' });
  await wandern.actions['wandern.fertig']();
  assert.equal(state.sessions[0].abgeschlossen, true);
});

test('Wandern: Bearbeiten wechselt in den Heute-Tab', async () => {
  const { state, wandern, tabs } = neuesModul();
  await wandern.actions['wandern.neu']();
  await wandern.actions['wandern.wert']({ typ: 'distanz' }, { value: '5' });
  await wandern.actions['wandern.fertig']();
  tabs.aktiv = 'verlauf';
  await wandern.actions['wandern.wiederOeffnen']({ sid: state.sessions[0].id });
  assert.equal(tabs.aktiv, 'heute');
  assert.equal(state.sessions[0].abgeschlossen, false);
});

test('Wandern: Highlights erkennen Rekorde gegen andere Wanderungen', async () => {
  const { state, wandern } = neuesModul();
  // Tour 1: 5 km, 300 hm
  await wandern.actions['wandern.neu']();
  await wandern.actions['wandern.wert']({ typ: 'distanz' }, { value: '5' });
  await wandern.actions['wandern.wert']({ typ: 'hoehenmeter' }, { value: '300' });
  await wandern.actions['wandern.fertig']();
  // Tour 2: 10 km (Rekord), 200 hm (kein Rekord)
  await wandern.actions['wandern.neu']();
  await wandern.actions['wandern.wert']({ typ: 'distanz' }, { value: '10' });
  await wandern.actions['wandern.wert']({ typ: 'hoehenmeter' }, { value: '200' });
  await wandern.actions['wandern.fertig']();

  const hl2 = wanderHighlights(state, state.sessions[1]);
  assert.ok(hl2.some(h => h.name === 'Längste Wanderung'));
  assert.ok(!hl2.some(h => h.name === 'Meiste Höhenmeter'));
});

test('Wandern: Statistik summiert über alle Wanderungen', async () => {
  const { state, wandern } = neuesModul();
  for (const km of ['5', '8']) {
    await wandern.actions['wandern.neu']();
    await wandern.actions['wandern.wert']({ typ: 'distanz' }, { value: km });
    await wandern.actions['wandern.fertig']();
  }
  const stat = wanderStatistik(state);
  assert.equal(stat.anzahl, 2);
  assert.equal(stat.distanz, 13000);   // 5+8 km in Metern
});
