// ============================================================
// statistik.js — Zeitraum-Statistik (reiner Kern, kein DOM)
//
// „Rückblick": Was habe ich in einem Zeitraum (Woche/Monat/Jahr)
// getan? Nimmt die Touren eines Moduls in einem Zeitfenster und
// fasst jede Kennzahl nach ihrer Registry-Regel (agg) zusammen:
//   summe  → addieren   (Distanz, Höhenmeter, Dauer, Kalorien, Schritte)
//   mittel → Mittelwert  (Ø-Puls, Ø-Geschw., Ø-Leistung, Ø-Trittfrequenz)
//   max    → Maximum     (Max-Puls, Max-Geschw.)
//
// Welche Kennzahl wie zusammengefasst wird, steht NUR in metrics.js.
// Kommt dort ein Messwert dazu, erscheint er hier automatisch — kein
// Sonderfall pro Modul. Das ist derselbe „ein Code-Pfad"-Gedanke wie
// im restlichen Kern.
//
// ── Zwei-Stufen-Aggregation ────────────────────────────────
//   Stufe 1: je Tour ihr eigener Kennwert (sessionWert, Registry-Regel).
//            Für Rad/Wandern (1 Segment, 1 Eintrag) ist das schlicht der
//            eingetragene Wert; die Stufe hält aber auch für mehrteilige
//            Sessions.
//   Stufe 2: diese Tour-Werte über den Zeitraum zusammenfassen.
//
// ── Gewichteter Mittelwert (Migrations-Seam) ───────────────
//   `mittel` ist von Anfang an als GEWICHTETER Mittelwert gebaut:
//       Σ(wert · gewicht) / Σ gewicht
//   Default ist `gewichtGleich` (jede Tour zählt 1) → das ist exakt der
//   einfache Durchschnitt der Touren-Durchschnitte, den wir jetzt wollen.
//   Später längere/größere Touren stärker gewichten = nur eine andere
//   Gewichts-Funktion übergeben. Der Rest der Aggregation bleibt gleich.
//   (Beispiel-Strategie `gewichtNachGroesse` unten — noch nicht in der UI.)
// ============================================================

import { MESSWERTE, aggregiere } from './metrics.js';
import { sessionWert, zeitraum, isoZuDatum, heuteIso, sortiereNeuesteZuerst } from './model.js';

// ------------------------------------------------------------
// Gewichts-Strategien für mittel-Messwerte
//
// Eine Gewichts-Funktion bekommt (typ, tourKennzahlen) und gibt das
// Gewicht dieser einen Tour zurück. `tourKennzahlen` ist die Map der
// EIGENEN Kennwerte der Tour (distanz, dauer, …) — so kann eine Strategie
// z.B. nach Distanz oder Dauer gewichten.
// ------------------------------------------------------------

/** Gleichgewicht: jede Tour zählt 1 → einfacher Ø der Touren-Ø. (Default.) */
export function gewichtGleich(/* typ, tourKennzahlen */) {
  return 1;
}

/**
 * Längere/größere Touren stärker gewichten:
 *   Ø-Geschw.  → nach Distanz (eine 40-km-Runde prägt den Schnitt mehr als 5 km)
 *   Ø-Puls     → nach Dauer   (zeitlich länger = mehr Herzschläge im Mittel)
 *   Ø-Bahnlänge → nach Bahnen (mehr Bahnen im 25-m-Becken prägen den Schnitt
 *                mehr als 5 Bahnen im 10-m-Becken). Ergibt exakt
 *                Gesamt-Meter ÷ Gesamt-Bahnen — die ehrliche Ø-Bahnlänge.
 * Fehlt die Gewichts-Basis (kein distanz/dauer/bahnen eingetragen), zählt die
 * Tour mit Gewicht 0 — sie fließt dann NICHT in den gewichteten Schnitt ein.
 * Das ist eine bewusste Entscheidung: ohne Basis kein sinnvolles Gewicht.
 */
export function gewichtNachGroesse(typ, k) {
  if (typ === 'tempo_avg' || typ === 'tempo_max') return k.distanz ?? 0;
  if (typ === 'puls_avg' || typ === 'watt_avg')   return k.dauer ?? 0;
  if (typ === 'bahnlaenge')                        return k.bahnen ?? 0;
  return 1;
}

// ------------------------------------------------------------
// Touren eines Zeitraums
// ------------------------------------------------------------

/**
 * Abgeschlossene Touren eines Moduls in [vonIso, bisIso) — bis EXKLUSIV.
 * Nur fertige, nicht übersprungene Touren zählen in die Statistik; eine
 * gerade offene Tour (halb eingetragen) würde die Zahlen verfälschen.
 * Neueste zuerst — passt zur antippbaren Tourenliste in der UI.
 */
export function tourenImZeitraum(state, modul, vonIso, bisIso) {
  return sortiereNeuesteZuerst(state.sessions.filter(s =>
    s.modul === modul &&
    s.abgeschlossen === true &&
    !s.uebersprungen &&
    s.datum >= vonIso &&
    s.datum < bisIso));
}

// ------------------------------------------------------------
// Aggregation
// ------------------------------------------------------------

/** Welche Registry-Messwerte kommen in dieser Session überhaupt vor? */
function praesenteTypen(session) {
  const set = new Set();
  for (const seg of session.segmente ?? [])
    for (const e of seg.eintraege ?? [])
      for (const k of Object.keys(e.messwerte ?? {}))
        if (MESSWERTE[k]) set.add(k);
  return set;
}

