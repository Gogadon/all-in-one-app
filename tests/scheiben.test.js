// tests/scheiben.test.js — Hantelscheiben pro Seite
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDARD_SCHEIBEN, scheibenSatz, setzeScheibenSatz, parseScheibenListe,
  scheibenProSeite, formatScheiben,
} from '../js/core/scheiben.js';
import { leererZustand } from '../js/core/storage.js';
import { formatZahl } from '../js/core/metrics.js';

test('Scheiben: Manuels Zahlen an der Multipresse (Stange 15)', () => {
  const faelle = [
    [85,   [20, 15]],
    [87.5, [20, 15, 1.25]],
    [90,   [20, 15, 2.5]],
    [92.5, [20, 15, 2.5, 1.25]],
    [95,   [20, 20]],
    [97.5, [20, 20, 1.25]],
  ];
  for (const [ziel, erwartet] of faelle) {
    const p = scheibenProSeite(ziel, 15);
    assert.deepEqual(p.proSeite, erwartet, `${ziel} kg`);
    assert.equal(p.erreichbar, true);
    assert.equal(p.rest, 0);
    // Gegenrechnung: Stange + 2 × Seite muss das Ziel ergeben.
    const summe = 15 + 2 * p.proSeite.reduce((a, b) => a + b, 0);
    assert.equal(Math.round(summe * 100) / 100, ziel);
  }
});

test('Scheiben: Langhantel 20 kg, typische Bankdrück-Gewichte', () => {
  assert.deepEqual(scheibenProSeite(60, 20).proSeite, [20]);
  assert.deepEqual(scheibenProSeite(62.5, 20).proSeite, [20, 1.25]);
  assert.deepEqual(scheibenProSeite(82.5, 20).proSeite, [20, 10, 1.25]);
  assert.deepEqual(scheibenProSeite(100, 20).proSeite, [20, 20]);
  assert.deepEqual(scheibenProSeite(20, 20).proSeite, [], 'nur die Stange');
});

test('Scheiben: Gleitkomma stolpert nicht', () => {
  // 21,25 − 15 = 6,25 → 3,125 pro Seite: nicht darstellbar, aber der Rest
  // muss exakt sein und nicht 0.12499999.
  const p = scheibenProSeite(21.25, 15);
  assert.equal(p.erreichbar, false);
  assert.equal(p.rest, 0.63);   // 3,125 − 2,5 = 0,625 → auf 1/100 gerundet
  for (let z = 15; z <= 200; z += 2.5) {
    assert.equal(scheibenProSeite(z, 15).erreichbar, true, `${z} kg muss in 2,5er-Schritten aufgehen`);
  }
});

test('Scheiben: nicht darstellbar → nächstes erreichbares Gewicht', () => {
  const p = scheibenProSeite(21, 20);            // 0,5 pro Seite
  assert.equal(p.erreichbar, false);
  assert.deepEqual(p.proSeite, []);
  assert.equal(p.rest, 0.5);
  assert.equal(p.naechste, 22.5, 'nächste: 1,25 pro Seite');

  const q = scheibenProSeite(96, 15);            // 40,5 pro Seite
  assert.equal(q.erreichbar, false);
  assert.deepEqual(q.proSeite, [20, 20]);
  assert.equal(q.naechste, 97.5);
});

test('Scheiben: Unsinn ergibt null statt Zahlen', () => {
  assert.equal(scheibenProSeite(10, 20), null, 'leichter als die Stange');
  assert.equal(scheibenProSeite(-12.5, 20), null, 'assistiert (negativ)');
  assert.equal(scheibenProSeite(null, 20), null);
  assert.equal(scheibenProSeite(60, 0), null, 'keine Stange');
  assert.equal(scheibenProSeite(60, undefined), null);
  assert.equal(scheibenProSeite(60, 20, []), null, 'kein Scheibensatz');
});

test('Scheiben: Anzeige fasst gleiche zusammen, deutsche Zahlen', () => {
  assert.equal(formatScheiben([20, 20, 1.25], formatZahl), '2×20 + 1,25');
  assert.equal(formatScheiben([20, 15, 2.5, 1.25], formatZahl), '20 + 15 + 2,5 + 1,25');
  assert.equal(formatScheiben([], formatZahl), 'keine Scheiben');
});

test('Scheibensatz: Standard, eigener Satz, Eingabe als Text', () => {
  const state = leererZustand();
  assert.deepEqual(scheibenSatz(state), [...STANDARD_SCHEIBEN]);

  assert.deepEqual(parseScheibenListe('20, 15, 10, 5, 2,5, 1,25'), [20, 15, 10, 5, 2.5, 1.25], 'Dezimalkomma bleibt Dezimalkomma');
  assert.deepEqual(parseScheibenListe('25 20 10 5'), [25, 20, 10, 5]);
  assert.deepEqual(parseScheibenListe('10 · 5 · 2,5'), [10, 5, 2.5]);
  assert.deepEqual(parseScheibenListe('5, 5, 10'), [10, 5], 'doppelte raus, sortiert');
  assert.deepEqual(parseScheibenListe(''), []);

  setzeScheibenSatz(state, [25, 20, 10, 5, 2.5]);
  assert.deepEqual(scheibenSatz(state), [25, 20, 10, 5, 2.5]);
  assert.deepEqual(scheibenProSeite(70, 20, scheibenSatz(state)).proSeite, [25]);

  setzeScheibenSatz(state, []);
  assert.deepEqual(scheibenSatz(state), [...STANDARD_SCHEIBEN], 'leer → Standard');
  assert.equal(state.einstellungen.scheiben, undefined);
});

