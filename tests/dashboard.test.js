// tests/dashboard.test.js — modulübergreifende Wochen-/Zeitraum-Übersicht
// (reiner Kern der Orchestrierungs-Schicht, kein DOM)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag,
} = await import('../js/core/model.js');
const {
  wochenUebersicht, zeitraumUebersicht, DASHBOARD_MODULE,
} = await import('../js/dashboard.js');

// ------------------------------------------------------------
// Hilfs-Fabriken
// ------------------------------------------------------------

/** Rad/Wandern-Tour: 1 Segment, 1 Eintrag mit Messwerten. */
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

/**
 * Kraft-Einheit: ein Segment mit Sätzen [gewicht, wdh, warm?].
 * ohneModul=true → simuliert eine Alt-Session ohne `modul`-Feld.
 */
function macheKraft(state, {
  datum, saetze = [[80, 8]], erledigt = true,
  abgeschlossen = true, uebersprungen = false, ohneModul = false,
} = {}) {
  const s = neueSession({ datum });
  if (!ohneModul) s.modul = 'kraft';
  if (abgeschlossen) s.abgeschlossen = true;
  if (uebersprungen) s.uebersprungen = true;
  const seg = addSegment(s, neuesSegment('akt-kraft'));
  seg.erledigt = erledigt;
  for (const [gewicht, wdh, warm] of saetze) {
    addEintrag(seg, neuerEintrag({ gewicht, wdh }, { flags: warm ? ['aufwaermsatz'] : [] }));
  }
  state.sessions.push(s);
  return s;
}

function leererState() { return { sessions: [] }; }

/** Modul-Eintrag aus dem Ergebnis holen. */
function modul(u, name) { return u.module.find(m => m.modul === name); }

// Bezugswoche: 2026-07-08 (Mi) → Mo 06.07. bis (exkl.) Mo 13.07.
const MI = '2026-07-08';

// ============================================================
// Grundgerüst & leerer Zustand
// ============================================================

test('leerer Zustand: alles 0, alle Module vorhanden und leer', () => {
  const u = wochenUebersicht(leererState(), MI);
  assert.equal(u.art, 'woche');
  assert.equal(u.von, '2026-07-06');
  assert.equal(u.bis, '2026-07-13');   // exklusiv
  assert.equal(u.aktivitaeten, 0);
  assert.equal(u.aktiveTage, 0);
  assert.deepEqual(u.module.map(m => m.modul), ['kraft', 'rad', 'wandern']);
  for (const m of u.module) assert.equal(m.anzahl, 0);
});

test('Modul-Reihenfolge ist stabil (kraft, rad, wandern)', () => {
  assert.deepEqual([...DASHBOARD_MODULE], ['kraft', 'rad', 'wandern']);
  const u = wochenUebersicht(leererState(), MI);
  assert.deepEqual(u.module.map(m => m.modul), [...DASHBOARD_MODULE]);
});

// ============================================================
// Kopfzeile: Aktivitäten & aktive Tage (modulübergreifend)
// ============================================================

test('Kopf zählt alle Module zusammen; aktive Tage = verschiedene Kalendertage', () => {
  const state = leererState();
  // Zwei Aktivitäten am SELBEN Tag (Kraft + Rad) → 1 aktiver Tag, 2 Aktivitäten.
  macheKraft(state, { datum: '2026-07-06' });
  macheTour(state, { modul: 'rad', datum: '2026-07-06', mw: { distanz: 10000 } });
  // Eine weitere an einem anderen Tag → 2. aktiver Tag.
  macheTour(state, { modul: 'wandern', datum: '2026-07-09', mw: { distanz: 8000 } });

  const u = wochenUebersicht(state, MI);
  assert.equal(u.aktivitaeten, 3);
  assert.equal(u.aktiveTage, 2);
  // Kopf-Summe = Summe der Modul-Anzahlen (heute deckungsgleich).
  assert.equal(u.aktivitaeten, u.module.reduce((n, m) => n + m.anzahl, 0));
});

