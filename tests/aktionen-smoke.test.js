// ============================================================
// tests/aktionen-smoke.test.js — jede Aktion einmal anfassen.
//
// WARUM ES DIESE DATEI GIBT
// Beim Aufteilen von kraft.js sind fünf Namen aus dem Import-Block gefallen
// (segmentZusammenfassungWerte, fmtSatz, neueSession, PROG_DEFAULTS und der
// Zustand `umbenennen`). Alle 262 Tests blieben grün — die betroffenen
// Aktionen (Teilen, Umbenennen, Freie Session) rief schlicht keiner auf.
// Aufgefallen ist es erst beim Benutzen: „segmentZusammenfassungWerte is not
// defined", mitten im Teilen-Bildschirm nach dem Training.
//
// Genau davor schützt diese Datei: sie ruft JEDE Aktion JEDES Moduls einmal
// mit plausiblen Daten auf. Geprüft wird nur eines — dass kein Name fehlt.
// Alles andere (fehlende IDs, kein Canvas in Node) darf schiefgehen; das ist
// hier nicht die Frage.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installiereBrowserAttrappe, testKontext } from './helpers/umgebung.js';

installiereBrowserAttrappe();

const { leererZustand } = await import('../js/core/storage.js');
const { esc, formatDatum } = await import('../js/ui/components.js');
const { neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag,
  neuerTermin } = await import('../js/core/model.js');
const { addAktivitaet, addAlternative } = await import('../js/core/library.js');
const { addEinheit, addAktivitaetZuEinheit, addZuZyklus } = await import('../js/core/plan.js');
const { setzeMessung } = await import('../js/core/koerper.js');
const { erstelleModule, MODULE } = await import('../js/module-registry.js');

const HEUTE = new Date().toISOString().slice(0, 10);

