// ============================================================
// dashboard.js — modulübergreifende Übersicht für den Start-Tab.
//
// Block 1 „Wochenstatistik": zwei Stufen.
//   Stufe 1 (universelle Kopfzeile): Wie viel war überhaupt los?
//     · aktivitaeten — Anzahl abgeschlossener Touren/Einheiten (alle Module)
//     · aktiveTage   — an wie vielen Kalendertagen war etwas
//   Stufe 2 (pro Modul, in Akzentfarben): der jeweils typische Kennwert.
//     · kraft   → Einheiten  +  bewegtes Volumen (kg)
//     · rad     → Touren      +  Distanz (m)
//     · wandern → Touren      +  Distanz (m)  (in der UI ausgeblendet, wenn 0)
//
// ── Warum hier und nicht in js/core? ───────────────────────
// core/ darf keine Module kennen („dicker Kern, dünne Module"). Diese Datei
// ist die Orchestrierungs-Schicht ÜBER den Modulen: sie ruft die reinen
// Kern-Funktionen (statistik.js, model.js) auf UND braucht für Kraft die
// modul-eigene Volumen-Regel (sessionVolumenErledigt — einarmig, assistiert,
// nur abgehakte Segmente). Deshalb liegt sie eine Ebene über core, bleibt
// aber komplett DOM-frei und damit Node-testbar.
//
// ── „aktive Zeit" gibt es bewusst NICHT ────────────────────
// Ursprünglich war eine „aktive Zeit" als zweiter Kopfwert angedacht. Kraft
// erfasst aber keine Dauer — der Kopf wäre für Kraft-Wochen leer/verzerrt.
// „aktive Tage" ist modulübergreifend fair und für jedes Modul definiert.
//
// ── Eine Quelle für alles ──────────────────────────────────
// Kopfzeile UND Modul-Aufschlüsselung werden aus DERSELBEN gefilterten
// Touren-Liste abgeleitet. So kann die Kopf-Summe nie von der Summe der
// Module abweichen, und es gibt nur einen Filter-Pfad (dieselbe „zählt-mit"-
// Regel wie in der Statistik: istWertbareTour = abgeschlossen & nicht
// übersprungen). Eine gerade offene Einheit zählt erst nach dem Abschließen.
// ============================================================

import { heuteIso, istWertbareTour, zeitraum } from './core/model.js';
import { aggregiereTouren } from './core/statistik.js';
import { sessionVolumenErledigt } from './modules/kraft.js';

// Module, die eigene Touren/Einheiten erzeugen und im Dashboard eine Zeile
// bekommen — in Anzeige-Reihenfolge. Challenge erzeugt keine eigenen Sessions
// (liest nur fremde) und ist deshalb hier bewusst NICHT dabei; ob es als
// vierte Zeile mit rein soll, wird in Etappe 2 entschieden. Schwimmen o.Ä.
// später = eine Zeile hier ergänzen.
export const DASHBOARD_MODULE = Object.freeze(['kraft', 'rad', 'wandern', 'schwimmen']);

/**
 * Gehört die Session zu diesem Modul? Alt-Sessions ohne `modul`-Feld zählen
 * als Kraft — genau wie im restlichen Code (challenge.js, altes app.js).
 */
function gehoertZuModul(session, modul) {
  return (session.modul ?? 'kraft') === modul;
}

/** Kennzahlen einer Modul-Gruppe: { anzahl, kennzahlen }. */
function modulUebersicht(modul, touren) {
  const eigene = touren.filter(s => gehoertZuModul(s, modul));

  if (modul === 'kraft') {
    // Volumen (kg) über die modul-eigene Regel — nicht über die Registry,
    // denn kg = gewicht × wdh ist ein BERECHNETER Wert (kein Roh-Messwert)
    // mit Kraft-Sonderfällen (einarmig L+R, assistiert = 0, nur abgehakte
    // Segmente). So steht dieselbe Zahl im Dashboard wie im Kraft-Modul.
    const volumen = eigene.reduce((sum, s) => sum + sessionVolumenErledigt(s), 0);
    return { modul, anzahl: eigene.length, kennzahlen: { volumen } };
  }

  // Touren-Module (rad/wandern): die Registry-Aggregation aus statistik.js
  // wiederverwenden. kennzahlen.distanz kommt in Metern (interne Einheit);
  // die UI rechnet in km um. Weitere Kennwerte (dauer, hoehenmeter, …) sind
  // gratis dabei, falls das Dashboard später mehr zeigen will.
  const { kennzahlen } = aggregiereTouren(eigene);
  return { modul, anzahl: eigene.length, kennzahlen };
}

/**
 * Modulübergreifende Übersicht eines Zeitraums.
 *
 * @param state  App-State (mit .sessions)
 * @param art    'woche' | 'monat' | 'jahr'
 * @param anker  ISO-Tag im gewünschten Zeitraum (Default: heute)
 * @returns {
 *   art, von, bis,          // ISO-Grenzen, bis EXKLUSIV
 *   aktivitaeten,           // Anzahl wertbarer Touren/Einheiten (alle Module)
 *   aktiveTage,             // Anzahl Kalendertage mit ≥1 wertbarer Tour
 *   module: [{ modul, anzahl, kennzahlen }]   // in DASHBOARD_MODULE-Reihenfolge
 * }
 *
 * Einheiten der kennzahlen: kraft → { volumen: kg }, rad/wandern → Registry-
 * Einheiten (distanz in Metern usw.). Die Formatierung/Umrechnung macht die UI.
 */
export function zeitraumUebersicht(state, art, anker = heuteIso()) {
  const { von, bis } = zeitraum(art, anker);

  // Die EINE gefilterte Liste, aus der Kopf und Module abgeleitet werden.
  const touren = (state.sessions ?? []).filter(s =>
    istWertbareTour(s) && s.datum >= von && s.datum < bis);

  const aktiveTage = new Set(touren.map(s => s.datum)).size;
  const module = DASHBOARD_MODULE.map(m => modulUebersicht(m, touren));

  return {
    art, von, bis,
    aktivitaeten: touren.length,
    aktiveTage,
    module,
  };
}

/**
 * Die konkrete Funktion für Block 1 des Dashboards: die aktuelle (oder eine
 * beliebige, per `anker` gewählte) Woche. Dünner Aufsatz auf zeitraumUebersicht.
 */
export function wochenUebersicht(state, anker = heuteIso()) {
  return zeitraumUebersicht(state, 'woche', anker);
}