// ============================================================
// Nur wertbare Touren zählen (abgeschlossen & nicht übersprungen)
// ============================================================

test('offene und übersprungene Touren zählen nirgends mit', () => {
  const state = leererState();
  macheTour(state, { modul: 'rad', datum: '2026-07-07', mw: { distanz: 20000 } });          // zählt
  macheTour(state, { modul: 'rad', datum: '2026-07-07', mw: { distanz: 99000 }, abgeschlossen: false }); // offen
  macheTour(state, { modul: 'rad', datum: '2026-07-08', mw: { distanz: 99000 }, uebersprungen: true });  // übersprungen

  const u = wochenUebersicht(state, MI);
  assert.equal(u.aktivitaeten, 1);
  assert.equal(u.aktiveTage, 1);
  assert.equal(modul(u, 'rad').anzahl, 1);
  assert.equal(modul(u, 'rad').kennzahlen.distanz, 20000);
});

test('offene Kraft-Einheit trägt weder Einheit noch Volumen bei', () => {
  const state = leererState();
  macheKraft(state, { datum: '2026-07-06', saetze: [[100, 10]], abgeschlossen: false });
  const u = wochenUebersicht(state, MI);
  assert.equal(u.aktivitaeten, 0);
  assert.equal(modul(u, 'kraft').anzahl, 0);
  assert.equal(modul(u, 'kraft').kennzahlen.volumen, 0);
});

// ============================================================
// Kraft-Zeile: Einheiten + Volumen (kg)
// ============================================================

test('Kraft: Einheiten gezählt, Volumen = Σ gewicht×wdh ohne Aufwärmen', () => {
  const state = leererState();
  // Aufwärmsatz [90,10,true] zählt NICHT, Arbeitssätze 80×8 + 82,5×6 = 1135.
  macheKraft(state, { datum: '2026-07-06', saetze: [[90, 10, true], [80, 8], [82.5, 6]] });
  macheKraft(state, { datum: '2026-07-08', saetze: [[100, 5]] });   // + 500

  const k = modul(wochenUebersicht(state, MI), 'kraft');
  assert.equal(k.anzahl, 2);
  assert.equal(k.kennzahlen.volumen, 1135 + 500);
});

test('Kraft: nicht abgehakte Segmente zählen nicht ins Volumen (Einheit bleibt)', () => {
  const state = leererState();
  macheKraft(state, { datum: '2026-07-06', saetze: [[80, 8]], erledigt: false });
  const k = modul(wochenUebersicht(state, MI), 'kraft');
  assert.equal(k.anzahl, 1);            // abgeschlossene Einheit zählt
  assert.equal(k.kennzahlen.volumen, 0); // aber kein abgehaktes Segment → 0 kg
});

test('Alt-Session ohne modul-Feld wird als Kraft gewertet', () => {
  const state = leererState();
  macheKraft(state, { datum: '2026-07-07', saetze: [[50, 10]], ohneModul: true });
  const u = wochenUebersicht(state, MI);
  assert.equal(u.aktivitaeten, 1);
  assert.equal(modul(u, 'kraft').anzahl, 1);
  assert.equal(modul(u, 'kraft').kennzahlen.volumen, 500);
  assert.equal(modul(u, 'rad').anzahl, 0);
});

// ============================================================
// Touren-Module: Touren + Distanz (Meter, Registry-Aggregation)
// ============================================================

test('Rad & Wandern: Touren gezählt, Distanz summiert (in Metern)', () => {
  const state = leererState();
  macheTour(state, { modul: 'rad', datum: '2026-07-06', mw: { distanz: 10500, hoehenmeter: 120 } });
  macheTour(state, { modul: 'rad', datum: '2026-07-09', mw: { distanz: 24000, hoehenmeter: 300 } });
  macheTour(state, { modul: 'wandern', datum: '2026-07-11', mw: { distanz: 8000, schritte: 11000 } });

  const u = wochenUebersicht(state, MI);
  const rad = modul(u, 'rad');
  assert.equal(rad.anzahl, 2);
  assert.equal(rad.kennzahlen.distanz, 34500);       // Meter, summiert
  assert.equal(rad.kennzahlen.hoehenmeter, 420);     // gratis mitgeliefert
  const wandern = modul(u, 'wandern');
  assert.equal(wandern.anzahl, 1);
  assert.equal(wandern.kennzahlen.distanz, 8000);
});

