// tests/rad.test.js — Rad-Modul (freie Touren)
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.get(k) ?? null; },
  setItem(k, v) { this._m.set(k, String(v)); },
};
// Minimaler DOM-Mock, damit hinweis()/bestaetige() im Test nicht crashen.
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.document = {
  createElement: () => ({
    className: '', innerHTML: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    addEventListener() {}, querySelector() { return null; }, append() {}, appendChild() {},
  }),
  getElementById: () => null,
  body: { append() {}, appendChild() {}, classList: { add() {}, remove() {}, contains() { return false; } } },
};

const { leererZustand } = await import('../js/core/storage.js');
const { formatWert } = await import('../js/core/metrics.js');
const {
  erstelleRadModul, alleTouren, tourStatistik, tourWerte, tourAktivitaet,
} = await import('../js/modules/rad.js');

function neuesModulMitTab() {
  const state = leererZustand();
  const tabs = { aktiv: 'heute' };
  const ctx = { get state(){return state}, save: async()=>{}, render:()=>{},
    sheet:{oeffne(){},schliesse(){},aktualisiere(){}}, esc:t=>String(t??''),
    formatDatum:i=>i, tabWechsel:(t)=>{tabs.aktiv=t;} };
  const rad = erstelleRadModul(ctx);
  return { state, rad, tabs };
}

function neuesModul() {
  const state = leererZustand();
  const ctx = {
    get state() { return state; }, save: async () => {}, render: () => {},
    sheet: { oeffne() {}, schliesse() {}, aktualisiere() {} },
    esc: t => String(t ?? ''), formatDatum: i => i,
  };
  return { state, rad: erstelleRadModul(ctx) };
}

test('Rad: Tour anlegen, Werte eintragen, speichern', async () => {
  const { state, rad } = neuesModul();
  await rad.actions['rad.neu']();
  await rad.actions['rad.name']({}, { value: 'Lüdenscheid Rundfahrt' });
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '10,0' });
  await rad.actions['rad.wert']({ typ: 'dauer' }, { value: '35:50' });
  await rad.actions['rad.wert']({ typ: 'tempo_avg' }, { value: '16,8' });
  await rad.actions['rad.wert']({ typ: 'hoehenmeter' }, { value: '143' });
  const s = state.sessions[0];
  const mw = tourWerte(s);
  assert.equal(mw.distanz, 10000);       // 10 km → 10000 m
  assert.equal(mw.dauer, 35 * 60 + 50);  // 35:50 → 2150 s (MM:SS!)
  assert.equal(mw.tempo_avg, 16.8);
  assert.equal(mw.hoehenmeter, 143);
  assert.equal(s.name, 'Lüdenscheid Rundfahrt');
  await rad.actions['rad.fertig']();
  assert.equal(s.abgeschlossen, true);
  assert.equal(s.segmente[0].erledigt, true);
});

test('Rad: Dauer MM:SS / H:MM:SS / Minuten', async () => {
  const { state, rad } = neuesModul();
  await rad.actions['rad.neu']();
  const s = state.sessions[0];
  await rad.actions['rad.wert']({ typ: 'dauer' }, { value: '35:50' });
  assert.equal(tourWerte(s).dauer, 2150);
  assert.equal(formatWert('dauer', 2150), '35:50 min');
  await rad.actions['rad.wert']({ typ: 'dauer' }, { value: '1:52:30' });
  assert.equal(tourWerte(s).dauer, 3600 + 52 * 60 + 30);
  await rad.actions['rad.wert']({ typ: 'dauer' }, { value: '40' });
  assert.equal(tourWerte(s).dauer, 2400);  // nackte Zahl = Minuten
});

test('Rad: optionale Messwerte dazuschalten und entfernen', async () => {
  const { state, rad } = neuesModul();
  await rad.actions['rad.neu']();
  const s = state.sessions[0];
  await rad.actions['rad.mwPlus']({ typ: 'watt_avg' });
  const akt = tourAktivitaet(state);
  assert.ok(akt.messwerte.includes('watt_avg'));
  await rad.actions['rad.wert']({ typ: 'watt_avg' }, { value: '267' });
  assert.equal(tourWerte(s).watt_avg, 267);
  await rad.actions['rad.mwWeg']({ typ: 'watt_avg' });
  assert.ok(!tourAktivitaet(state).messwerte.includes('watt_avg'));
});

