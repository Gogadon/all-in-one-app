// ============================================================
// core/scheiben.js — welche Hantelscheiben auf die Stange müssen.
//
// Reine Rechnung, kein DOM: Zielgewicht minus Stange, halbiert (beide Seiten
// werden gleich beladen), dann von der schwersten Scheibe abwärts aufgefüllt.
//
// Das Ergebnis ist IMMER „pro Seite". Das ist die eine Zahl, die beim
// Auflegen zählt — und die Zweideutigkeit „meint der beide Seiten?" ist genau
// der Moment, in dem eine Stange doppelt beladen wird.
// ============================================================

import { parseZahl } from './metrics.js';

/** Was in den meisten Studios liegt. Änderbar in den Einstellungen. */
export const STANDARD_SCHEIBEN = Object.freeze([20, 15, 10, 5, 2.5, 1.25]);

/**
 * Kleinste Scheibe, die die App annimmt: 10 g.
 *
 * Nicht Willkür, sondern Notwendigkeit: Gerechnet wird in 1/100 kg, damit
 * Gleitkomma nicht stört. Alles darunter rundet auf 0 — und eine Scheibe mit
 * dem Gewicht 0 lässt die Auffüll-Schleife ewig laufen, weil der Rest nie
 * kleiner wird. Die App fror dabei ein. Deshalb fliegt so etwas raus, statt
 * gerechnet zu werden.
 */
export const MIN_SCHEIBE = 0.01;

/**
 * Obergrenze für die Rechnung: 500 kg pro Seite.
 * Die exakte Suche legt eine Tabelle über alle Zwischenbeträge an — bei
 * absurden Eingaben soll das nicht ins Uferlose wachsen. Über der Grenze
 * gibt es keine Anzeige statt einer teuren Rechnung für ein Gewicht, das
 * niemand auflegt.
 */
const MAX_PRO_SEITE_CENT = 50000;

/** Taugt der Wert als Scheibe? */
function istScheibe(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= MIN_SCHEIBE;
}

/** Der Scheibensatz des Studios — app-weit, schwerste zuerst. */
export function scheibenSatz(state) {
  const eigene = state?.einstellungen?.scheiben;
  const liste = Array.isArray(eigene) ? eigene.filter(istScheibe) : [];
  const satz = liste.length ? liste : STANDARD_SCHEIBEN;
  return [...new Set(satz)].sort((a, b) => b - a);
}

/** Scheibensatz setzen. Leer oder ungültig → zurück auf den Standard. */
export function setzeScheibenSatz(state, liste) {
  state.einstellungen ??= {};
  const sauber = [...new Set((liste ?? []).filter(istScheibe))].sort((a, b) => b - a);
  if (sauber.length) state.einstellungen.scheiben = sauber;
  else delete state.einstellungen.scheiben;
  return scheibenSatz(state);
}