test('Modul ohne Touren im Zeitraum: anzahl 0, leere kennzahlen (UI blendet aus)', () => {
  const state = leererState();
  macheTour(state, { modul: 'rad', datum: '2026-07-06', mw: { distanz: 10000 } });
  const wandern = modul(wochenUebersicht(state, MI), 'wandern');
  assert.equal(wandern.anzahl, 0);
  assert.equal(wandern.kennzahlen.distanz, undefined);   // nichts vorhanden
});

// ============================================================
// Zeitraum-Grenzen & Anker
// ============================================================

test('bis ist exklusiv: nur Touren innerhalb [von, bis) zählen', () => {
  const state = leererState();
  macheTour(state, { modul: 'rad', datum: '2026-07-05', mw: { distanz: 1000 } }); // Vorwoche (So)
  macheTour(state, { modul: 'rad', datum: '2026-07-06', mw: { distanz: 2000 } }); // Mo, drin
  macheTour(state, { modul: 'rad', datum: '2026-07-12', mw: { distanz: 3000 } }); // So, drin
  macheTour(state, { modul: 'rad', datum: '2026-07-13', mw: { distanz: 4000 } }); // Folge-Mo, raus

  const rad = modul(wochenUebersicht(state, MI), 'rad');
  assert.equal(rad.anzahl, 2);
  assert.equal(rad.kennzahlen.distanz, 2000 + 3000);
});

test('anker wählt die Woche: derselbe Datensatz, andere Woche → andere Zahlen', () => {
  const state = leererState();
  macheTour(state, { modul: 'rad', datum: '2026-07-08', mw: { distanz: 5000 } });   // Bezugswoche
  macheTour(state, { modul: 'rad', datum: '2026-07-15', mw: { distanz: 9000 } });   // Folgewoche

  const diese = wochenUebersicht(state, MI);
  assert.equal(diese.aktivitaeten, 1);
  assert.equal(modul(diese, 'rad').kennzahlen.distanz, 5000);

  const naechste = wochenUebersicht(state, '2026-07-15');
  assert.equal(naechste.aktivitaeten, 1);
  assert.equal(modul(naechste, 'rad').kennzahlen.distanz, 9000);
});

test('wochenUebersicht = zeitraumUebersicht(state, "woche", anker)', () => {
  const state = leererState();
  macheKraft(state, { datum: '2026-07-06', saetze: [[80, 8]] });
  macheTour(state, { modul: 'rad', datum: '2026-07-08', mw: { distanz: 12000 } });
  assert.deepEqual(
    wochenUebersicht(state, MI),
    zeitraumUebersicht(state, 'woche', MI),
  );
});

test('zeitraumUebersicht kann auch Monat/Jahr (dieselbe Logik, größerer Rahmen)', () => {
  const state = leererState();
  macheTour(state, { modul: 'rad', datum: '2026-07-02', mw: { distanz: 5000 } }); // andere Woche, gleicher Monat
  macheTour(state, { modul: 'rad', datum: '2026-07-28', mw: { distanz: 7000 } }); // andere Woche, gleicher Monat

  const woche = zeitraumUebersicht(state, 'woche', MI);
  assert.equal(woche.aktivitaeten, 0);   // beide außerhalb der Bezugswoche

  const monat = zeitraumUebersicht(state, 'monat', MI);
  assert.equal(monat.aktivitaeten, 2);
  assert.equal(monat.von, '2026-07-01');
  assert.equal(monat.bis, '2026-08-01');
  assert.equal(modul(monat, 'rad').kennzahlen.distanz, 12000);
});
