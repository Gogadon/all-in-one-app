// ============================================================
// kalender.js — Werkzeug B: der modulübergreifende Kalender.
//
// Drei Ebenen, zwei Gesichter:
//   Ebene 1  Wochen-Streifen (Dashboard-Glance)  → wochenStreifen()
//   Ebene 2  Monats-Raster                        → monatsGitter()
//   Ebene 3  Tages-Sheet (Rückblick/Planung)      → tagDetail()
//
// „Zwei Gesichter": ein Tag hat immer eine Rückblick- und eine Planungs-Seite.
// Welche zählt, entscheidet das Datum — gesichtFuer() liefert
//   'vergangen' | 'heute' | 'zukunft'.
//
// ── Was diese Etappe macht (und was nicht) ─────────────────
// Diese erste Etappe deckt den RÜCKBLICK ab: sie leitet Raster, Streifen und
// Tages-Inhalt komplett aus den schon vorhandenen Sessions ab. Die PLANUNG
// (geplante Termine → Umriss-Punkte, Zukunft eintragen) ist bewusst noch NICHT
// hier; sie kommt als eigene Etappe mit einer schlanken `termine`-Liste dazu.
// Die Nahtstellen sind aber schon angelegt: `module`/`anzahl` je Tag und die
// rohe Session-Liste im Tages-Detail — dort schließt die Planung später an.
//
// ── Warum hier und nicht in js/core? ───────────────────────
// Wie dashboard.js ist das die Orchestrierungs-Schicht ÜBER den Modulen:
// modulübergreifend, aber komplett DOM-frei und damit Node-testbar. core/
// darf keine Module kennen; die Modul-REIHENFOLGE der Punkte holt sich diese
// Datei aus dashboard.js (eine einzige Quelle für „welche Module, welche
// Reihenfolge"). Kein Zyklus: dashboard.js kennt kalender.js nicht.
//
// ── „Wertbar" = dieselbe Regel wie überall ─────────────────
// Ein Punkt erscheint nur für ABGESCHLOSSENE, nicht übersprungene Touren
// (istWertbareTour) — genau wie Statistik und Dashboard zählen. Eine offene
// oder übersprungene Einheit erzeugt keinen Punkt. (Das Tages-Sheet zeigt über
// die rohe Session-Liste trotzdem alles des Tages; die Filterung macht die UI.)
// ============================================================

import {
  heuteIso, istWertbareTour, sessionsAmTag, sortiereNeuesteZuerst,
  naechsterTag, wochenStart, zeitraum, isoZuDatum,
} from './core/model.js';
import { zeitraumLabel } from './core/statistik.js';
import { DASHBOARD_MODULE } from './dashboard.js';

// Kurz-Labels der Wochentage, Montag zuerst (Mo=0). Fest statt via
// toLocaleDateString, damit der Kern ohne Locale-Überraschungen auskommt.
const KURZ_TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Das „Gesicht" eines ISO-Tags relativ zu heute. */
export function gesichtFuer(iso, heute = heuteIso()) {
  if (iso === heute) return 'heute';
  return iso < heute ? 'vergangen' : 'zukunft';
}

/** Modul einer Session; Alt-Sessions ohne `modul`-Feld zählen als Kraft. */
function modulVon(session) {
  return session.modul ?? 'kraft';
}

/** Vorhandene Module in Dashboard-Reihenfolge; Unbekanntes hinten angehängt. */
function ordneModule(vorhanden) {
  const bekannt = DASHBOARD_MODULE.filter(m => vorhanden.has(m));
  const rest = [...vorhanden].filter(m => !DASHBOARD_MODULE.includes(m));
  return [...bekannt, ...rest];
}

