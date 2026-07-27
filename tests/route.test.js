// tests/route.test.js — Adresse ⇄ Ansicht (reine Logik, kein DOM)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { routeVonZustand, routeParsen } = await import('../js/route.js');

// So sieht die Tab-Tabelle der App aus (Rad/Wandern/Schwimmen ohne Plan).
const TABS = {
  kraft:     ['dashboard', 'heute', 'plan', 'verlauf'],
  rad:       ['dashboard', 'heute', 'verlauf'],
  schwimmen: ['dashboard', 'heute', 'verlauf'],
  challenge: ['dashboard', 'heute'],
};

// ============================================================
// Zustand → Route
// ============================================================

test('Route schreiben: Dashboard, Modul-Tabs und Unterseiten', () => {
  assert.equal(routeVonZustand({ unterseite: null, tab: 'dashboard', modul: 'kraft' }), '#/dashboard');
  assert.equal(routeVonZustand({ unterseite: null, tab: 'heute', modul: 'kraft' }), '#/kraft/heute');
  assert.equal(routeVonZustand({ unterseite: null, tab: 'verlauf', modul: 'rad' }), '#/rad/verlauf');
  // Unterseiten liegen über den Tabs und gewinnen deshalb
  assert.equal(routeVonZustand({ unterseite: 'daten', tab: 'heute', modul: 'kraft' }), '#/daten');
  assert.equal(routeVonZustand({ unterseite: 'kalender', tab: 'plan', modul: 'kraft' }), '#/kalender');
});

// ============================================================
// Route → Zustand
// ============================================================

test('Route lesen: leer und Dashboard führen aufs Dashboard', () => {
  for (const h of ['', '#', '#/', '#/dashboard']) {
    assert.deepEqual(routeParsen(h, TABS), { unterseite: null, modul: null, tab: 'dashboard' });
  }
});

test('Route lesen: Modul mit und ohne Tab', () => {
  assert.deepEqual(routeParsen('#/kraft/plan', TABS), { unterseite: null, modul: 'kraft', tab: 'plan' });
  // Modul ohne Tab → „heute" ist der Einstieg
  assert.deepEqual(routeParsen('#/rad', TABS), { unterseite: null, modul: 'rad', tab: 'heute' });
});

test('Route lesen: Unterseiten', () => {
  assert.deepEqual(routeParsen('#/daten', TABS), { unterseite: 'daten', modul: null, tab: 'dashboard' });
  assert.deepEqual(routeParsen('#/kalender', TABS), { unterseite: 'kalender', modul: null, tab: 'dashboard' });
});

test('Route lesen: unbekanntes Modul fällt aufs Dashboard zurück', () => {
  assert.deepEqual(routeParsen('#/quatsch/heute', TABS), { unterseite: null, modul: null, tab: 'dashboard' });
});

test('Route lesen: Tab, den das Modul nicht hat, landet auf „heute"', () => {
  // Rad hat keinen Plan-Tab
  assert.deepEqual(routeParsen('#/rad/plan', TABS), { unterseite: null, modul: 'rad', tab: 'heute' });
  // Challenge hat keinen Verlauf
  assert.deepEqual(routeParsen('#/challenge/verlauf', TABS), { unterseite: null, modul: 'challenge', tab: 'heute' });
  // „dashboard" als Modul-Tab wäre widersprüchlich
  assert.deepEqual(routeParsen('#/kraft/dashboard', TABS), { unterseite: null, modul: 'kraft', tab: 'heute' });
});

test('Route lesen: Müll-Eingaben stürzen nicht ab', () => {
  for (const h of [null, undefined, '#///', '#/kraft/plan/extra/kram']) {
    const z = routeParsen(h, TABS);
    assert.ok(typeof z.tab === 'string' && z.tab.length > 0);
  }
  // Überzähliges wird ignoriert, der gültige Teil bleibt
  assert.deepEqual(routeParsen('#/kraft/plan/extra/kram', TABS),
    { unterseite: null, modul: 'kraft', tab: 'plan' });
});

test('Route: schreiben und lesen sind zueinander passend', () => {
  const faelle = [
    { unterseite: null, tab: 'dashboard', modul: 'kraft' },
    { unterseite: null, tab: 'heute', modul: 'rad' },
    { unterseite: null, tab: 'verlauf', modul: 'schwimmen' },
    { unterseite: 'daten', tab: 'heute', modul: 'kraft' },
  ];
  for (const f of faelle) {
    const zurueck = routeParsen(routeVonZustand(f), TABS);
    assert.equal(zurueck.unterseite, f.unterseite);
    if (f.unterseite == null && f.tab !== 'dashboard') {
      assert.equal(zurueck.modul, f.modul);
      assert.equal(zurueck.tab, f.tab);
    }
  }
});
