// ============================================================
// modules/kraft/eingabe-html.js — die Eingabefelder eines Eintrags.
//
// DER eine Eingabe-Renderer: eintragInputsHtml() baut die Felder aus
// aktivitaet.messwerte + der Registry in core/metrics.js — egal ob Kraftsatz
// oder Cardio, egal ob eigene Session oder Segment im Kraft-Tag. Ein neuer
// Messwert in metrics.js taucht dadurch überall von allein auf.
//
// Reine Strings, also auch in Node renderbar; der Akzeptanztest hängt hieran.
// ============================================================

import { MESSWERTE, formatZahl, formatZahlEingabe, parseZahl } from '../../core/metrics.js';

export function escT(t) { // lokales Escaping (components.js braucht DOM-Umfeld nicht, aber Import-Trennung hält Tests schlank)
  return String(t ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Anzeigewert fürs Dauer-Eingabefeld: 5400 → "1:30", 2700 → "45". */
export function dauerInputWert(sek) {
  if (sek == null) return '';
  const h = Math.floor(sek / 3600), m = Math.round((sek % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : String(m);
}

/** Anzeigewert fürs Distanz-Eingabefeld: 1930 m → "1,93" (km) bzw. "1930" (Schwimmen, m). */
export function distanzInputWert(meter, kategorie) {
  if (meter == null) return '';
  if (kategorie === 'schwimmen') return formatZahlEingabe(Math.round(meter), 0);
  return formatZahlEingabe(meter / 1000, 2);   // km, bis 2 Nachkommastellen
}

/** Eingabe-Distanz → Meter. "1,93" km → 1930 m; Schwimmen: Meter direkt. */
export function distanzZuMeter(text, kategorie) {
  const n = parseZahl(text);
  if (n == null) return null;
  return kategorie === 'schwimmen' ? Math.round(n) : Math.round(n * 1000);
}

/**
 * DER eine Eingabe-Renderer: baut für einen Eintrag die Felder aus
 * aktivitaet.messwerte + Registry. Wird für Kraftsätze UND
 * Cardio-Segmente benutzt — der Akzeptanztest hängt hieran.
 */
export function eintragInputsHtml(aktivitaet, segment, eintrag) {
  const kat = aktivitaet.kategorie;
  return aktivitaet.messwerte.map(typ => {
    const def = MESSWERTE[typ];
    const roh = eintrag.messwerte[typ];
    let wert;
    if (roh == null) wert = '';
    else if (def.anzeige === 'zeit') wert = dauerInputWert(roh);
    else if (def.anzeige === 'distanz') wert = distanzInputWert(roh, kat);
    else wert = formatZahlEingabe(roh, def.dezimal ?? 2);
    // Feld-Label (Einheit): Distanz zeigt km bzw. m je nach Sportart
    const einheitLabel = def.anzeige === 'zeit' ? 'min'
      : def.anzeige === 'distanz' ? (kat === 'schwimmen' ? 'm' : 'km')
      : (def.einheit || def.kurz || def.label);
    // Placeholder zeigt das erwartete Format. Achtung: Beim Kraft-Cardio meint
    // „1:52" Stunden:Minuten (anders als im Rad-Modul, wo es Min:Sek sind).
    const platzhalter = def.anzeige === 'zeit' ? 'z.B. 45 oder 1:15'
      : def.anzeige === 'distanz' ? (kat === 'schwimmen' ? 'm' : 'km')
      : (def.kurz ?? def.label);
    return `<label class="feld">
      <input type="text" inputmode="${def.anzeige === 'zeit' ? 'text' : 'decimal'}" value="${escT(wert)}" placeholder="${escT(platzhalter)}"
        data-change="k.wert" data-seg="${segment.id}" data-eintrag="${eintrag.id}" data-typ="${typ}">
      <span>${escT(einheitLabel)}</span>
    </label>`;
  }).join('');
}