/** „20, 15, 10, 5, 2,5, 1,25" → [20, 15, 10, 5, 2.5, 1.25] — tolerant bei Trennzeichen. */
export function parseScheibenListe(text) {
  // Deutsches Komma als Dezimaltrenner: „2,5" ist EINE Zahl, kein Trenner.
  // Getrennt wird an Leerzeichen, Punkt-Mitte, Semikolon, Schrägstrich —
  // oder an einem Komma, auf das eine weitere Zahl mit Komma folgt.
  const teile = String(text ?? '')
    .replace(/(\d),(\d)/g, '$1#$2')     // Dezimalkomma schützen
    .split(/[\s,;·/|]+/)
    .map(t => t.replace(/#/g, ','))
    .filter(Boolean)
    .map(parseZahl)
    .filter(istScheibe);
  return [...new Set(teile)].sort((a, b) => b - a);
}

/**
 * Scheiben pro Seite für ein Zielgewicht.
 *
 * @returns {{ proSeite: number[], rest: number, erreichbar: boolean,
 *             stange: number, ziel: number, naechste: number|null }}
 *   proSeite   — die Scheiben einer Seite, schwerste zuerst (mit Wiederholungen)
 *   rest       — was mit diesem Satz nicht darstellbar ist (0 = geht auf)
 *   erreichbar — rest === 0
 *   naechste   — das nächste darstellbare Gewicht ≥ ziel, falls nicht erreichbar
 *
 *   null, wenn die Rechnung keinen Sinn ergibt (kein Ziel, keine Stange,
 *   Ziel leichter als die Stange, negatives/assistiertes Gewicht).
 */
export function scheibenProSeite(ziel, stange, scheiben = STANDARD_SCHEIBEN) {
  if (typeof ziel !== 'number' || typeof stange !== 'number') return null;
  if (!(ziel > 0) || !(stange > 0) || ziel < stange) return null;
  const satz = [...scheiben].filter(istScheibe).sort((a, b) => b - a);
  if (!satz.length) return null;

  // Auf 1/100 kg runden, damit 0,1 + 0,2 nicht an Gleitkomma scheitert.
  const cent = (n) => Math.round(n * 100);
  const zielCent = cent((ziel - stange) / 2);
  if (zielCent > MAX_PRO_SEITE_CENT) return null;

  const satzCent = satz.map(cent);
  const kleinste = satzCent[satzCent.length - 1];
  // Eine kleinste Scheibe über das Ziel hinaus rechnen: weiter kann das
  // nächste erreichbare Gewicht nicht liegen. Wäre der größte erreichbare
  // Betrag unter dem Ziel plus die kleinste Scheibe noch unter dem Ziel,
  // wäre er nicht der größte gewesen.
  const bis = zielCent + kleinste;

  // Minimale Scheibenzahl für jeden Betrag — vollständige Suche statt gierig.
  // Gierig von der schwersten Scheibe abwärts ist nur bei "schöner" Staffelung
  // richtig (jede Scheibe teilt die nächstgrößere). Bei einem selbst
  // eingetragenen Satz wie 4/3 kg scheiterte es: für 6 kg nahm es die 4 und
  // meldete den Rest als nicht darstellbar — obwohl 3 + 3 genau passt.
  const anzahl = new Array(bis + 1).fill(Infinity);
  const letzte = new Array(bis + 1).fill(0);
  anzahl[0] = 0;
  for (let c = 1; c <= bis; c++) {
    for (const s of satzCent) {          // schwerste zuerst → bei Gleichstand gewinnt sie
      if (s <= c && anzahl[c - s] + 1 < anzahl[c]) {
        anzahl[c] = anzahl[c - s] + 1;
        letzte[c] = s;
      }
    }
  }
  const packe = (c) => {
    const raus = [];
    while (c > 0) { const s = letzte[c]; raus.push(s / 100); c -= s; }
    return raus.sort((a, b) => b - a);
  };

  if (Number.isFinite(anzahl[zielCent])) {
    return { proSeite: packe(zielCent), rest: 0, erreichbar: true, stange, ziel, naechste: null };
  }
  // Nicht darstellbar: das Beste darunter zeigen und das Nächste darüber
  // nennen. `naechste` ist dadurch immer echt größer als das Ziel — vorher
  // kam hier bei krummen Sätzen dasselbe Gewicht zurück.
  let darunter = zielCent;
  while (darunter > 0 && !Number.isFinite(anzahl[darunter])) darunter--;
  let darueber = zielCent + 1;
  while (darueber <= bis && !Number.isFinite(anzahl[darueber])) darueber++;
  return {
    proSeite: packe(darunter),
    rest: (zielCent - darunter) / 100,
    erreichbar: false,
    stange, ziel,
    naechste: darueber <= bis ? (cent(stange) + 2 * darueber) / 100 : null,
  };
}

/** „2×20 + 15 + 1,25" — gleiche Scheiben zusammengefasst, schwerste zuerst. */
export function formatScheiben(proSeite, formatZahl = (n) => String(n).replace('.', ',')) {
  if (!proSeite?.length) return 'keine Scheiben';
  const anzahl = new Map();
  for (const s of proSeite) anzahl.set(s, (anzahl.get(s) ?? 0) + 1);
  return [...anzahl.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([s, n]) => (n > 1 ? `${n}×${formatZahl(s)}` : formatZahl(s)))
    .join(' + ');
}