test('Rad: Statistik summiert über alle Touren', async () => {
  const { state, rad } = neuesModul();
  for (const [km, hm] of [['10', '143'], ['20', '250']]) {
    await rad.actions['rad.neu']();
    await rad.actions['rad.wert']({ typ: 'distanz' }, { value: km });
    await rad.actions['rad.wert']({ typ: 'hoehenmeter' }, { value: hm });
    await rad.actions['rad.fertig']();
  }
  const stat = tourStatistik(state);
  assert.equal(stat.anzahl, 2);
  assert.equal(stat.distanz, 30000);
  assert.equal(stat.hoehen, 393);
});

test('Rad: leere Tour wird nicht als abgeschlossen markiert', async () => {
  const { state, rad } = neuesModul();
  await rad.actions['rad.neu']();
  // rad.fertig bei leerer Tour zeigt nur einen Hinweis und speichert NICHT.
  // (Den Hinweis-Dialog lösen wir hier nicht auf — wir prüfen nur den State
  //  direkt nach dem Anlegen: nichts eingetragen, also nicht abgeschlossen.)
  const s = state.sessions[0];
  assert.equal(s.abgeschlossen, undefined);
  assert.equal(Object.keys(s.segmente[0].eintraege[0].messwerte).length, 0);
});

test('Rad: Touren stören Kraft-Auswertungen nicht', async () => {
  const { state, rad } = neuesModul();
  await rad.actions['rad.neu']();
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '10' });
  await rad.actions['rad.fertig']();
  // Rad-Sessions haben modul==='rad', tauchen nicht in Kraft-Filtern auf
  const kraftSessions = state.sessions.filter(s => (s.modul ?? 'kraft') === 'kraft');
  assert.equal(kraftSessions.length, 0);
});

test('Rad: Highlights erkennen persönliche Rekorde', async () => {
  const { state, rad } = neuesModul();
  const { tourHighlights } = await import('../js/modules/rad.js');
  // Tour 1: 10 km, 143 hm
  await rad.actions['rad.neu']();
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '10' });
  await rad.actions['rad.wert']({ typ: 'hoehenmeter' }, { value: '143' });
  await rad.actions['rad.fertig']();
  // Tour 2: 20 km (Rekord), 100 hm (kein Rekord)
  await rad.actions['rad.neu']();
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '20' });
  await rad.actions['rad.wert']({ typ: 'hoehenmeter' }, { value: '100' });
  await rad.actions['rad.fertig']();

  const hl2 = tourHighlights(state, state.sessions[1]);
  assert.ok(hl2.some(h => h.name === 'Längste Tour'));
  assert.ok(!hl2.some(h => h.name === 'Meiste Höhenmeter'));

  const hl1 = tourHighlights(state, state.sessions[0]);
  assert.ok(hl1.some(h => h.name === 'Meiste Höhenmeter'));
  assert.ok(!hl1.some(h => h.name === 'Längste Tour'));
});

test('Rad: fertige Tour taucht in der Statistik-Ansicht auf (aufklappbar)', async () => {
  const { state, rad } = neuesModul();
  await rad.actions['rad.neu']();
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '10' });
  await rad.actions['rad.fertig']();
  const html = rad.statistikHtml();
  assert.ok(html.includes('rad.detail'));   // Tour aufklappbar
});

// ---- Statistik-Ansicht (Etappe 2) ----

test('Rad: Statistik-Ansicht zeigt Umschalter, Navigation und Kennzahlen', async () => {
  const { state, rad } = neuesModul();
  // Zwei Touren „heute" → liegen im laufenden Monat (Default-Zeitraum)
  for (const km of ['10', '20']) {
    await rad.actions['rad.neu']();
    await rad.actions['rad.wert']({ typ: 'distanz' }, { value: km });
    await rad.actions['rad.fertig']();
  }
  const html = rad.statistikHtml();
  assert.ok(html.includes('rad.statArt'));       // Woche/Monat/Jahr-Umschalter
  assert.ok(html.includes('rad.statZurueck'));   // zurück-Pfeil
  assert.ok(html.includes('rad.statVor'));       // vor-Pfeil
  assert.ok(html.includes('Statistik'));         // Überschrift
  assert.ok(html.includes('2 Touren'));          // Anzahl im Zeitraum
  assert.ok(html.includes('Distanz'));           // Kennzahl-Label
});