/** Ein Zustand, in dem jede Aktion etwas zu tun vorfindet. */
function welt() {
  const state = leererZustand();
  const bank = addAktivitaet(state, { name: 'Bankdrücken', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  const kh = addAktivitaet(state, { name: 'KH-Bank', kategorie: 'kraft', messwerte: ['gewicht', 'wdh'] });
  addAlternative(state, bank.id, kh.id);
  const rad = addAktivitaet(state, { name: 'Radfahren', kategorie: 'rad', messwerte: ['distanz', 'dauer'] });

  const einheit = addEinheit(state, 'kraft', { name: 'Push A' });
  addAktivitaetZuEinheit(state, 'kraft', einheit.id, bank.id);
  addZuZyklus(state, 'kraft', einheit.id);

  // Abgeschlossene Kraft-Session von heute — Grundlage fürs Teilen.
  const s = neueSession({ datum: HEUTE });
  s.modul = 'kraft'; s.ausPlan = einheit.id; s.abgeschlossen = true;
  const seg = addSegment(s, neuesSegment(bank.id));
  seg.erledigt = true;
  const eintrag = neuerEintrag({ gewicht: 80, wdh: 8 });
  addEintrag(seg, eintrag);
  // ...und ein Cardio-Segment: DAS ist der Zweig, in dem der Fehler saß.
  const cardio = addSegment(s, neuesSegment(rad.id));
  cardio.erledigt = true;
  addEintrag(cardio, neuerEintrag({ distanz: 12000, dauer: 2400 }));
  state.sessions.push(s);

  const tourSession = neueSession({ datum: HEUTE });
  tourSession.modul = 'rad'; tourSession.abgeschlossen = true;
  const tseg = addSegment(tourSession, neuesSegment(rad.id));
  tseg.erledigt = true;
  addEintrag(tseg, neuerEintrag({ distanz: 24300, dauer: 3600 }));
  state.sessions.push(tourSession);

  setzeMessung(state, HEUTE, { gewicht: 90.1 });
  state.challenges.push({ id: 'z1', was: 'rad_km', zielwert: 100, zeitraum: 'monat' });
  const termin = neuerTermin({ datum: HEUTE, modul: 'rad' });
  state.termine.push(termin);

  return {
    state,
    daten: {
      seg: seg.id, eintrag: eintrag.id, sid: s.id, id: termin.id,
      akt: bank.id, alt: kh.id, aktId: bank.id, einheit: einheit.id, eid: einheit.id,
      typ: 'gewicht', kat: 'kraft', m: 'rad', s: 'fortschritt', metrik: 'volumen',
      i: 0, r: 1, iso: HEUTE, marke: '', wert: 'gewicht', zeitraum: 'monat',
    },
  };
}

/**
 * Aktion aufrufen und nur auf fehlende Namen achten.
 *
 * GRENZE DIESES NETZES, offen gesagt: Aktionen, die auf eine Rückfrage
 * warten (bestaetige/hinweis), kommen im Test nie über diese Zeile hinaus —
 * die Antwort klickt niemand. Statt ewig zu hängen, gewinnt hier eine kurze
 * Frist. Was HINTER einer Rückfrage steht, prüft dieser Test also nicht.
 * Vollständig abdecken ließe sich das nur, indem die Dialoge über ctx
 * hereingereicht werden (wie sheet) — oder mit einem Linter, der fehlende
 * Namen ganz ohne Ausführen findet.
 */
async function rufeAuf(fn, daten) {
  const el = { value: '1', dataset: {}, files: [], checked: true };
  let ergebnis;
  try {
    ergebnis = fn(daten, el, { preventDefault() {}, stopPropagation() {} });
  } catch (err) {
    return err;                              // synchron geworfen
  }
  if (!(ergebnis instanceof Promise)) return null;
  const frist = new Promise(r => setTimeout(() => r(null), 30));
  return Promise.race([ergebnis.then(() => null, e => e), frist]);
}

/**
 * Dieselbe Welt, aber ohne Einheit von heute.
 * Nötig, weil einige Aktionen (Einheit starten, Freie Session) vorher
 * abbiegen, solange der Tag schon belegt ist — pro Tag gibt es nur eine
 * Kraft-Einheit. Ohne diesen zweiten Durchgang bliebe genau der Code
 * ungeprüft, in dem gestern `neueSession` fehlte.
 */
function weltMitFreiemTag() {
  const { state, daten } = welt();
  for (const s of state.sessions) {
    if (s.modul === 'kraft') s.datum = '2026-01-05';
  }
  return { state, daten };
}

test('Aktionen: keine einzige stolpert über einen fehlenden Namen', async () => {
  const fehlend = [];

  for (const [lage, bauen] of [['Tag belegt', welt], ['Tag frei', weltMitFreiemTag]]) {
    for (const beschreibung of MODULE) {
      const { state, daten } = bauen();       // frische Welt pro Modul
      const { ctx } = testKontext(state, { esc, formatDatum });
      const gebaut = erstelleModule(ctx);
      const modul = gebaut.nach(beschreibung.id);

      for (const [name, fn] of Object.entries(modul.instanz.actions)) {
        const err = await rufeAuf(fn, { ...daten });
        if (err instanceof ReferenceError) {
          fehlend.push(`${name} (${beschreibung.id}, ${lage}): ${err.message}`);
        }
      }
    }
  }

  assert.deepEqual(fehlend, [], 'Aktionen mit fehlenden Namen:\n' + fehlend.join('\n'));
});

test('Aktionen: das Teilen einer Session erreicht wirklich beide Zweige', async () => {
  // Der Fehler saß im Cardio-Zweig der Teilen-Aktion — der wird nur
  // betreten, wenn die Session auch ein Nicht-Kraft-Segment hat. Ohne diese
  // Prüfung könnte der Test oben grün bleiben, obwohl er die Stelle nie sieht.
  const { state, daten } = welt();
  const s = state.sessions.find(x => x.id === daten.sid);
  const kategorien = s.segmente.map(seg =>
    state.bibliothek.find(a => a.id === seg.aktivitaetId).kategorie);
  assert.ok(kategorien.includes('kraft'), 'Kraft-Segment vorhanden');
  assert.ok(kategorien.some(k => k !== 'kraft'), 'und ein Cardio-Segment');

  const { ctx } = testKontext(state, { esc, formatDatum });
  const gebaut = erstelleModule(ctx);
  const teilen = gebaut.nach('kraft').instanz.actions['k.teilen'];
  assert.equal(typeof teilen, 'function', 'die Teilen-Aktion gibt es');
  const err = await rufeAuf(teilen, daten);
  assert.ok(!(err instanceof ReferenceError), `Teilen: ${err?.message}`);
});