/** Sonntag (inklusiv) der Woche, in der `iso` liegt (ISO). */
function wochenEnde(iso) {
  const d = isoZuDatum(wochenStart(iso));
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Der „Punkt-Steckbrief" eines Tages: welche Module hatten ≥1 wertbare Tour,
 * und wie viele Touren insgesamt.
 * @returns { module: string[], anzahl: number }
 */
export function tagMarker(state, iso) {
  const wertbar = (state.sessions ?? []).filter(s => istWertbareTour(s) && s.datum === iso);
  const vorhanden = new Set(wertbar.map(modulVon));
  return { module: ordneModule(vorhanden), anzahl: wertbar.length };
}

/** Eine Zelle für Streifen/Raster. */
function zelle(state, iso, { imMonat, heute }) {
  const { module, anzahl } = tagMarker(state, iso);
  const wochentag = (isoZuDatum(iso).getUTCDay() + 6) % 7;   // Mo=0
  return {
    iso,
    tag: Number(iso.slice(8, 10)),
    kurz: KURZ_TAGE[wochentag],
    imMonat,
    istHeute: iso === heute,
    istZukunft: iso > heute,
    module,
    anzahl,
  };
}

/**
 * Ebene 1 — Wochen-Streifen (Dashboard-Glance): die 7 Tage der Woche um
 * `anker`, Montag zuerst. Reiner Blick; Eintragen passiert im Tages-Sheet.
 * @returns { von, bis, tage: Zelle[] }   (bis EXKLUSIV)
 */
export function wochenStreifen(state, anker = heuteIso(), heute = heuteIso()) {
  const { von, bis } = zeitraum('woche', anker);
  const tage = [];
  for (let iso = von; iso < bis; iso = naechsterTag(iso)) {
    tage.push(zelle(state, iso, { imMonat: true, heute }));
  }
  return { von, bis, tage };
}

/**
 * Ebene 2 — Monats-Raster: volle Wochen (Mo–So) über den ganzen Monat, inkl.
 * der Rand-Tage der Nachbarmonate (imMonat:false), damit das Gitter rechteckig
 * bleibt. Rechnet durchgehend in UTC (wie die übrigen Datums-Helfer).
 * @returns { jahr, monat, label, von, bis, wochen: Zelle[][] }
 */
export function monatsGitter(state, anker = heuteIso(), heute = heuteIso()) {
  const { von, bis } = zeitraum('monat', anker);   // bis exkl. = 1. des Folgemonats
  const letzterTag = isoZuDatum(bis);
  letzterTag.setUTCDate(letzterTag.getUTCDate() - 1);
  const letzterIso = letzterTag.toISOString().slice(0, 10);

  const rasterStart = wochenStart(von);
  const rasterEnde = naechsterTag(wochenEnde(letzterIso));   // exklusiv

  const wochen = [];
  let woche = [];
  for (let iso = rasterStart; iso < rasterEnde; iso = naechsterTag(iso)) {
    const imMonat = iso >= von && iso < bis;
    woche.push(zelle(state, iso, { imMonat, heute }));
    if (woche.length === 7) { wochen.push(woche); woche = []; }
  }

  return {
    jahr: Number(von.slice(0, 4)),
    monat: Number(von.slice(5, 7)),
    label: zeitraumLabel('monat', anker),
    von, bis,
    wochen,
  };
}

/**
 * Ebene 3 — Tages-Sheet: was ist/war an diesem Tag? Liefert die rohen Sessions
 * (neueste zuerst) plus das Gesicht, aus dem die UI entscheidet, ob Rückblick,
 * beides oder Planung oben steht. Bewusst ROH (inkl. offener/übersprungener
 * Sessions) — welche Zeilen wie dargestellt werden, entscheidet die UI, die die
 * Module kennt. Die Planung (`termine`) reiht sich später hier als zweite Liste
 * ein.
 * @returns { iso, gesicht, sessions }
 */
export function tagDetail(state, iso, heute = heuteIso()) {
  const sessions = sortiereNeuesteZuerst(sessionsAmTag(state, iso));
  return { iso, gesicht: gesichtFuer(iso, heute), sessions };
}