test('Scheibensatz: Rechnung folgt dem eigenen Satz (ohne 15er)', () => {
  const p = scheibenProSeite(85, 15, [20, 10, 5, 2.5, 1.25]);
  assert.deepEqual(p.proSeite, [20, 10, 5]);
  assert.equal(p.erreichbar, true);
});

test('Scheiben: zu kleine Scheiben fliegen raus statt die App einzufrieren', async () => {
  const { MIN_SCHEIBE } = await import('../js/core/scheiben.js');
  // 0,001 kg rundete intern auf 0 — die Auffüll-Schleife wurde dadurch nie
  // fertig und die App fror ein. Jetzt gilt eine Untergrenze.
  assert.equal(scheibenProSeite(60, 20, [0.001]), null, 'kein Satz mehr übrig → null');
  assert.equal(scheibenProSeite(60, 20, [0, -5, 0.004]), null);
  assert.deepEqual(scheibenProSeite(60, 20, [20, 0.001]).proSeite, [20], 'gültige bleiben');
  assert.deepEqual(parseScheibenListe('0,001 20 15'), [20, 15]);
  assert.deepEqual(parseScheibenListe('0,001'), []);

  const state = leererZustand();
  setzeScheibenSatz(state, [0.001]);
  assert.deepEqual(scheibenSatz(state), [...STANDARD_SCHEIBEN], 'nur Unsinn → Standard');
  // Auch ein von Hand ins Backup geschriebener Satz darf nicht hängen bleiben.
  state.einstellungen.scheiben = [0.001, 0];
  assert.deepEqual(scheibenSatz(state), [...STANDARD_SCHEIBEN]);
  assert.ok(MIN_SCHEIBE >= 0.01);
});

test('Scheiben: eigene Sätze werden vollständig durchsucht, nicht nur gierig', () => {
  // Gierig von der schwersten Scheibe abwärts stimmt nur, wenn jede Scheibe
  // die nächstgrößere teilt. Bei 4/3 kg nahm es für 6 kg pro Seite die 4 und
  // meldete "nicht erreichbar" — 3 + 3 passt aber genau.
  const p = scheibenProSeite(32, 20, [4, 3]);
  assert.equal(p.erreichbar, true);
  assert.deepEqual(p.proSeite, [3, 3]);
  assert.equal(p.rest, 0);

  // Auch hier gilt: Stange + 2 × Seite ergibt das Ziel.
  for (const [ziel, stange, satz] of [[32, 20, [4, 3]], [34, 20, [4, 3]], [50, 20, [7, 5, 3]]]) {
    const r = scheibenProSeite(ziel, stange, satz);
    if (!r.erreichbar) continue;
    assert.equal(stange + 2 * r.proSeite.reduce((a, b) => a + b, 0), ziel, `${ziel} mit ${satz}`);
  }
});

test('Scheiben: die Lösung nimmt die wenigsten Scheiben', () => {
  // 97,5 bei Stange 15 → 41,25 pro Seite. 2×20 + 1,25 sind drei Scheiben,
  // 20 + 15 + 5 + 1,25 wären vier. Weniger schleppen ist besser.
  assert.deepEqual(scheibenProSeite(97.5, 15).proSeite, [20, 20, 1.25]);
  assert.deepEqual(scheibenProSeite(95, 15).proSeite, [20, 20]);
  // Bei gleicher Anzahl gewinnt die schwerere Scheibe (stabile Ausgabe).
  assert.deepEqual(scheibenProSeite(60, 20, [10, 5]).proSeite, [10, 10]);
});

test('Scheiben: „nächste" ist immer echt schwerer als das Ziel', () => {
  // Vorher konnte hier dasselbe Gewicht zurückkommen ("32 → nächste: 32"),
  // weil die Zahl aus der kleinsten Scheibe hochgerundet wurde statt aus dem,
  // was wirklich erreichbar ist.
  for (const [ziel, stange, satz] of [
    [21, 20, undefined], [96, 15, undefined], [32.5, 20, [4, 3]], [33, 20, [4, 3]],
  ]) {
    const p = scheibenProSeite(ziel, stange, satz);
    if (p.erreichbar) continue;
    assert.ok(p.naechste > ziel, `${ziel}: nächste war ${p.naechste}`);
    // ...und wirklich erreichbar.
    assert.equal(scheibenProSeite(p.naechste, stange, satz).erreichbar, true,
      `${p.naechste} muss darstellbar sein`);
  }
});

test('Scheiben: absurde Gewichte werden nicht gerechnet', () => {
  // Die vollständige Suche legt eine Tabelle an — die soll nicht ins
  // Uferlose wachsen, nur weil jemand sich vertippt.
  assert.notEqual(scheibenProSeite(1000, 20), null, '1000 kg wird noch gerechnet');
  assert.equal(scheibenProSeite(5000, 20), null, 'darüber lieber gar keine Anzeige');
});
