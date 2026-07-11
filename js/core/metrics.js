// ============================================================
// metrics.js — Messwert-Registry
// DIE eine zentrale Stelle für alle Messwert-Typen.
// Neuer Messwert = hier EIN Eintrag. Nirgendwo sonst.
// (Das ist der Kern des Akzeptanztests aus dem Konzept:
//  ein neues Feld hier ergänzen → es erscheint überall automatisch.)
// ============================================================

// Aggregation:
//   'summe'  → Werte werden addiert (Volumen, Distanz, Dauer …)
//   'mittel' → Durchschnitt (Ø-Puls)
//   'max'    → Maximum (Max-Puls)
//
// anzeige (optional):
//   'zeit'    → Sekunden werden als Zeit formatiert (1:52 h / 38:20 min)
//   'distanz' → Meter werden je nach Kategorie als km oder m angezeigt
//
// schritt/dezimal: Hinweise für Eingabefelder (Etappe 1, Schritt 3).

export const MESSWERTE = Object.freeze({
  gewicht: Object.freeze({
    label: 'Gewicht', einheit: 'kg',
    agg: 'summe', summierbar: true,
    schritt: 0.25, dezimal: 2,
  }),
  wdh: Object.freeze({
    label: 'Wiederholungen', kurz: 'Wdh.', einheit: '',
    agg: 'summe', summierbar: true,
    schritt: 1, dezimal: 0,
  }),
  wdh_l: Object.freeze({
    label: 'Wdh. links', kurz: 'L', einheit: '',
    agg: 'summe', summierbar: true,
    schritt: 1, dezimal: 0,
  }),
  wdh_r: Object.freeze({
    label: 'Wdh. rechts', kurz: 'R', einheit: '',
    agg: 'summe', summierbar: true,
    schritt: 1, dezimal: 0,
  }),
  distanz: Object.freeze({
    label: 'Distanz', einheit: 'm',        // intern IMMER Meter
    agg: 'summe', summierbar: true,
    anzeige: 'distanz', schritt: 100, dezimal: 0,
  }),
  hoehenmeter: Object.freeze({
    label: 'Höhenmeter', kurz: 'hm', einheit: 'm',
    agg: 'summe', summierbar: true,
    schritt: 10, dezimal: 0,
  }),
  dauer: Object.freeze({
    label: 'Dauer', einheit: 's',          // intern IMMER Sekunden
    agg: 'summe', summierbar: true,
    anzeige: 'zeit',
  }),
  puls_avg: Object.freeze({
    label: 'Ø-Puls', einheit: 'bpm',
    agg: 'mittel', summierbar: false,
    schritt: 1, dezimal: 0, optional: true,
  }),
  puls_max: Object.freeze({
    label: 'Max-Puls', einheit: 'bpm',
    agg: 'max', summierbar: false,
    schritt: 1, dezimal: 0, optional: true,
  }),
  kalorien: Object.freeze({
    label: 'Kalorien', kurz: 'kcal', einheit: 'kcal',
    agg: 'summe', summierbar: true,
    schritt: 10, dezimal: 0, optional: true,  // versteckt-Standard; Auto-Schätzung ab Etappe 2
  }),
  schritte: Object.freeze({
    label: 'Schritte', einheit: '',
    agg: 'summe', summierbar: true,
    schritt: 100, dezimal: 0, optional: true,
  }),
  tempo_avg: Object.freeze({
    label: 'Ø-Geschw.', kurz: 'km/h', einheit: 'km/h',
    agg: 'mittel', summierbar: false,
    schritt: 0.1, dezimal: 1, optional: true,
  }),
  tempo_max: Object.freeze({
    label: 'Max-Geschw.', kurz: 'km/h', einheit: 'km/h',
    agg: 'max', summierbar: false,
    schritt: 0.1, dezimal: 1, optional: true,
  }),
  watt_avg: Object.freeze({
    label: 'Ø-Leistung', kurz: 'W', einheit: 'W',
    agg: 'mittel', summierbar: false,
    schritt: 1, dezimal: 0, optional: true,
  }),
  trittfrequenz: Object.freeze({
    label: 'Ø-Trittfrequenz', kurz: '1/min', einheit: '1/min',
    agg: 'mittel', summierbar: false,
    schritt: 1, dezimal: 0, optional: true,
  }),
});

/** Gibt es diesen Messwert-Typ? */
export function istMesswert(typ) {
  return Object.prototype.hasOwnProperty.call(MESSWERTE, typ);
}