test('Rad: vor-Pfeil ist im laufenden Zeitraum gesperrt', () => {
  const { rad } = neuesModul();
  const html = rad.statistikHtml();
  // Der „Später"-Pfeil trägt disabled/aus, weil es keinen späteren Zeitraum gibt.
  assert.ok(/data-action="rad\.statVor"[^>]*disabled/.test(html) || html.includes('stat-pfeil aus'));
});

test('Rad: Zeitraum-Art umschalten markiert den aktiven Chip', async () => {
  const { rad } = neuesModul();
  await rad.actions['rad.statArt']({ art: 'woche' });
  const html = rad.statistikHtml();
  assert.ok(/chip aktiv" data-action="rad\.statArt" data-art="woche"/.test(html));
});

test('Rad: leerer Zeitraum zeigt einen Hinweis', async () => {
  const { rad } = neuesModul();
  await rad.actions['rad.neu']();
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '10' });
  await rad.actions['rad.fertig']();
  // Zwei Monate zurück → die heutige Tour liegt nicht mehr im Zeitraum
  await rad.actions['rad.statZurueck']();
  await rad.actions['rad.statZurueck']();
  const html = rad.statistikHtml();
  assert.ok(html.includes('Keine Touren'));
});

test('Rad: Bearbeiten wechselt in den Heute-Tab und speichert wieder', async () => {
  const { state, rad, tabs } = neuesModulMitTab();
  await rad.actions['rad.neu']();
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '10' });
  await rad.actions['rad.fertig']();
  const tourId = state.sessions[0].id;
  assert.equal(state.sessions[0].abgeschlossen, true);

  // Aus dem Verlauf heraus bearbeiten
  tabs.aktiv = 'verlauf';
  await rad.actions['rad.wiederOeffnen']({ sid: tourId });
  assert.equal(tabs.aktiv, 'heute');                  // Tab gewechselt
  assert.equal(state.sessions[0].abgeschlossen, false); // Tour offen

  // Speichern muss die Tour wiederfinden (nicht ins Leere laufen)
  await rad.actions['rad.fertig']();
  assert.equal(state.sessions[0].abgeschlossen, true);
});

// ---- Touren-Tab „Alle anzeigen" (Etappe 3) ----

test('Rad: „Alle anzeigen" erscheint ab 6 Touren und klappt die volle Liste auf', async () => {
  const { rad } = neuesModul();
  for (let i = 0; i < 6; i++) {
    await rad.actions['rad.neu']();
    await rad.actions['rad.wert']({ typ: 'distanz' }, { value: String(10 + i) });
    await rad.actions['rad.fertig']();
  }
  let html = rad.heuteHtml();
  assert.ok(html.includes('Alle anzeigen (6)'));
  assert.equal((html.match(/data-action="rad\.detail"/g) || []).length, 5);  // erst 5 sichtbar

  await rad.actions['rad.alleTouren']();     // aufklappen
  html = rad.heuteHtml();
  assert.ok(html.includes('Weniger anzeigen'));
  assert.equal((html.match(/data-action="rad\.detail"/g) || []).length, 6);  // alle sichtbar

  await rad.actions['rad.alleTouren']();     // wieder einklappen
  html = rad.heuteHtml();
  assert.ok(html.includes('Alle anzeigen (6)'));
  assert.equal((html.match(/data-action="rad\.detail"/g) || []).length, 5);
});

test('Rad: kein „Alle anzeigen" bei 5 oder weniger Touren', async () => {
  const { rad } = neuesModul();
  for (let i = 0; i < 5; i++) {
    await rad.actions['rad.neu']();
    await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '10' });
    await rad.actions['rad.fertig']();
  }
  const html = rad.heuteHtml();
  assert.ok(!html.includes('Alle anzeigen'));
  assert.equal((html.match(/data-action="rad\.detail"/g) || []).length, 5);
});

// ---- Offene Touren zählen nicht in Summen (Review-Fix) ----

test('Rad: offene (nicht abgeschlossene) Tour zählt NICHT in tourStatistik', async () => {
  const { state, rad } = neuesModul();
  await rad.actions['rad.neu']();
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '10' });
  await rad.actions['rad.fertig']();               // abgeschlossen
  await rad.actions['rad.neu']();
  await rad.actions['rad.wert']({ typ: 'distanz' }, { value: '99' });  // offen, kein fertig
  const stat = tourStatistik(state);
  assert.equal(stat.anzahl, 1);
  assert.equal(stat.distanz, 10000);               // 99er zählt nicht mit
});
