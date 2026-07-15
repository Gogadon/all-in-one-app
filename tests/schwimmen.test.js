import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leererZustand } from '../js/core/storage.js';
import {
  erstelleSchwimmModul, schwimmWerte, schwimmHighlights,
  alleSchwimmeinheiten, schwimmStatistik,
} from '../js/modules/schwimmen.js';

function neuesModul() {
  const state = leererZustand();
  const tabs = { aktiv: 'heute' };
  const ctx = {
    get state() { return state; }, save: async () => {}, render: () => {},
    sheet: { oeffne() {}, schliesse() {}, aktualisiere() {} },
    esc: t => String(t ?? ''), formatDatum: i => i, tabWechsel: (t) => { tabs.aktiv = t; },
  };
  const schwimmen = erstelleSchwimmModul(ctx);
  return { state, schwimmen, tabs };
}

test('Schwimmen: Werte eintragen (Bahnen als Anzahl, Dauer Min:Sek)', async () => {
  const { state, schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '20' });
  await schwimmen.actions['schwimmen.wert']({ typ: 'dauer' }, { value: '30:00' });

  const mw = schwimmWerte(state.sessions[0]);
  assert.equal(mw.bahnen, 20);          // Bahnen bleiben eine reine Anzahl (kein ×1000)
  assert.equal(mw.dauer, 1800);         // 30:00 = 30 min = 1800s (Min:Sek)
});

test('Schwimmen: Dauer nackte Zahl = Minuten', async () => {
  const { state, schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'dauer' }, { value: '45' });
  assert.equal(schwimmWerte(state.sessions[0]).dauer, 2700);   // 45 min = 2700s
});

test('Schwimmen: fertig setzt abgeschlossen', async () => {
  const { state, schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '20' });
  await schwimmen.actions['schwimmen.fertig']();
  assert.equal(state.sessions[0].abgeschlossen, true);
});

test('Schwimmen: Session bekommt das richtige Modul', async () => {
  const { state, schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  assert.equal(state.sessions[0].modul, 'schwimmen');
  assert.equal(alleSchwimmeinheiten(state).length, 1);
});

test('Schwimmen: Highlights erkennen die meisten Bahnen', async () => {
  const { state, schwimmen } = neuesModul();
  // Einheit 1: 20 Bahnen
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '20' });
  await schwimmen.actions['schwimmen.fertig']();
  // Einheit 2: 30 Bahnen (Rekord)
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '30' });
  await schwimmen.actions['schwimmen.fertig']();

  const hl2 = schwimmHighlights(state, state.sessions[1]);
  assert.ok(hl2.some(h => h.name === 'Meiste Bahnen'));

  const hl1 = schwimmHighlights(state, state.sessions[0]);
  assert.ok(!hl1.some(h => h.name === 'Meiste Bahnen'));
});

test('Schwimmen: Statistik summiert Bahnen über alle Einheiten', async () => {
  const { state, schwimmen } = neuesModul();
  for (const b of ['20', '30']) {
    await schwimmen.actions['schwimmen.neu']();
    await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: b });
    await schwimmen.actions['schwimmen.fertig']();
  }
  const stat = schwimmStatistik(state);
  assert.equal(stat.anzahl, 2);
  assert.equal(stat.bahnen, 50);      // 20 + 30
});

test('Schwimmen: Kopf-Statistik zeigt Bahnen gesamt, nicht km', async () => {
  const { schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '25' });
  await schwimmen.actions['schwimmen.fertig']();
  const html = schwimmen.heuteHtml();
  assert.ok(html.includes('Bahnen gesamt'));
  assert.ok(!html.includes('km gesamt'));   // Default-km ist überschrieben
  assert.ok(!html.includes('Höhenmeter'));
});

test('Schwimmen: Statistik-Ansicht zeigt Umschalter, Einheiten-Zahl und Bahnen', async () => {
  const { schwimmen } = neuesModul();
  for (const b of ['20', '30']) {
    await schwimmen.actions['schwimmen.neu']();
    await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: b });
    await schwimmen.actions['schwimmen.fertig']();
  }
  const html = schwimmen.statistikHtml();
  assert.ok(html.includes('schwimmen.statArt'));
  assert.ok(html.includes('Statistik'));
  assert.ok(html.includes('2 Einheiten'));
  assert.ok(html.includes('Bahnen'));
});

// ---- Meter-Umrechnung über die Bahnlänge (Etappe 2) ----

test('Schwimmen: Bahnlänge berechnet die Distanz (Bahnen × Länge)', async () => {
  const { state, schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '20' });
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnlaenge' }, { value: '25' });
  assert.equal(schwimmWerte(state.sessions[0]).distanz, 500);   // 20 × 25 m
});

test('Schwimmen: ohne Bahnlänge gibt es keine Distanz', async () => {
  const { state, schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '20' });
  assert.equal(schwimmWerte(state.sessions[0]).distanz, undefined);
});

test('Schwimmen: Änderung von Bahnen/Bahnlänge zieht die Distanz nach', async () => {
  const { state, schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '20' });
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnlaenge' }, { value: '25' });
  assert.equal(schwimmWerte(state.sessions[0]).distanz, 500);
  // Bahnen erhöhen → Distanz neu berechnet
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '30' });
  assert.equal(schwimmWerte(state.sessions[0]).distanz, 750);
  // Bahnlänge leeren → Distanz verschwindet (kein geratener Wert)
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnlaenge' }, { value: '' });
  assert.equal(schwimmWerte(state.sessions[0]).distanz, undefined);
});

test('Schwimmen: berechnete Distanz erscheint in der Statistik (Meter)', async () => {
  const { schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '20' });
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnlaenge' }, { value: '25' });
  await schwimmen.actions['schwimmen.fertig']();
  const html = schwimmen.statistikHtml();
  assert.ok(html.includes('500 m'));   // als Meter, nicht km
});

test('Schwimmen: leerer Zeitraum zeigt einen Hinweis', async () => {
  const { schwimmen } = neuesModul();
  await schwimmen.actions['schwimmen.neu']();
  await schwimmen.actions['schwimmen.wert']({ typ: 'bahnen' }, { value: '20' });
  await schwimmen.actions['schwimmen.fertig']();
  await schwimmen.actions['schwimmen.statZurueck']();
  await schwimmen.actions['schwimmen.statZurueck']();
  const html = schwimmen.statistikHtml();
  assert.ok(html.includes('Keine Einheiten'));
});