/**
 * Stufe 1: die eigenen Kennwerte EINER Tour (Registry-Regel je Messwert).
 * Nur tatsächlich vorhandene Messwerte, damit fehlende nicht als 0 zählen.
 */
function tourKennzahlen(session) {
  const out = {};
  for (const typ of praesenteTypen(session)) {
    const w = sessionWert(session, typ);
    if (w != null) out[typ] = w;
  }
  return out;
}

/** Stufe 2: eine einzelne Kennzahl über die Tour-Werte zusammenfassen. */
function fasseKennzahlZusammen(typ, proTour, gewicht) {
  const def = MESSWERTE[typ];

  if (def.agg === 'mittel') {
    // Gewichteter Mittelwert. Nur Touren mit gültigem Wert UND Gewicht > 0.
    let zaehler = 0, nenner = 0;
    for (const k of proTour) {
      const w = k[typ];
      if (typeof w !== 'number' || !Number.isFinite(w)) continue;
      const g = gewicht(typ, k);
      if (!Number.isFinite(g) || g <= 0) continue;
      zaehler += w * g;
      nenner += g;
    }
    return nenner > 0 ? zaehler / nenner : null;
  }

  // summe / max → derselbe eine Aggregations-Pfad aus metrics.js.
  return aggregiere(typ, proTour.map(k => k[typ]));
}

/**
 * Aggregiert eine Liste von Touren zu {anzahl, kennzahlen}.
 * kennzahlen: { messwert-typ → wert(number) | null }, in Registry-Reihenfolge,
 * enthält nur Typen, die in mindestens einer Tour vorkommen.
 * gewicht: Gewichts-Funktion für mittel-Messwerte (Default: gewichtGleich).
 */
export function aggregiereTouren(touren, { gewicht = gewichtGleich } = {}) {
  const proTour = touren.map(tourKennzahlen);

  const vorhanden = new Set();
  for (const k of proTour) for (const typ of Object.keys(k)) vorhanden.add(typ);

  const kennzahlen = {};
  for (const typ of Object.keys(MESSWERTE)) {   // kanonische Reihenfolge aus der Registry
    if (!vorhanden.has(typ)) continue;
    kennzahlen[typ] = fasseKennzahlZusammen(typ, proTour, gewicht);
  }

  return { anzahl: touren.length, kennzahlen };
}

/**
 * Die eine öffentliche Funktion für die Statistik-Ansicht:
 * „gib mir für Modul X und Zeitraum Y die zusammengefassten Kennzahlen".
 *
 * @param state  App-State (mit .sessions)
 * @param modul  'rad' | 'wandern' | …
 * @param art    'woche' | 'monat' | 'jahr'
 * @param anker  ISO-Tag im gewünschten Zeitraum (Default: heute)
 * @returns { modul, art, von, bis, anzahl, sessions, kennzahlen }
 *          sessions = die Touren des Zeitraums (neueste zuerst) für die
 *          antippbare Liste; kennzahlen = die zusammengefassten Werte.
 */
export function zeitraumStatistik(state, modul, art, anker, { gewicht = gewichtGleich } = {}) {
  const { von, bis } = zeitraum(art, anker);
  const sessions = tourenImZeitraum(state, modul, von, bis);
  const { kennzahlen } = aggregiereTouren(sessions, { gewicht });
  return { modul, art, von, bis, anzahl: sessions.length, sessions, kennzahlen };
}

// ------------------------------------------------------------
// Anzeige-Beschriftung eines Zeitraums (für den Kopf der Ansicht)
// ------------------------------------------------------------

const MONAT_LANG = (dt) => dt.toLocaleDateString('de-DE', { month: 'long', timeZone: 'UTC' });

/**
 * Menschenlesbare Beschriftung eines Zeitraums, z.B.
 *   woche → „6.–12. Juli 2026" (bzw. „29. Juni – 5. Juli 2026" über Monatsgrenze)
 *   monat → „Juli 2026"
 *   jahr  → „2026"
 * Rechnet in UTC, passend zu den übrigen Datums-Helfern.
 */
export function zeitraumLabel(art, anker = heuteIso()) {
  const { von, bis } = zeitraum(art, anker);

  if (art === 'jahr') return von.slice(0, 4);

  if (art === 'monat') {
    return isoZuDatum(von).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // woche: erster Tag … letzter Tag (bis ist exklusiv → einen Tag zurück)
  const a = isoZuDatum(von);
  const b = new Date(isoZuDatum(bis).getTime() - 86400000);
  const tag = (dt) => dt.getUTCDate();
  const jA = a.getUTCFullYear(), jB = b.getUTCFullYear();

  if (von.slice(0, 7) === b.toISOString().slice(0, 7)) {
    // gleicher Monat: „6.–12. Juli 2026"
    return `${tag(a)}.–${tag(b)}. ${MONAT_LANG(a)} ${jB}`;
  }
  if (jA === jB) {
    // gleicher Jahrgang, Monatswechsel: „29. Juni – 5. Juli 2026"
    return `${tag(a)}. ${MONAT_LANG(a)} – ${tag(b)}. ${MONAT_LANG(b)} ${jB}`;
  }
  // Jahreswechsel: „29. Dezember 2026 – 4. Januar 2027"
  return `${tag(a)}. ${MONAT_LANG(a)} ${jA} – ${tag(b)}. ${MONAT_LANG(b)} ${jB}`;
}