// ------------------------------------------------------------
// Aggregation — EIN Code-Pfad für alle Typen.
// ------------------------------------------------------------

/**
 * Aggregiert eine Liste von Rohwerten gemäß Registry-Regel.
 * Leere/ungültige Werte werden ignoriert. Kein Wert → null.
 */
export function aggregiere(typ, werte) {
  const def = MESSWERTE[typ];
  if (!def) throw new Error(`Unbekannter Messwert-Typ: ${typ}`);
  const zahlen = (werte ?? []).filter(w => typeof w === 'number' && Number.isFinite(w));
  if (zahlen.length === 0) return null;
  switch (def.agg) {
    case 'summe':  return zahlen.reduce((a, b) => a + b, 0);
    case 'mittel': return zahlen.reduce((a, b) => a + b, 0) / zahlen.length;
    case 'max':    return Math.max(...zahlen);
    default: throw new Error(`Unbekannte Aggregation '${def.agg}' für ${typ}`);
  }
}

// ------------------------------------------------------------
// Berechnete Werte (werden NICHT gespeichert)
// ------------------------------------------------------------

/** km/h aus Metern und Sekunden. */
export function berechneGeschwindigkeit(distanzM, dauerS) {
  if (!distanzM || !dauerS) return null;
  return (distanzM / 1000) / (dauerS / 3600);
}

/** Volumen (kg) eines Eintrags: gewicht × wdh. */
export function eintragVolumen(messwerte) {
  const g = messwerte?.gewicht, w = messwerte?.wdh;
  if (typeof g !== 'number' || typeof w !== 'number') return 0;
  return g * w;
}

// ------------------------------------------------------------
// Formatierung & Parsen (deutsch: Komma als Dezimaltrenner)
// ------------------------------------------------------------

/** "82,5" → 82.5 · "" → null. Akzeptiert Komma UND Punkt. */
export function parseZahl(str) {
  if (typeof str === 'number') return Number.isFinite(str) ? str : null;
  if (typeof str !== 'string') return null;
  const s = str.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Zahl mit deutschem Format, feste Dezimalstellen nur wenn nötig. */
export function formatZahl(wert, dezimal = null) {
  if (wert == null || !Number.isFinite(wert)) return '–';
  const opts = dezimal == null
    ? { maximumFractionDigits: 2 }
    : { minimumFractionDigits: 0, maximumFractionDigits: dezimal };
  return wert.toLocaleString('de-DE', opts);
}

/** Sekunden → "1:52 h" (ab 1 h) bzw. "38:20 min". */
export function formatDauer(sek) {
  if (sek == null || !Number.isFinite(sek) || sek < 0) return '–';
  sek = Math.round(sek);
  const h = Math.floor(sek / 3600);
  const m = Math.floor((sek % 3600) / 60);
  const s = sek % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')} h`;
  return `${m}:${String(s).padStart(2, '0')} min`;
}

/** "1:52" → 6720 s (h:mm) · "38:20" → 2300 s (m:ss)? Nein — siehe Regel unten. */
export function parseDauer(str) {
  // Regel: "H:MM" wird als Stunden:Minuten gelesen, eine nackte Zahl als MINUTEN.
  // (Fürs Loggen von Touren/Cardio ist das die natürliche Eingabe.)
  if (typeof str === 'number') return Math.round(str * 60);
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (s === '') return null;
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) return (+m[1]) * 3600 + (+m[2]) * 60;
  const n = parseZahl(s);
  return n == null ? null : Math.round(n * 60);
}

/**
 * Zentrale Anzeige-Formatierung für einen Messwert.
 * ctx.kategorie steuert die Distanz-Einheit (schwimmen → m, sonst km).
 */
export function formatWert(typ, wert, ctx = {}) {
  const def = MESSWERTE[typ];
  if (!def) throw new Error(`Unbekannter Messwert-Typ: ${typ}`);
  if (wert == null || !Number.isFinite(wert)) return '–';

  if (def.anzeige === 'zeit') return formatDauer(wert);

  if (def.anzeige === 'distanz') {
    if (ctx.kategorie === 'schwimmen') return `${formatZahl(Math.round(wert), 0)} m`;
    return `${formatZahl(wert / 1000, 1)} km`;
  }

  const zahl = formatZahl(wert, def.dezimal ?? 2);
  return def.einheit ? `${zahl} ${def.einheit}` : zahl;
}
