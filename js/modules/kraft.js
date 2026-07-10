// ============================================================
// kraft.js — das Kraft-Modul (dünnes Modul auf dickem Kern)
//
// Aufbau:
//   1) Reine Logik (Node-testbar, kein DOM): Progression, PRs,
//      Verlauf, Prefill — Verhalten 1:1 aus der Gym-App übernommen.
//   2) HTML-Bausteine (reine String-Funktionen).
//   3) erstelleKraftModul(ctx) → Ansichten + Aktionen für app.js.
//
// Ein-Pfad-Prinzip: eintragInputsHtml() rendert die Eingabefelder
// für JEDES Segment aus aktivitaet.messwerte + der Registry —
// egal ob Kraftsatz oder Cardio, egal ob eigene Session oder
// Segment im Kraft-Tag. Neuer Messwert in metrics.js ⇒ taucht
// überall automatisch auf.
// ============================================================

import { MESSWERTE, formatWert, formatZahl, parseZahl, parseDauer } from '../core/metrics.js';
import {
  heuteIso, neueSession, neuesSegment, neuerEintrag,
  addSegment, addEintrag, hatFlag, segmentVolumen,
  findeAktivitaet, loeseSegmentAuf,
} from '../core/model.js';
import {
  addAktivitaet, aktivitaetenNachKategorie, sucheAktivitaet,
  addAlternative, entferneAlternative, vorschlagMesswerte,
  benenneUm, setzeMesswerte, entferneAktivitaet, archiviere, wirdVerwendet,
} from '../core/library.js';
import {
  planFuer, erstellePlan, addEinheit, benenneEinheitUm, loescheEinheit,
  einheitenBibliothek, findeEinheit,
  addAktivitaetZuEinheit, entferneAktivitaetAusEinheit, verschiebeAktivitaetInEinheit,
  zyklusEinheiten, addZuZyklus, entferneAusZyklus, verschiebeImZyklus, setzePosition, setzeAnker,
  naechsteEinheit, schalteWeiter, sessionAusEinheit, aktuelleEinheit,
} from '../core/plan.js';
import { sparkline, balken, trend } from '../ui/charts.js';
import { teileKarte } from '../ui/share.js';
import { bestaetige, hinweis } from '../ui/components.js';

export const MODUL = 'kraft';

// ============================================================
// 1) REINE LOGIK
// ============================================================

export const PROG_DEFAULTS = {
  double:   { saetze: 4, wdhMin: 8, wdhMax: 12, schritt: 2.5 },
  strength: { saetze: 4, wdh: 12, schritt: 2.5 },
  technik:  {},
};

/** Identität eines Segments für Historie: Alternative zählt eigenständig. */
export function identVon(segment) {
  return segment.altOf ?? segment.aktivitaetId;
}

/** Ist der Eintrag ein Arbeitssatz mit Gewicht? */
function istArbeitssatz(e) {
  return !hatFlag(e, 'aufwaermsatz') && typeof e.messwerte.gewicht === 'number';
}

// --- Einarmig (L/R) & Assistiert (negatives Gewicht) ---

/** Ist dieser Eintrag einarmig erfasst? (hat getrennte L/R-Wdh) */
export function istEinarmig(e) {
  return e?.messwerte?.wdh_l != null || e?.messwerte?.wdh_r != null;
}

/**
 * Die für Progression/PR maßgebliche Wdh eines Satzes.
 * Einarmig → die SCHWÄCHERE Seite (min L/R); normal → wdh.
 * (Deine Regel: erst steigern, wenn beide Seiten das Ziel schaffen.)
 */
export function effektiveWdh(e) {
  if (istEinarmig(e)) {
    const l = e.messwerte.wdh_l, r = e.messwerte.wdh_r;
    if (l == null) return r ?? null;
    if (r == null) return l;
    return Math.min(l, r);
  }
  return e.messwerte.wdh ?? null;
}

/** Gesamt-Wdh eines Satzes (einarmig: L+R, sonst wdh) — fürs Volumen-Zählen. */
function gesamtWdh(e) {
  if (istEinarmig(e)) return (e.messwerte.wdh_l ?? 0) + (e.messwerte.wdh_r ?? 0);
  return e.messwerte.wdh ?? 0;
}

/**
 * Volumenbeitrag eines Satzes in kg.
 * Assistiert (negatives Gewicht = Hilfe) trägt 0 bei — Hilfe ist kein bewegtes
 * Gewicht. Einarmig zählt beide Seiten (gleiche Last je Wdh).
 */
export function satzVolumen(e) {
  const kg = e.messwerte.gewicht;
  if (typeof kg !== 'number' || kg <= 0) return 0;
  return kg * gesamtWdh(e);
}

/** Hat der Eintrag irgendeinen Wert? */
export function eintragLeer(e) {
  return Object.keys(e.messwerte).length === 0;
}

/**
 * Erledigte Segmente einer Identität, VOR einem Stichtag, neueste zuerst.
 * (Zählregel aus der Gym-App: nur explizit abgehakte Übungen zählen.)
 */
function segmenteVor(state, identId, vorIso) {
  const out = [];
  const sessions = [...state.sessions]
    .filter(s => s.datum < vorIso)
    .sort((a, b) => b.datum.localeCompare(a.datum));
  for (const s of sessions) {
    for (const seg of s.segmente) {
      if (seg.erledigt === true && identVon(seg) === identId && seg.eintraege.length) {
        out.push({ datum: s.datum, segment: seg });
      }
    }
  }
  return out;
}

/** Letzte Session dieser Identität (nur Arbeitssätze). null wenn keine. */
export function letzteSaetze(state, identId, vorIso = heuteIso()) {
  for (const { datum, segment } of segmenteVor(state, identId, vorIso)) {
    const arbeit = segment.eintraege.filter(istArbeitssatz);
    if (arbeit.length) return { datum, eintraege: arbeit };
  }
  return null;
}

/** Letzte n erledigte Segmente (für „Verlauf ⌄"), neueste zuerst. */
export function verlaufLetzte(state, identId, n = 4, vorIso = heuteIso()) {
  return segmenteVor(state, identId, vorIso).slice(0, n);
}

/**
 * Bestwert vor einem Tag: „bestes" Gewicht + zugehörige (effektive) Wdh.
 * Bei assistierten Übungen (negatives Gewicht) ist WENIGER Hilfe besser —
 * also gilt das größere (näher an 0 / positivere) Gewicht als Rekord.
 * Da −12,5 > −15, funktioniert der normale >-Vergleich hier von selbst.
 */
export function bestVorTag(state, identId, tagIso) {
  let maxKg = null, wdhBeiMax = null;
  for (const { segment } of segmenteVor(state, identId, tagIso)) {
    for (const e of segment.eintraege) {
      if (!istArbeitssatz(e)) continue;
      const kg = e.messwerte.gewicht, w = effektiveWdh(e);
      if (maxKg == null || kg > maxKg) { maxKg = kg; wdhBeiMax = w; }
      else if (kg === maxKg && w != null && (wdhBeiMax == null || w > wdhBeiMax)) { wdhBeiMax = w; }
    }
  }
  return { maxKg, wdhBeiMax };
}

/** Neuer Rekord? → null | 'gewicht' | 'wdh'. Erste Session zählt nicht. */
export function eintragPR(state, identId, eintrag, tagIso = heuteIso()) {
  if (hatFlag(eintrag, 'aufwaermsatz')) return null;
  const kg = eintrag.messwerte.gewicht, w = effektiveWdh(eintrag);
  if (typeof kg !== 'number' || typeof w !== 'number') return null;
  const { maxKg, wdhBeiMax } = bestVorTag(state, identId, tagIso);
  if (maxKg == null) return null;
  if (kg > maxKg) return 'gewicht';                       // mehr Last bzw. weniger Hilfe
  if (kg === maxKg && wdhBeiMax != null && w > wdhBeiMax) return 'wdh';
  return null;
}

/**
 * Progressions-Vorschlag — Verhalten exakt wie die Gym-App:
 * nur die Sätze beim HÖCHSTEN Gewicht der letzten Session zählen.
 * prog steckt in einstellungen.prog der Aktivität ODER Alternative.
 */
export function berechneVorschlag(state, identId, prog, vorIso = heuteIso()) {
  if (!prog || !prog.art || prog.art === 'off') return null;
  if (prog.art === 'technik') {
    return { text: 'Gewicht halten · saubere Ausführung priorisieren', art: 'technik' };
  }
  const last = letzteSaetze(state, identId, vorIso);
  if (!last) return null;
  const topKg = Math.max(...last.eintraege.map(e => e.messwerte.gewicht));
  const topSaetze = last.eintraege.filter(e => e.messwerte.gewicht === topKg);

  if (prog.art === 'double') {
    const p = { ...PROG_DEFAULTS.double, ...prog };
    const fertig = topSaetze.length >= p.saetze &&
      topSaetze.every(e => (effektiveWdh(e) ?? -1) >= p.wdhMax);
    if (fertig) {
      const next = Math.round((topKg + p.schritt) * 100) / 100;
      return { text: `↗ Auf ${formatZahl(next)} kg steigern · Ziel ${p.wdhMin}×${p.saetze}`, art: 'steigern', nextKg: next };
    }
    return { text: `${formatZahl(topKg)} kg halten · Ziel ${p.wdhMax} Wdh in allen Sätzen`, art: 'halten', zielWdh: p.wdhMax };
  }
  if (prog.art === 'strength') {
    const p = { ...PROG_DEFAULTS.strength, ...prog };
    const fertig = topSaetze.length >= p.saetze &&
      topSaetze.every(e => (effektiveWdh(e) ?? -1) >= p.wdh);
    if (fertig) {
      const next = Math.round((topKg + p.schritt) * 100) / 100;
      return { text: `↗ Auf ${formatZahl(next)} kg steigern · Ziel ${p.wdh} Wdh`, art: 'steigern', nextKg: next };
    }
    return { text: `${formatZahl(topKg)} kg halten · Ziel ${p.wdh} Wdh in allen Sätzen`, art: 'halten', zielWdh: p.wdh };
  }
  return null;
}

/** Prefill beim Abhaken: erster Arbeitssatz der letzten Session als Startwert. */
export function prefillEintrag(state, identId, vorIso = heuteIso()) {
  const last = letzteSaetze(state, identId, vorIso);
  if (!last) return null;
  const e = last.eintraege[0];
  const mw = {};
  if (e.messwerte.gewicht != null) mw.gewicht = e.messwerte.gewicht;
  if (istEinarmig(e)) {
    if (e.messwerte.wdh_l != null) mw.wdh_l = e.messwerte.wdh_l;
    if (e.messwerte.wdh_r != null) mw.wdh_r = e.messwerte.wdh_r;
  } else if (e.messwerte.wdh != null) {
    mw.wdh = e.messwerte.wdh;
  }
  return Object.keys(mw).length ? neuerEintrag(mw, { quelle: 'prefill' }) : null;
}

/** Kraft-Zusammenfassung: "3 Sätze · 1 Aufw. · 60–80 kg" (wie Gym-App). */
export function segmentZusammenfassungKraft(segment) {
  const n = segment.eintraege.length;
  if (!n) return 'noch keine Sätze';
  const aufw = segment.eintraege.filter(e => hatFlag(e, 'aufwaermsatz')).length;
  const arbeitKgs = segment.eintraege.filter(e => !hatFlag(e, 'aufwaermsatz'))
    .map(e => e.messwerte.gewicht).filter(v => typeof v === 'number');
  const alleKgs = segment.eintraege.map(e => e.messwerte.gewicht).filter(v => typeof v === 'number');
  const kgs = arbeitKgs.length ? arbeitKgs : alleKgs;
  const teile = [`${n} ${n > 1 ? 'Sätze' : 'Satz'}`];
  if (aufw) teile.push(`${aufw} Aufw.`);
  if (kgs.length) {
    const min = Math.min(...kgs), max = Math.max(...kgs);
    teile.push(min === max ? `${formatZahl(min)} kg` : `${formatZahl(min)}–${formatZahl(max)} kg`);
  }
  return teile.join(' · ');
}

/** Cardio-/Sonstiges-Zusammenfassung: formatierte Messwerte des einen Eintrags. */
export function segmentZusammenfassungWerte(aktivitaet, segment) {
  const e = segment.eintraege[0];
  if (!e || eintragLeer(e)) return 'noch keine Werte';
  const teile = [];
  for (const typ of aktivitaet.messwerte) {
    const w = e.messwerte[typ];
    if (w == null) continue;
    const txt = formatWert(typ, w, { kategorie: aktivitaet.kategorie });
    teile.push(typ === 'puls_avg' ? `Ø ${txt}` : typ === 'puls_max' ? `max ${txt}` : txt);
  }
  return teile.length ? teile.join(' · ') : 'noch keine Werte';
}

/** Volumen einer Session — zählt NUR erledigte Segmente (Gym-App-Regel). */
export function sessionVolumenErledigt(session) {
  return session.segmente
    .filter(s => s.erledigt === true)
    .flatMap(s => s.eintraege)
    .filter(e => !hatFlag(e, 'aufwaermsatz'))
    .reduce((sum, e) => sum + satzVolumen(e), 0);
}

/** Ein Satz als Kurztext: "80×8" bzw. einarmig "80×12/11" · Aufwärmen mit A. */
export function fmtSatz(e) {
  const kg = e.messwerte.gewicht;
  const kgTxt = kg != null ? formatZahl(kg) : '?';
  let wTxt;
  if (istEinarmig(e)) {
    const l = e.messwerte.wdh_l, r = e.messwerte.wdh_r;
    wTxt = `${l != null ? formatZahl(l, 0) : '?'}/${r != null ? formatZahl(r, 0) : '?'}`;
  } else {
    const w = e.messwerte.wdh;
    wTxt = w != null ? formatZahl(w, 0) : '?';
  }
  const kern = `${kgTxt}×${wTxt}`;
  return hatFlag(e, 'aufwaermsatz') ? `A ${kern}` : kern;
}

// --- Fortschritt (für den Progress-Bereich) ---

/** Bestwerte eines erledigten Segments: Top-Gewicht, Wdh dabei, Volumen, Ø-Gewicht. */
function segmentBestwerte(segment) {
  let topKg = null, wdhBeiTop = null, vol = 0;
  let gewichtWdhSumme = 0, wdhSumme = 0;   // für Ø-Gewicht (nach Wdh gewichtet)
  for (const e of segment.eintraege) {
    if (!istArbeitssatz(e)) continue;
    vol += satzVolumen(e);
    const kg = e.messwerte.gewicht, w = effektiveWdh(e);
    if (topKg == null || kg > topKg) { topKg = kg; wdhBeiTop = w; }
    else if (kg === topKg && w != null && (wdhBeiTop == null || w > wdhBeiTop)) { wdhBeiTop = w; }
    // Ø-Gewicht: jeder Arbeitssatz mit seinen (Gesamt-)Wdh gewichtet
    const gw = gesamtWdh(e);
    if (gw > 0) { gewichtWdhSumme += kg * gw; wdhSumme += gw; }
  }
  const avgKg = wdhSumme > 0 ? Math.round((gewichtWdhSumme / wdhSumme) * 100) / 100 : topKg;
  return { topKg, wdhBeiTop, vol, avgKg };
}

/**
 * Zeitreihe einer Übung (chronologisch, älteste zuerst) für den Fortschritt.
 * Liefert je erledigter Session: { datum, topKg, wdhBeiTop, vol }.
 */
export function fortschrittsSerie(state, identId, { limit = 12 } = {}) {
  const punkte = [];
  const sessions = [...state.sessions]
    .filter(s => s.segmente.some(seg => seg.erledigt === true && identVon(seg) === identId && seg.eintraege.length))
    .sort((a, b) => a.datum.localeCompare(b.datum));
  for (const s of sessions) {
    for (const seg of s.segmente) {
      if (seg.erledigt === true && identVon(seg) === identId && seg.eintraege.length) {
        const b = segmentBestwerte(seg);
        if (b.topKg != null || b.vol > 0) {
          punkte.push({ datum: s.datum, ...b, saetze: seg.eintraege.map(fmtSatz) });
        }
      }
    }
  }
  return limit ? punkte.slice(-limit) : punkte;
}

/**
 * Highlights einer Session für die Teilen-Karte:
 * PRs (Gewicht/Wdh) und Steigerungen ggü. der letzten Session derselben Übung.
 * Gibt Liste von { name, art:'pr-gewicht'|'pr-wdh'|'up', text } zurück.
 */
export function sessionHighlights(state, session) {
  const out = [];
  for (const seg of session.segmente) {
    if (seg.erledigt !== true) continue;
    const { aktivitaet, anzeigeName } = loeseSegmentAuf(state, seg);
    if (!aktivitaet || aktivitaet.kategorie !== 'kraft') continue;
    const ident = identVon(seg);

    // PR prüfen: bester Arbeitssatz dieser Session vs. Historie davor
    let prArt = null;
    for (const e of seg.eintraege) {
      const pr = eintragPR(state, ident, e, session.datum);
      if (pr === 'gewicht') { prArt = 'gewicht'; break; }
      if (pr === 'wdh' && !prArt) prArt = 'wdh';
    }
    if (prArt) {
      out.push({ name: anzeigeName, art: 'pr-' + prArt,
        text: prArt === 'gewicht' ? 'Neues Top-Gewicht' : 'Wdh-Rekord' });
      continue; // PR schlägt Steigerung — nicht doppelt melden
    }

    // Steigerung ggü. der LETZTEN Session (Top-Gewicht bzw. dessen Wdh)
    const jetzt = (() => {
      let topKg = null, wdh = null;
      for (const e of seg.eintraege) {
        if (hatFlag(e, 'aufwaermsatz') || typeof e.messwerte.gewicht !== 'number') continue;
        const kg = e.messwerte.gewicht, w = effektiveWdh(e);
        if (topKg == null || kg > topKg) { topKg = kg; wdh = w; }
        else if (kg === topKg && w != null && (wdh == null || w > wdh)) wdh = w;
      }
      return { topKg, wdh };
    })();
    const last = letzteSaetze(state, ident, session.datum);
    if (jetzt.topKg != null && last) {
      let vorKg = null, vorWdh = null;
      for (const e of last.eintraege) {
        const kg = e.messwerte.gewicht, w = effektiveWdh(e);
        if (vorKg == null || kg > vorKg) { vorKg = kg; vorWdh = w; }
        else if (kg === vorKg && w != null && (vorWdh == null || w > vorWdh)) vorWdh = w;
      }
      if (vorKg != null) {
        if (jetzt.topKg > vorKg) {
          out.push({ name: anzeigeName, art: 'up', text: `+${formatZahl(jetzt.topKg - vorKg)} kg` });
        } else if (jetzt.topKg === vorKg && jetzt.wdh != null && vorWdh != null && jetzt.wdh > vorWdh) {
          out.push({ name: anzeigeName, art: 'up', text: `+${jetzt.wdh - vorWdh} Wdh` });
        }
      }
    }
  }
  return out;
}

/** ISO-Wochenschlüssel "YYYY-Www" für Wochenvolumen-Gruppierung. */
function isoWoche(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const tag = (dt.getUTCDay() + 6) % 7;          // Mo=0
  dt.setUTCDate(dt.getUTCDate() - tag + 3);        // Donnerstag der Woche
  const ersterDo = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const wo = 1 + Math.round(((dt - ersterDo) / 86400000 - 3 + ((ersterDo.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(wo).padStart(2, '0')}`;
}

/**
 * Wochenvolumen der letzten n Wochen (gesamt über alle Kraft-Sessions).
 * Liefert { wochen:[schluessel…], werte:[kg…] } chronologisch.
 */
export function wochenVolumen(state, { wochen = 6, modul = MODUL } = {}) {
  const proWoche = new Map();
  for (const s of state.sessions) {
    if ((s.modul ?? MODUL) !== modul) continue;
    const vol = s.segmente.filter(seg => seg.erledigt === true)
      .flatMap(seg => seg.eintraege)
      .filter(e => !hatFlag(e, 'aufwaermsatz'))
      .reduce((sum, e) => sum + satzVolumen(e), 0);
    if (vol <= 0) continue;
    const wk = isoWoche(s.datum);
    proWoche.set(wk, (proWoche.get(wk) ?? 0) + vol);
  }
  const sortiert = [...proWoche.keys()].sort();
  const letzte = sortiert.slice(-wochen);
  return { wochen: letzte, werte: letzte.map(w => Math.round(proWoche.get(w))) };
}

// ============================================================
// 2) HTML-BAUSTEINE (reine Strings — auch in Node renderbar)
// ============================================================

function escT(t) { // lokales Escaping (components.js braucht DOM-Umfeld nicht, aber Import-Trennung hält Tests schlank)
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
  if (kategorie === 'schwimmen') return formatZahl(Math.round(meter), 0);
  return formatZahl(meter / 1000, 2);   // km, bis 2 Nachkommastellen
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
    else wert = formatZahl(roh, def.dezimal ?? 2);
    // Feld-Label (Einheit): Distanz zeigt km bzw. m je nach Sportart
    const einheitLabel = def.anzeige === 'zeit' ? 'min'
      : def.anzeige === 'distanz' ? (kat === 'schwimmen' ? 'm' : 'km')
      : (def.einheit || def.kurz || def.label);
    const platzhalter = def.anzeige === 'zeit' ? 'min'
      : def.anzeige === 'distanz' ? (kat === 'schwimmen' ? 'm' : 'km')
      : (def.kurz ?? def.label);
    return `<label class="feld">
      <input type="text" inputmode="decimal" value="${escT(wert)}" placeholder="${escT(platzhalter)}"
        data-change="k.wert" data-seg="${segment.id}" data-eintrag="${eintrag.id}" data-typ="${typ}">
      <span>${escT(einheitLabel)}</span>
    </label>`;
  }).join('');
}

// ============================================================
// 3) MODUL: Ansichten + Aktionen
// ============================================================

export function erstelleKraftModul(ctx) {
  // ctx: { state, save(), render(), sheet, esc, formatDatum, tabWechsel? }
  const { sheet, esc, formatDatum } = ctx;
  const tabWechsel = ctx.tabWechsel ?? (() => {});

  // UI-Zustand (nicht persistiert)
  const offen = new Set();          // erledigte Karten, die manuell AUFgeklappt wurden
  const zu = new Set();             // offene Karten, die manuell ZUgeklappt wurden
  const verlaufOffen = new Set();   // aufgeklappte Verläufe
  const altOffen = new Set();       // offene Alternativen-Umschalter
  const planOffen = new Set();      // aufgeklappte Plan-Einheiten
  let picker = null;                // { ziel:'session'|'einheit', einheitId?, suche:'' }
  let progMetrik = 'gewicht';       // Fortschritt: 'gewicht' | 'avg' | 'volumen'
  const progExpand = new Set();     // Übungs-IDs mit vollständig ausgeklappter Verlaufsliste
  const progGruppeAuf = new Set();  // manuell aufgeklappte Einheiten-Gruppen im Fortschritt
  const progGruppeZu = new Set();   // manuell zugeklappte (übersteuert die heute-Automatik)

  const S = () => ctx.state;
  // Heutige Kraft-Sessions; eine noch OFFENE hat Vorrang (die bearbeitet man
  // gerade), sonst die zuletzt angelegte. So blockiert eine bereits
  // abgeschlossene Einheit nicht das Starten einer zweiten am selben Tag.
  const heutigeSessions = () =>
    S().sessions.filter(s => s.datum === heuteIso() && s.modul === MODUL && !s.uebersprungen);
  const heutigeSession = () => {
    const alle = heutigeSessions();
    return alle.find(s => !s.abgeschlossen) ?? alle.at(-1) ?? null;
  };

  function effektiveEinstellungen(seg) {
    const { aktivitaet, alternative } = loeseSegmentAuf(S(), seg);
    return (seg.altOf ? alternative?.einstellungen : aktivitaet?.einstellungen) ?? {};
  }

  // ----------------------------------------------------------
  // HEUTE-TAB
  // ----------------------------------------------------------

  function heuteHtml() {
    const s = heutigeSession();
    return s ? sessionHtml(s) : startHtml();
  }

  /** Aktualisiert nur die „kg bewegt"-Zahl im Heute-Tab, ohne Neu-Rendern.
   *  So bleibt beim Werte-Eintragen der Tastatur-Fokus im Eingabefeld. */
  function aktualisiereVolumenAnzeige() {
    const el = document.getElementById('volZahl');
    if (!el) return;
    const s = heutigeSession();
    if (!s) return;
    el.textContent = formatZahl(sessionVolumenErledigt(s), 0);
  }

  function startHtml() {
    const naechste = naechsteEinheit(S(), MODUL);
    if (!naechste) {
      return `<div class="karte leer anim">
        <h2>Noch kein Plan</h2>
        <p>Leg im Plan-Tab deine Einheiten an — oder starte einfach spontan.</p>
        <div class="knopf-zeile">
          <button class="knopf primaer" data-action="tab" data-tab="plan">Plan anlegen</button>
          <button class="knopf" data-action="k.frei">Freie Session</button>
        </div>
      </div>`;
    }
    return `<div class="hero anim">
      <span class="eyebrow"><span class="pip"></span>Nächste Einheit</span>
      <h1>${esc(naechste.name)}</h1>
      <p class="dim">${naechste.segmente.length} Übungen im Plan</p>
      <div class="knopf-zeile">
        <button class="knopf primaer gross" data-action="k.start" data-einheit="${naechste.id}">Jetzt starten</button>
        <button class="knopf" data-action="k.ueberspringen">Überspringen ›</button>
      </div>
      <button class="knopf geist" data-action="k.frei">Freie Session starten</button>
    </div>`;
  }

  function sessionHtml(s) {
    const einheit = s.ausPlan ? findeEinheit(S(), MODUL, s.ausPlan) : null;
    const titel = einheit ? einheit.name : 'Freie Session';
    const vol = sessionVolumenErledigt(s);
    const fertig = s.abgeschlossen === true;

    let html = `<div class="session-kopf anim">
      <div>
        <span class="eyebrow"><span class="pip"></span>${fertig ? 'Erledigt' : 'Heute'}</span>
        <h1>${esc(titel)}</h1>
        <p class="dim">${formatDatum(s.datum)}</p>
      </div>
      <div class="vol"><span class="num" id="volZahl">${formatZahl(vol, 0)}</span><span class="dim">kg bewegt</span></div>
    </div>`;

    html += s.segmente.map(seg => segmentKarteHtml(s, seg)).join('');

    if (!fertig) {
      html += `<button class="knopf geist voll" data-action="k.uebungPlus">+ Übung hinzufügen</button>`;
    }

    // Session-Notiz (Tagesnotiz): immer sichtbar. Bei abgeschlossen nur lesbar,
    // sofern etwas drin steht.
    const notiz = (s.notiz ?? '').trim();
    if (!fertig) {
      html += `<div class="karte notiz-karte">
        <label class="sheet-abschnitt" for="sessionNotiz">Notiz zum Tag</label>
        <textarea id="sessionNotiz" class="notiz-feld" rows="2"
          placeholder="z.B. Schulter links hat gezwickt, Kopf war nicht ganz da…"
          data-change="k.sessionNotiz">${esc(s.notiz ?? '')}</textarea>
      </div>`;
    } else if (notiz) {
      html += `<div class="karte notiz-karte ro">
        <span class="sheet-abschnitt">Notiz zum Tag</span>
        <p class="notiz-text">${esc(notiz)}</p>
      </div>`;
    }

    html += fertig
      ? `<div class="fertig-banner anim">
          <span>Einheit abgeschlossen ✓</span>
          <span class="banner-knoepfe">
            <button class="knopf klein" data-action="k.teilen">Teilen</button>
            <button class="knopf klein" data-action="k.wiederOeffnen">Wieder öffnen</button>
          </span>
        </div>`
      : `<button class="knopf primaer gross voll" data-action="k.abschliessen">Einheit abschließen ✓</button>`;
    return html;
  }

  function segmentKarteHtml(session, seg) {
    const { aktivitaet, anzeigeName } = loeseSegmentAuf(S(), seg);
    if (!aktivitaet) return '';
    const istKraft = aktivitaet.kategorie === 'kraft';
    const readonly = session.abgeschlossen === true;   // abgeschlossen → nur ansehen
    const check = seg.erledigt === true;
    // Offen-Regel: bei abgeschlossen sind erledigte zu (nur Zusammenfassung),
    // sonst wie gehabt. Manuelles Auf-/Zuklappen nur im offenen Zustand.
    const auf = readonly ? false : (check ? offen.has(seg.id) : !zu.has(seg.id));
    const zsf = istKraft ? segmentZusammenfassungKraft(seg) : segmentZusammenfassungWerte(aktivitaet, seg);
    const punktKlasse = aktivitaet.kategorie === 'kraft' ? 'kraft' : aktivitaet.kategorie;
    const geraeteNotiz = (aktivitaet.notiz ?? '').trim();

    // Kopf: bei readonly kein ⚙️, Titel nicht klickbar, Check nur Anzeige
    let html = `<div class="karte segment ${check ? 'erledigt' : ''} ${readonly ? 'ro' : ''} anim">
      <div class="seg-kopf">
        <${readonly ? 'span' : 'button'} class="check ${check ? 'an' : ''}" ${readonly ? '' : `data-action="k.check" data-seg="${seg.id}"`} aria-label="abhaken"></${readonly ? 'span' : 'button'}>
        <${readonly ? 'div' : 'button'} class="seg-titel" ${readonly ? '' : `data-action="k.auf" data-seg="${seg.id}"`}>
          <strong><span class="punkt ${punktKlasse}"></span>${esc(anzeigeName)}</strong>
          <small class="dim">${esc(zsf)}</small>
        </${readonly ? 'div' : 'button'}>
        ${readonly ? '' : `<button class="zahn" data-action="k.einstellungen" data-akt="${aktivitaet.id}" ${seg.altOf ? `data-alt="${seg.altOf}"` : ''}>⚙️</button>`}
      </div>`;

    // Geräte-Notiz: immer sichtbar (auch readonly), wenn vorhanden
    if (geraeteNotiz) {
      html += `<div class="geraete-notiz"><span class="gn-icon">🔧</span>${esc(geraeteNotiz)}</div>`;
    }

    if (auf) {
      html += `<div class="seg-inhalt">`;

      // Alternativen-Umschalter (Tagestausch, altOf)
      if ((aktivitaet.alternativen ?? []).length) {
        html += `<button class="chip tausch" data-action="k.altListe" data-seg="${seg.id}">⇄ ${esc(anzeigeName)}</button>`;
        if (altOffen.has(seg.id)) {
          html += `<div class="chip-zeile">
            <button class="chip ${!seg.altOf ? 'aktiv' : ''}" data-action="k.altWahl" data-seg="${seg.id}" data-alt="">${esc(aktivitaet.name)}</button>
            ${aktivitaet.alternativen.map(a =>
              `<button class="chip ${seg.altOf === a.id ? 'aktiv' : ''}" data-action="k.altWahl" data-seg="${seg.id}" data-alt="${a.id}">${esc(a.name)}</button>`).join('')}
          </div>`;
        }
      }

      // Progressions-Vorschlag (nur Kraft)
      if (istKraft) {
        const prog = effektiveEinstellungen(seg).prog;
        const v = berechneVorschlag(S(), identVon(seg), prog, session.datum);
        if (v) html += `<div class="vorschlag ${v.art}">${esc(v.text)}</div>`;
      }

      // Zuletzt + Verlauf
      const verlauf = verlaufLetzte(S(), identVon(seg), 4, session.datum);
      if (verlauf.length) {
        const zeile = t => istKraft
          ? t.segment.eintraege.map(fmtSatz).join(' · ')
          : segmentZusammenfassungWerte(aktivitaet, t.segment);
        html += `<button class="zuletzt" data-action="k.verlauf" data-seg="${seg.id}">
          Zuletzt (${formatDatum(verlauf[0].datum)}): ${esc(zeile(verlauf[0]))} <span class="dim">Verlauf ${verlaufOffen.has(seg.id) ? '⌃' : '⌄'}</span>
        </button>`;
        if (verlaufOffen.has(seg.id)) {
          html += `<div class="verlauf-liste">${verlauf.map((t, i) =>
            `<div class="${i === 0 ? 'gruen' : ''}"><span class="dim">${formatDatum(t.datum)}</span> ${esc(zeile(t))}</div>`).join('')}</div>`;
        }
      }

      // Einträge
      if (istKraft) {
        html += seg.eintraege.map((e, i) => satzZeileHtml(session, seg, aktivitaet, e, i)).join('');
        html += `<button class="knopf klein" data-action="k.satzPlus" data-seg="${seg.id}">+ Satz</button>`;
      } else {
        let e = seg.eintraege[0];
        if (!e) { e = neuerEintrag({}); seg.eintraege.push(e); }
        html += `<div class="satz cardio">${eintragInputsHtml(aktivitaet, seg, e)}</div>`;
      }

      html += `</div>`;
    }
    return html + `</div>`;
  }

  /** Felder eines Kraftsatzes: Gewicht (mit +/− bei assistiert), dann Wdh bzw. L/R. */
  function kraftFelderHtml(aktivitaet, seg, e) {
    const einst = effektiveEinstellungen(seg);
    const assistiert = !!einst.assist;
    const einarmig = !!einst.einarmig;
    const kg = e.messwerte.gewicht;

    // Gewicht: bei assistiert steht davor ein +/−-Umschalter.
    // Intern ist Hilfe negativ; im Feld zeigen wir den Betrag, das Vorzeichen macht der Toggle.
    const kgBetrag = kg == null ? '' : formatZahl(Math.abs(kg));
    let html = '';
    if (assistiert) {
      const neg = kg != null ? kg < 0 : !(e._plus ?? false);   // Default: Hilfe (−)
      html += `<button class="vz ${neg ? 'minus' : 'plus'}" data-action="k.vorzeichen"
        data-seg="${seg.id}" data-eintrag="${e.id}" title="Hilfe (−) oder Zusatzgewicht (+)">${neg ? '−' : '+'}</button>`;
    }
    html += `<label class="feld">
      <input type="text" inputmode="decimal" value="${escT(kgBetrag)}" placeholder="kg"
        data-change="k.wert" data-seg="${seg.id}" data-eintrag="${e.id}" data-typ="gewicht">
      <span>kg</span></label>
      <span class="mal">×</span>`;

    if (einarmig) {
      const l = e.messwerte.wdh_l, r = e.messwerte.wdh_r;
      html += `<label class="feld schmal">
        <input type="text" inputmode="numeric" value="${l != null ? formatZahl(l, 0) : ''}" placeholder="L"
          data-change="k.wert" data-seg="${seg.id}" data-eintrag="${e.id}" data-typ="wdh_l">
        <span>L</span></label>
        <span class="mal">/</span>
        <label class="feld schmal">
        <input type="text" inputmode="numeric" value="${r != null ? formatZahl(r, 0) : ''}" placeholder="R"
          data-change="k.wert" data-seg="${seg.id}" data-eintrag="${e.id}" data-typ="wdh_r">
        <span>R</span></label>`;
    } else {
      const w = e.messwerte.wdh;
      html += `<label class="feld">
        <input type="text" inputmode="numeric" value="${w != null ? formatZahl(w, 0) : ''}" placeholder="Wdh"
          data-change="k.wert" data-seg="${seg.id}" data-eintrag="${e.id}" data-typ="wdh">
        <span>Wdh</span></label>`;
    }
    return html;
  }

  function satzZeileHtml(session, seg, aktivitaet, eintrag, idx) {
    const warm = hatFlag(eintrag, 'aufwaermsatz');
    const pr = eintragPR(S(), identVon(seg), eintrag, session.datum);
    return `<div class="satz ${warm ? 'warm' : ''}">
      <button class="satz-nr ${warm ? 'warm' : ''}" data-action="k.warmup" data-seg="${seg.id}" data-eintrag="${eintrag.id}" title="Aufwärmsatz umschalten">${warm ? 'A' : idx + 1}</button>
      ${kraftFelderHtml(aktivitaet, seg, eintrag)}
      ${pr ? `<span class="pr">🎉${pr === 'wdh' ? ' Wdh' : ''}</span>` : ''}
      <button class="weg" data-action="k.satzWeg" data-seg="${seg.id}" data-eintrag="${eintrag.id}">✕</button>
    </div>`;
  }

  // ----------------------------------------------------------
  // PLAN-TAB
  // ----------------------------------------------------------

  function planHtml() {
    const plan = planFuer(S(), MODUL);
    const zyklus = zyklusEinheiten(S(), MODUL);
    const bib = einheitenBibliothek(S(), MODUL);
    // Aktuelle Position dynamisch berechnen (spiegelt in plan.position).
    aktuelleEinheit(S(), MODUL);
    const pos = plan?.position ?? 0;

    // Ist die heutige Einheit schon abgeschlossen?
    const heuteSession = heutigeSession();
    const heuteErledigt = heuteSession?.abgeschlossen === true;

    let html = `<div class="tab-kopf anim"><span class="eyebrow"><span class="pip"></span>Kraft</span><h1>Plan</h1></div>`;

    // ---- ZYKLUS (Ablauf) ----
    html += `<p class="sheet-abschnitt zwischen">Zyklus · Ablauf</p>`;
    if (!zyklus.length) {
      html += `<div class="karte leer anim"><p>Noch kein Ablauf. Leg unten Einheiten an und füg sie hier zum Zyklus hinzu — dieselbe Einheit darf mehrfach vorkommen.</p></div>`;
    } else {
      html += `<div class="karte zyklus-karte anim">` + zyklus.map((e, i) => `
        <div class="zyklus-zeile ${i === pos ? 'aktuell' : ''}">
          <span class="tag-nr">${i + 1}</span>
          <span class="name">${esc(e.name)}${i === pos ? (heuteErledigt ? ' <span class="dim">· heute ✓</span>' : ' <span class="dim">· heute</span>') : ''}</span>
          <span class="werkzeuge">
            <button data-action="k.zyklusSchieb" data-i="${i}" data-r="-1"><span class="pfeil-ico"></span></button>
            <button data-action="k.zyklusSchieb" data-i="${i}" data-r="1"><span class="pfeil-ico runter"></span></button>
            <button data-action="k.zyklusWeg" data-i="${i}">✕</button>
          </span>
        </div>`).join('') + `</div>`;
      // Hinweis: heute erledigt → nächster Tag startet morgen (Zeiger springt nicht vor)
      if (heuteErledigt) {
        html += `<p class="dim klein-text plan-hinweis">Heute erledigt ✓ — der nächste Zyklustag startet morgen.</p>`;
      }
      html += `<div class="knopf-zeile"><button class="knopf" data-action="k.zyklusPlus">+ Einheit in den Zyklus</button>
        <button class="knopf geist" data-action="k.heuteWaehlen">Heute korrigieren</button></div>`;
    }

    // ---- EINHEITEN-BIBLIOTHEK ----
    html += `<p class="sheet-abschnitt zwischen">Einheiten · Bibliothek</p>`;
    html += `<p class="dim klein-text bib-hinweis">Jede Einheit gibt es einmal. Änderst du hier ihre Übungen, wirkt das an allen Stellen im Zyklus — und in jedem anderen Plan, der sie nutzt.</p>`;
    if (!bib.length) {
      html += `<div class="karte leer anim"><p>Noch keine Einheiten — z.B. „Rücken · Bizeps" oder „Active Rest".</p></div>`;
    } else {
      html += bib.map(e => bibEinheitHtml(e)).join('');
    }
    html += `<button class="knopf primaer voll" data-action="k.einheitPlus">+ Einheit anlegen</button>`;
    return html;
  }

  function bibEinheitHtml(einheit) {
    const auf = planOffen.has(einheit.id);
    const imZyklus = (planFuer(S(), MODUL)?.zyklus ?? []).filter(id => id === einheit.id).length;
    let html = `<div class="karte plan-einheit anim">
      <div class="seg-kopf">
        <button class="seg-titel" data-action="k.planAuf" data-einheit="${einheit.id}">
          <strong>${esc(einheit.name)}</strong>
          <small class="dim">${einheit.segmente.length} Übungen${imZyklus ? ` · ${imZyklus}× im Zyklus` : ' · nicht im Zyklus'}</small>
        </button>
        <span class="werkzeuge">
          <button data-action="k.einheitName" data-einheit="${einheit.id}">✎</button>
          <button data-action="k.einheitWeg" data-einheit="${einheit.id}">✕</button>
        </span>
      </div>`;
    if (auf) {
      html += `<div class="seg-inhalt">`;
      html += einheit.segmente.map((v, i) => {
        const akt = findeAktivitaet(S(), v.aktivitaetId);
        if (!akt) return '';
        return `<div class="plan-zeile">
          <span class="punkt ${akt.kategorie}"></span>
          <span class="name">${esc(akt.name)}</span>
          <span class="werkzeuge">
            <button data-action="k.einstellungen" data-akt="${akt.id}">⚙️</button>
            <button data-action="k.planUebungSchieb" data-einheit="${einheit.id}" data-i="${i}" data-r="-1"><span class="pfeil-ico"></span></button>
            <button data-action="k.planUebungSchieb" data-einheit="${einheit.id}" data-i="${i}" data-r="1"><span class="pfeil-ico runter"></span></button>
            <button data-action="k.planUebungWeg" data-einheit="${einheit.id}" data-akt="${akt.id}">✕</button>
          </span>
        </div>`;
      }).join('');
      html += `<div class="knopf-zeile">
        <button class="knopf klein" data-action="k.planUebungPlus" data-einheit="${einheit.id}">+ Übung</button>
        <button class="knopf klein geist" data-action="k.zyklusPlusDirekt" data-einheit="${einheit.id}">In Zyklus einfügen</button>
      </div></div>`;
    }
    return html + `</div>`;
  }

  function heuteWaehlenHtml() {
    const zyklus = zyklusEinheiten(S(), MODUL);
    const pos = planFuer(S(), MODUL)?.position ?? 0;
    return `<h3>Welcher Tag ist heute dran?</h3>
      <p class="dim klein-text">Setzt den Zyklus auf diese Stelle — ab dort läuft er normal weiter.</p>
      <div class="picker-liste">${zyklus.map((e, i) =>
        `<button class="picker-zeile ${i === pos ? 'aktiv' : ''}" data-action="k.heuteSetzen" data-i="${i}">
          <span class="tag-nr">${i + 1}</span> ${esc(e.name)}${i === pos ? ' <span class="dim">· aktuell</span>' : ''}
        </button>`).join('')}
      </div>`;
  }

  /** Sheet: neue Einheit anlegen (konsistent zum Übungen-Sheet). */
  function einheitNeuHtml(suche = '') {
    const bib = einheitenBibliothek(S(), MODUL);
    const q = suche.trim().toLowerCase();
    const doppelt = q && bib.some(e => e.name.toLowerCase() === q);
    return `<h3>Neue Einheit</h3>
      <p class="dim klein-text">Name der Einheit — z.B. „Rücken · Bizeps" oder „Active Rest".</p>
      <input class="suche" type="text" placeholder="Name eingeben…" value="${esc(suche)}" data-change="k.einheitNeuSuche" autofocus>
      ${doppelt ? '<p class="dim klein-text">Gibt es schon — trotzdem anlegbar, wird eine zweite mit gleichem Namen.</p>' : ''}
      <button class="knopf primaer ${suche.trim() ? '' : 'aus'}" data-action="k.einheitNeuAnlegen">Anlegen</button>`;
  }

  /** Generisches Umbenennen-Sheet (statt prompt). typ steuert, was gespeichert wird. */
  let umbenennen = null;   // { typ:'einheit'|'altName'|'altNeu', id?, altId?, wert }
  function umbenennenHtml() {
    const { titel, wert, hinweis } = umbenennen;
    return `<h3>${esc(titel)}</h3>
      ${hinweis ? `<p class="dim klein-text">${esc(hinweis)}</p>` : ''}
      <input class="suche" type="text" placeholder="Name eingeben…" value="${esc(wert)}" data-change="k.umbennSuche" autofocus>
      <button class="knopf primaer ${wert.trim() ? '' : 'aus'}" data-action="k.umbennOk">Speichern</button>`;
  }

  /** Sheet: Einheit aus Bibliothek in den Zyklus wählen (oder neue anlegen). */
  function zyklusPickerHtml(suche = '') {
    const bib = einheitenBibliothek(S(), MODUL);
    const q = suche.trim().toLowerCase();
    const treffer = q ? bib.filter(e => e.name.toLowerCase().includes(q)) : bib;
    return `<h3>Einheit in den Zyklus</h3>
      <input class="suche" type="text" placeholder="Suchen oder neu benennen…" value="${esc(suche)}" data-change="k.zyklusSuche">
      <div class="picker-liste">${treffer.map(e =>
        `<button class="picker-zeile" data-action="k.zyklusWaehle" data-einheit="${e.id}"><span class="punkt kraft"></span>${esc(e.name)}</button>`).join('') || '<p class="dim">Keine Treffer.</p>'}
      </div>
      ${suche.trim() ? `<button class="knopf primaer" data-action="k.zyklusNeu">„${esc(suche.trim())}" neu anlegen & einfügen</button>` : ''}`;
  }



  function pickerHtml() {
    const q = picker.suche;
    const treffer = q ? sucheAktivitaet(S(), q)
      : [...aktivitaetenNachKategorie(S(), 'kraft'), ...aktivitaetenNachKategorie(S(), 'sonstiges')];
    return `<h3>Übung wählen</h3>
      <input class="suche" type="text" placeholder="Suchen oder neu benennen…" value="${esc(q)}" data-change="k.suche">
      <div class="picker-liste">${treffer.filter(a => !a.archiviert).map(a =>
        `<button class="picker-zeile" data-action="k.waehle" data-akt="${a.id}"><span class="punkt ${a.kategorie}"></span>${esc(a.name)}</button>`).join('') || '<p class="dim">Keine Treffer.</p>'}
      </div>
      ${q.trim() ? `<div class="knopf-zeile">
        <button class="knopf primaer" data-action="k.neu" data-kat="kraft">„${esc(q.trim())}" als Kraftübung anlegen</button>
        <button class="knopf" data-action="k.neu" data-kat="sonstiges">…als Cardio anlegen</button>
      </div>` : ''}`;
  }

  function einstellungenHtml(aktId, altId) {
    const akt = findeAktivitaet(S(), aktId);
    if (!akt) return '';
    const ziel = altId ? (akt.alternativen ?? []).find(a => a.id === altId) : akt;
    if (!ziel) return '';
    const prog = ziel.einstellungen?.prog ?? { art: 'off' };
    const chip = (art, label) =>
      `<button class="chip ${prog.art === art || (!prog.art && art === 'off') ? 'aktiv' : ''}" data-action="k.progArt" data-akt="${aktId}" ${altId ? `data-alt="${altId}"` : ''} data-art="${art}">${label}</button>`;
    const param = (name, label, wert) =>
      `<label class="feld breit"><input type="text" inputmode="decimal" value="${wert}" data-change="k.progParam" data-akt="${aktId}" ${altId ? `data-alt="${altId}"` : ''} data-param="${name}"><span>${label}</span></label>`;

    let html = `<h3>${esc(ziel.name)}</h3>`;

    // Umbenennen (nur Hauptübung; Alternative behält ihren eigenen Bearbeiten-Weg)
    if (!altId) {
      html += `<p class="sheet-abschnitt">Name</p>
        <div class="param-zeile">
          <label class="feld breit" style="flex:1">
            <input type="text" value="${esc(akt.name)}" data-change="k.aktName" data-akt="${aktId}">
          </label>
        </div>`;

      // Geräte-Notiz: session-übergreifend, immer sichtbar im Heute-Tab.
      // Für Techno-Gym & Co.: Sitzhöhe, Polster-Position, Pin-Einstellung…
      html += `<p class="sheet-abschnitt">Geräte-Notiz</p>
        <textarea class="notiz-feld" rows="2"
          placeholder="z.B. Sitz Stufe 4 · Polster 2. Loch · Pin auf 60"
          data-change="k.geraeteNotiz" data-akt="${aktId}">${esc(akt.notiz ?? '')}</textarea>
        <p class="dim klein-text">Bleibt dauerhaft an dieser Übung und erscheint beim Training.</p>`;

      // Messwerte an/abwählen — bei Kraft steuern die Flags (Einarmig) die Wdh-Form,
      // daher hier für Kraft nur die Cardio-Zusatzwerte anbieten.
      const auswahl = akt.kategorie === 'kraft'
        ? []
        : ['dauer', 'puls_avg', 'puls_max', 'distanz', 'hoehenmeter', 'kalorien'];
      const aktiv = akt.messwerte ?? [];
      if (auswahl.length) {
        html += `<p class="sheet-abschnitt">Messwerte beim Loggen</p>
          <div class="chip-zeile">${auswahl.map(typ => {
            const an = aktiv.includes(typ);
            return `<button class="chip ${an ? 'aktiv' : ''}" data-action="k.mwToggle" data-akt="${aktId}" data-typ="${typ}">${esc(MESSWERTE[typ].label)}</button>`;
          }).join('')}</div>`;
      }

      // Übungstyp (nur Kraft): einarmig / assistiert
      if (akt.kategorie === 'kraft') {
        const ein = !!ziel.einstellungen?.einarmig;
        const ass = !!ziel.einstellungen?.assist;
        html += `<p class="sheet-abschnitt">Übungstyp</p>
          <div class="chip-zeile">
            <button class="chip ${ein ? 'aktiv' : ''}" data-action="k.flagEinarmig" data-akt="${aktId}">Einarmig · L/R</button>
            <button class="chip ${ass ? 'aktiv' : ''}" data-action="k.flagAssist" data-akt="${aktId}">Assistiert · −/+</button>
          </div>
          ${ein ? '<p class="dim klein-text">Wdh werden für links und rechts getrennt erfasst. Gesteigert wird erst, wenn beide Seiten das Ziel schaffen.</p>' : ''}
          ${ass ? '<p class="dim klein-text">Gewicht als Hilfe (−) oder Zusatzgewicht (+). Weniger Hilfe = Fortschritt.</p>' : ''}`;
      }
    }

    if (akt.kategorie === 'kraft') {
      html += `<p class="sheet-abschnitt">Progression</p>
        <div class="chip-zeile">${chip('off', 'Aus')}${chip('double', 'Doppel-Prog.')}${chip('strength', 'Kraft')}${chip('technik', 'Technik/Reha')}</div>`;
      if (prog.art === 'double') {
        const p = { ...PROG_DEFAULTS.double, ...prog };
        html += `<div class="param-zeile">${param('saetze', 'Sätze', p.saetze)}${param('wdhMin', 'Wdh min', p.wdhMin)}${param('wdhMax', 'Wdh max', p.wdhMax)}${param('schritt', '+kg', p.schritt)}</div>`;
      }
      if (prog.art === 'strength') {
        const p = { ...PROG_DEFAULTS.strength, ...prog };
        html += `<div class="param-zeile">${param('saetze', 'Sätze', p.saetze)}${param('wdh', 'Wdh', p.wdh)}${param('schritt', '+kg', p.schritt)}</div>`;
      }
    }

    if (!altId) {
      html += `<p class="sheet-abschnitt">Alternativen</p>`;
      html += (akt.alternativen ?? []).map(a => `<div class="plan-zeile">
        <span class="name">${esc(a.name)}</span>
        <span class="werkzeuge">
          <button data-action="k.altName" data-akt="${aktId}" data-alt="${a.id}">✎</button>
          <button data-action="k.einstellungen" data-akt="${aktId}" data-alt="${a.id}">⚙️</button>
          <button data-action="k.altWeg" data-akt="${aktId}" data-alt="${a.id}">✕</button>
        </span>
      </div>`).join('') || '<p class="dim">Noch keine.</p>';
      html += `<button class="knopf klein" data-action="k.altPlus" data-akt="${aktId}">+ Alternative</button>`;

      // Übung löschen / archivieren
      const genutzt = wirdVerwendet(S(), aktId);
      html += `<p class="sheet-abschnitt">Übung entfernen</p>`;
      if (genutzt > 0) {
        html += `<p class="dim klein-text">Steckt in ${genutzt} Session(s). Löschen würde den Verlauf zerstören — stattdessen archivieren: verschwindet aus Auswahllisten, Verlauf bleibt.</p>
          <button class="knopf" data-action="k.aktArchiv" data-akt="${aktId}">Archivieren</button>`;
      } else {
        html += `<p class="dim klein-text">Noch in keiner Session — kann gefahrlos gelöscht werden.</p>
          <button class="knopf gefahr" data-action="k.aktWeg" data-akt="${aktId}">Übung löschen</button>`;
      }
    }
    return html;
  }

  // ----------------------------------------------------------
  // AKTIONEN
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // FORTSCHRITT (Charts pro Übung + Wochenvolumen)
  // ----------------------------------------------------------

  function fortschrittHtml() {
    let html = `<div class="tab-kopf anim"><span class="eyebrow"><span class="pip"></span>Kraft</span><h1>Fortschritt</h1></div>`;

    // Wochenvolumen (gesamt)
    const wv = wochenVolumen(S(), { wochen: 6 });
    if (wv.werte.length) {
      const t = trend(wv.werte, { einheit: 'kg', hoeherBesser: true });
      const labels = wv.wochen.map(w => 'KW' + w.slice(-2));
      html += `<div class="karte anim">
        <div class="prog-kopf">
          <div><small class="dim">Wochenvolumen</small>
            <div class="prog-jetzt">${formatZahl(wv.werte.at(-1), 0)} <small>kg</small></div></div>
          <span class="prog-trend ${t.richtung}">${esc(t.text)}</span>
        </div>
        ${balken(wv.werte, { farbe: '#CDFD34', labels, breite: 320, hoehe: 92 })}
      </div>`;
    }

    // Metrik-Umschalter (3 Metriken)
    html += `<div class="chip-zeile" style="margin:16px 2px 4px">
      <button class="chip ${progMetrik === 'gewicht' ? 'aktiv' : ''}" data-action="k.progMetrik" data-m="gewicht">Top-Gewicht</button>
      <button class="chip ${progMetrik === 'avg' ? 'aktiv' : ''}" data-action="k.progMetrik" data-m="avg">Ø-Gewicht</button>
      <button class="chip ${progMetrik === 'volumen' ? 'aktiv' : ''}" data-action="k.progMetrik" data-m="volumen">Volumen</button>
    </div>`;

    // Wert + Anzeigetext je nach gewählter Metrik
    const wertVon = p => progMetrik === 'volumen' ? p.vol : progMetrik === 'avg' ? p.avgKg : p.topKg;
    const textVon = p => {
      if (progMetrik === 'volumen') return `${formatZahl(p.vol, 0)} kg`;
      if (progMetrik === 'avg') return `${formatZahl(p.avgKg)} kg`;
      return `${formatZahl(p.topKg)} kg${p.wdhBeiTop != null ? ` × ${formatZahl(p.wdhBeiTop, 0)}` : ''}`;
    };

    // Eine Übungskarte bauen (oder '' wenn keine Historie).
    const karteFuer = akt => {
      const serie = fortschrittsSerie(S(), akt.id, { limit: 999 });
      if (serie.length === 0) return '';
      const assistiert = !!akt.einstellungen?.assist;
      const werte = serie.map(wertVon);
      const letzterP = serie.at(-1);
      const t = trend(werte, { einheit: 'kg', hoeherBesser: true });
      const mitRauf = serie.map((p, idx) => ({ ...p, rauf: idx > 0 && wertVon(p) > wertVon(serie[idx - 1]) }));
      const rueck = [...mitRauf].reverse();
      const offen = progExpand.has(akt.id);
      const sichtbar = offen ? rueck : rueck.slice(0, 5);
      const zeilen = sichtbar.map(p => `<div class="verlauf-zeile2">
          <span class="dim datum">${esc(formatDatum(p.datum))}</span>
          <span class="wert ${p.rauf ? 'rauf' : ''}">${esc(textVon(p))}${p.rauf ? ' ↑' : ''}</span>
          <span class="dim saetze">${esc(p.saetze.join(', '))}</span>
        </div>`).join('');
      const mehr = rueck.length > 5
        ? `<button class="knopf klein geist voll" data-action="k.progExpand" data-akt="${akt.id}">${offen ? 'Weniger anzeigen ⌃' : `Alle ${rueck.length} anzeigen ⌄`}</button>`
        : '';
      return `<div class="karte prog-karte anim">
        <div class="prog-kopf">
          <div><strong>${esc(akt.name)}</strong>${assistiert ? ' <span class="dim">· assistiert</span>' : ''}
            <div class="prog-jetzt">${esc(textVon(letzterP))}</div></div>
          <span class="prog-trend ${t.richtung}">${serie.length > 1 ? esc(t.text) : 'erste Session'}</span>
        </div>
        ${sparkline(werte, { farbe: '#CDFD34', breite: 320, hoehe: 60 })}
        <div class="verlauf-liste2">${zeilen}</div>
        ${mehr}
      </div>`;
    };

    // Nach Einheiten gruppieren: jede Übung erscheint unter ihrer ersten Einheit.
    // Gruppen sind aufklappbar; die HEUTE fällige Einheit ist standardmäßig offen.
    const einheiten = einheitenBibliothek(S(), MODUL);
    const heute = naechsteEinheit(S(), MODUL);
    const schonGezeigt = new Set();

    // Ist die Gruppe offen? Heute-Einheit offen, außer manuell zugeklappt;
    // andere zu, außer manuell aufgeklappt.
    const gruppeOffen = (eid) => eid === heute?.id
      ? !progGruppeZu.has(eid)
      : progGruppeAuf.has(eid);

    const gruppeHtml = (id, titel, kartenInner, anzahl) => {
      const offen = gruppeOffen(id);
      const heuteMark = id === heute?.id ? ' <span class="dim">· heute</span>' : '';
      return `<button class="prog-gruppe ${offen ? 'auf' : ''}" data-action="k.progGruppe" data-eid="${esc(id)}">
          <span class="gruppe-titel2">${esc(titel)}${heuteMark}</span>
          <span class="gruppe-meta">${anzahl} <span class="pfeil">${offen ? '⌃' : '⌄'}</span></span>
        </button>${offen ? `<div class="gruppe-inhalt">${kartenInner}</div>` : ''}`;
    };

    let gruppen = '';
    for (const einheit of einheiten) {
      let kartenInGruppe = '', n = 0;
      for (const vorlage of einheit.segmente) {
        const akt = findeAktivitaet(S(), vorlage.aktivitaetId);
        if (!akt || akt.kategorie !== 'kraft' || schonGezeigt.has(akt.id)) continue;
        const karte = karteFuer(akt);
        if (karte) { kartenInGruppe += karte; schonGezeigt.add(akt.id); n++; }
      }
      if (kartenInGruppe) gruppen += gruppeHtml(einheit.id, einheit.name, kartenInGruppe, n);
    }

    // Übungen ohne Einheit → „Weitere" (immer aufklappbar, nie automatisch offen)
    let weitere = '', wn = 0;
    for (const akt of S().bibliothek) {
      if (akt.kategorie !== 'kraft' || schonGezeigt.has(akt.id)) continue;
      const karte = karteFuer(akt);
      if (karte) { weitere += karte; schonGezeigt.add(akt.id); wn++; }
    }
    if (weitere) gruppen += gruppeHtml('__weitere__', 'Weitere', weitere, wn);

    html += gruppen || `<div class="karte leer anim"><p>Noch keine abgeschlossenen Kraft-Sessions. Sobald du Übungen abhakst, erscheint hier dein Verlauf.</p></div>`;
    return html;
  }

  const segFinden = id => heutigeSession()?.segmente.find(s => s.id === id) ?? null;

  async function speichernUndZeigen() { await ctx.save(); ctx.render(); }

  /**
   * Macht ein frisches Segment startklar, damit sofort Felder da sind:
   *  - Kraft: ein erster Satz, mit Gewicht+Wdh aus der letzten Session
   *    vorbefüllt (oder leer beim allerersten Mal).
   *  - Cardio/Sonstiges: ein leerer Eintrag → Eingabefelder sofort sichtbar.
   * Passiert nur, wenn das Segment noch gar keine Einträge hat.
   */
  function bereiteSegmentVor(session, seg) {
    if (seg.eintraege.length) return;
    const { aktivitaet } = loeseSegmentAuf(S(), seg);
    if (!aktivitaet) return;
    if (aktivitaet.kategorie === 'kraft') {
      const pf = prefillEintrag(S(), identVon(seg), session.datum);
      addEintrag(seg, pf ?? neuerEintrag({}));
    } else {
      addEintrag(seg, neuerEintrag({}));
    }
  }

  const actions = {
    async 'k.start'(d) {
      const s = sessionAusEinheit(S(), MODUL, d.einheit);
      s.modul = MODUL;
      S().sessions.push(s);
      s.segmente.forEach(seg => { offen.add(seg.id); bereiteSegmentVor(s, seg); });
      await speichernUndZeigen();
    },
    async 'k.ueberspringen'() {
      const naechste = naechsteEinheit(S(), MODUL);
      const name = naechste?.name ?? 'Einheit';
      const antwort = await bestaetige({
        titel: 'Tag überspringen?',
        text: `„${name}" wird übersprungen und der Zyklus rückt eine Position weiter.`,
        jaText: 'Überspringen',
        schalter: { label: 'Im Verlauf vermerken', an: false },
      });
      if (!antwort.ok) return;
      // Neue Logik: Überspringen legt IMMER eine uebersprungen-Session für heute
      // an. Die dynamische Positionsberechnung rückt dadurch weiter (auch für
      // heute). Der Schalter steuert nur, ob der Tag im Verlauf sichtbar wird.
      const s = neueSession(); s.modul = MODUL;
      s.uebersprungen = true;
      s.ausPlan = naechste?.id ?? null;
      s.uebersprungenName = name;
      s.imVerlauf = antwort.schalter === true;   // Sichtbarkeit im Verlauf
      S().sessions.push(s);
      await speichernUndZeigen();
    },
    async 'k.frei'() {
      const s = neueSession(); s.modul = MODUL;
      S().sessions.push(s);
      await speichernUndZeigen();
    },
    async 'k.sessionNotiz'(d, el) {
      const s = heutigeSession(); if (!s) return;
      s.notiz = el.value;
      await ctx.save();   // kein Re-Render → Cursor/Fokus im Textfeld bleibt
    },
    async 'k.teilen'(d) {
      // Session finden: aus Heute oder per Datum aus dem Verlauf
      const s = d.datum
        ? S().sessions.find(x => x.id === d.sid)
        : heutigeSession();
      if (!s) return;
      const einheit = s.ausPlan ? findeEinheit(S(), MODUL, s.ausPlan) : null;
      const zeilen = [];
      for (const seg of s.segmente) {
        if (seg.erledigt !== true) continue;
        const { aktivitaet, anzeigeName } = loeseSegmentAuf(S(), seg);
        if (!aktivitaet) continue;
        const detail = aktivitaet.kategorie === 'kraft'
          ? seg.eintraege.map(fmtSatz).join(', ')
          : segmentZusammenfassungWerte(aktivitaet, seg);
        zeilen.push({ name: anzeigeName, detail });
      }
      const highlightRoh = sessionHighlights(S(), s);
      const hl = highlightRoh.map(h => ({
        name: h.name, text: h.text, pr: h.art.startsWith('pr'),
      }));

      // Tagesrückblick: gebündelte Kennzahlen der Session.
      const prAnzahl = highlightRoh.filter(h => h.art.startsWith('pr')).length;
      const verbessert = highlightRoh.filter(h => !h.art.startsWith('pr')).length;
      let cardioMin = 0, kraftSaetze = 0;
      for (const seg of s.segmente) {
        if (seg.erledigt !== true) continue;
        const { aktivitaet } = loeseSegmentAuf(S(), seg);
        if (!aktivitaet) continue;
        if (aktivitaet.cardio || aktivitaet.kategorie !== 'kraft') {
          for (const e of seg.eintraege) {
            const sek = e.messwerte?.dauer ?? 0;
            cardioMin += Math.round(sek / 60);
          }
        } else {
          kraftSaetze += seg.eintraege.length;
        }
      }
      const rueckblick = [];
      if (prAnzahl > 0) rueckblick.push({ icon: '🏆', text: `${prAnzahl} neue${prAnzahl === 1 ? 's' : ''} Top-Gewicht${prAnzahl === 1 ? '' : 'e'}` });
      if (verbessert > 0) rueckblick.push({ icon: '💪', text: `${verbessert} Übung${verbessert === 1 ? '' : 'en'} verbessert` });
      if (kraftSaetze > 0) rueckblick.push({ icon: '🏋️', text: `${kraftSaetze} Sätze` });
      if (cardioMin > 0) rueckblick.push({ icon: '🔥', text: `${cardioMin} Min Cardio` });

      const daten = {
        titel: einheit ? einheit.name : 'Training',
        datum: formatDatum(s.datum),
        volumenText: `${formatZahl(sessionVolumenErledigt(s), 0)} kg`,
        zeilen,
        highlights: hl,
        rueckblick,
        notiz: (s.notiz ?? '').trim() || null,
      };
      try {
        const res = await teileKarte(daten, `all-in-one-${s.datum}.png`);
        if (res === 'heruntergeladen') await hinweis('Bild gespeichert ✓');
      } catch (err) {
        await hinweis('Teilen nicht möglich', err.message);
      }
    },
    async 'k.abschliessen'() {
      const s = heutigeSession(); if (!s) return;
      s.abgeschlossen = true;
      // Neue Zyklus-Logik: Abschließen markiert den Tag nur als erledigt.
      // Der Zeiger wird NICHT mehr sofort gerückt — die Position wird
      // dynamisch berechnet und springt erst zum nächsten Kalendertag.
      // So zeigen Heute- und Plan-Tab am selben Tag immer denselben Tag.
      await speichernUndZeigen();
    },
    async 'k.wiederOeffnen'() {
      const s = heutigeSession(); if (!s) return;
      s.abgeschlossen = false;
      await speichernUndZeigen();
    },

    'k.progMetrik'(d) { progMetrik = d.m; ctx.render(); },
    'k.progExpand'(d) { progExpand.has(d.akt) ? progExpand.delete(d.akt) : progExpand.add(d.akt); ctx.render(); },
    'k.progGruppe'(d) {
      const eid = d.eid;
      const heute = naechsteEinheit(S(), MODUL);
      const istHeute = eid === heute?.id;
      // aktuellen Offen-Zustand ermitteln und kippen
      const offen = istHeute ? !progGruppeZu.has(eid) : progGruppeAuf.has(eid);
      if (offen) {  // → zuklappen
        if (istHeute) progGruppeZu.add(eid); else progGruppeAuf.delete(eid);
      } else {      // → aufklappen
        if (istHeute) progGruppeZu.delete(eid); else progGruppeAuf.add(eid);
      }
      ctx.render();
    },

    'k.auf'(d) {
      const seg = segFinden(d.seg); if (!seg) { ctx.render(); return; }
      if (seg.erledigt) {                         // erledigt: offen-Set steuert das Aufklappen
        offen.has(d.seg) ? offen.delete(d.seg) : offen.add(d.seg);
      } else {                                    // nicht erledigt: zu-Set steuert das Zuklappen
        zu.has(d.seg) ? zu.delete(d.seg) : zu.add(d.seg);
      }
      ctx.render();
    },
    'k.verlauf'(d) { verlaufOffen.has(d.seg) ? verlaufOffen.delete(d.seg) : verlaufOffen.add(d.seg); ctx.render(); },
    'k.altListe'(d) { altOffen.has(d.seg) ? altOffen.delete(d.seg) : altOffen.add(d.seg); ctx.render(); },

    async 'k.check'(d) {
      const seg = segFinden(d.seg); if (!seg) return;
      if (!seg.erledigt) {
        // Beim Abhaken: falls noch leer, ersten Satz aus letzter Session übernehmen
        const { aktivitaet } = loeseSegmentAuf(S(), seg);
        if (aktivitaet?.kategorie === 'kraft' && !seg.eintraege.length) {
          const pf = prefillEintrag(S(), identVon(seg));
          if (pf) addEintrag(seg, pf);
        }
        seg.erledigt = true;
        offen.delete(seg.id); zu.delete(seg.id);   // abgehakt → zu (Übersteuerungen zurücksetzen)
      } else {
        seg.erledigt = false;
        offen.delete(seg.id); zu.delete(seg.id);   // wieder offen → Übersteuerungen zurücksetzen
      }
      await speichernUndZeigen();
    },

    async 'k.satzPlus'(d) {
      const seg = segFinden(d.seg); if (!seg) return;
      const letzter = seg.eintraege.at(-1);
      const mw = {};
      if (letzter && !hatFlag(letzter, 'aufwaermsatz')) Object.assign(mw, letzter.messwerte);
      addEintrag(seg, neuerEintrag(mw));
      offen.add(seg.id);
      await speichernUndZeigen();
    },
    async 'k.satzWeg'(d) {
      const seg = segFinden(d.seg); if (!seg) return;
      seg.eintraege = seg.eintraege.filter(e => e.id !== d.eintrag);
      await speichernUndZeigen();
    },
    async 'k.warmup'(d) {
      const seg = segFinden(d.seg);
      const e = seg?.eintraege.find(x => x.id === d.eintrag); if (!e) return;
      e.flags = hatFlag(e, 'aufwaermsatz') ? e.flags.filter(f => f !== 'aufwaermsatz') : [...e.flags, 'aufwaermsatz'];
      await speichernUndZeigen();
    },
    async 'k.wert'(d, el) {
      const seg = segFinden(d.seg);
      const e = seg?.eintraege.find(x => x.id === d.eintrag); if (!e) return;
      const def = MESSWERTE[d.typ];
      const { aktivitaet } = loeseSegmentAuf(S(), seg);
      let wert;
      if (def.anzeige === 'zeit') wert = parseDauer(el.value);
      else if (def.anzeige === 'distanz') wert = distanzZuMeter(el.value, aktivitaet?.kategorie);
      else wert = parseZahl(el.value);
      if (wert == null) { delete e.messwerte[d.typ]; }
      else {
        if (d.typ === 'gewicht' && effektiveEinstellungen(seg).assist) {
          const plus = e.messwerte.gewicht != null ? e.messwerte.gewicht >= 0 : (e._plus ?? false);
          wert = plus ? Math.abs(wert) : -Math.abs(wert);
          delete e._plus;
        }
        e.messwerte[d.typ] = wert;
      }
      // WICHTIG: nur speichern, NICHT neu rendern. Sonst wird das Eingabefeld neu
      // erzeugt, der Tastatur-Fokus geht verloren und der „Weiter"-Button springt
      // ins Leere. Volumen/PR/Progression aktualisieren sich beim nächsten Render
      // (Feld verlassen → Karte auf/zu, Abschließen, Tab-Wechsel). Nur die
      // Volumen-Anzeige oben frischen wir direkt und schonend auf.
      await ctx.save();
      aktualisiereVolumenAnzeige();
    },
    async 'k.vorzeichen'(d) {
      const seg = segFinden(d.seg);
      const e = seg?.eintraege.find(x => x.id === d.eintrag); if (!e) return;
      const kg = e.messwerte.gewicht;
      if (typeof kg === 'number' && kg !== 0) {
        e.messwerte.gewicht = -kg;               // Wert da → einfach spiegeln
        delete e._plus;
      } else {
        e._plus = !(e._plus ?? false);           // noch kein Wert → Absicht merken
      }
      await speichernUndZeigen();
    },
    async 'k.altWahl'(d) {
      const seg = segFinden(d.seg); if (!seg) return;
      seg.altOf = d.alt || null;
      altOffen.delete(d.seg);
      await speichernUndZeigen();
    },

    // ---- Picker ----
    'k.uebungPlus'() { picker = { ziel: 'session', suche: '' }; sheet.oeffne(pickerHtml()); },
    'k.planUebungPlus'(d) { picker = { ziel: 'einheit', einheitId: d.einheit, suche: '' }; sheet.oeffne(pickerHtml()); },
    'k.suche'(d, el) { picker.suche = el.value; sheet.aktualisiere(pickerHtml()); },
    async 'k.waehle'(d) {
      if (!picker) return;
      if (picker.ziel === 'einheit') {
        addAktivitaetZuEinheit(S(), MODUL, picker.einheitId, d.akt);
        planOffen.add(picker.einheitId);
      } else {
        const s = heutigeSession(); if (!s) return;
        const seg = addSegment(s, neuesSegment(d.akt));
        offen.add(seg.id);
        bereiteSegmentVor(s, seg);   // sofort Felder da (Kraft vorbefüllt, Cardio leer)
      }
      picker = null; sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'k.neu'(d) {
      if (!picker?.suche.trim()) return;
      const akt = addAktivitaet(S(), {
        name: picker.suche, kategorie: d.kat, messwerte: vorschlagMesswerte(d.kat),
      });
      await actions['k.waehle']({ akt: akt.id });
    },

    // ---- Plan: Bibliothek ----
    'k.planAuf'(d) { planOffen.has(d.einheit) ? planOffen.delete(d.einheit) : planOffen.add(d.einheit); ctx.render(); },
    'k.einheitPlus'() { picker = { ziel: 'einheit-neu', suche: '' }; sheet.oeffne(einheitNeuHtml('')); },
    'k.einheitNeuSuche'(d, el) { sheet.aktualisiere(einheitNeuHtml(el.value)); },
    async 'k.einheitNeuAnlegen'(d, el) {
      const feld = document.querySelector('[data-change="k.einheitNeuSuche"]');
      const name = (feld?.value ?? '').trim();
      if (!name) return;
      const e = addEinheit(S(), MODUL, { name });
      planOffen.add(e.id);
      sheet.schliesse();
      await speichernUndZeigen();
    },
    'k.einheitName'(d) {
      const e = findeEinheit(S(), MODUL, d.einheit);
      umbenennen = { typ: 'einheit', id: d.einheit, titel: 'Einheit umbenennen', wert: e?.name ?? '' };
      sheet.oeffne(umbenennenHtml());
    },
    'k.umbennSuche'(d, el) { if (umbenennen) { umbenennen.wert = el.value; sheet.aktualisiere(umbenennenHtml()); } },
    async 'k.umbennOk'() {
      if (!umbenennen) return;
      const name = umbenennen.wert.trim();
      if (!name) return;
      if (umbenennen.typ === 'einheit') {
        benenneEinheitUm(S(), MODUL, umbenennen.id, name);
      } else if (umbenennen.typ === 'altName') {
        const akt = findeAktivitaet(S(), umbenennen.id);
        const alt = akt?.alternativen.find(a => a.id === umbenennen.altId);
        if (alt) alt.name = name;
      } else if (umbenennen.typ === 'altNeu') {
        addAlternative(S(), umbenennen.id, { name });
      }
      const reopenAkt = (umbenennen.typ === 'altName' || umbenennen.typ === 'altNeu') ? umbenennen.id : null;
      umbenennen = null;
      sheet.schliesse();
      await ctx.save();
      if (reopenAkt) sheet.oeffne(einstellungenHtml(reopenAkt, null)); // zurück ins Übungs-Sheet
      ctx.render();
    },
    async 'k.einheitWeg'(d) {
      const e = findeEinheit(S(), MODUL, d.einheit);
      const imZyklus = (planFuer(S(), MODUL)?.zyklus ?? []).filter(id => id === d.einheit).length;
      const text = imZyklus
        ? `„${e?.name}" verschwindet ${imZyklus}× aus dem Zyklus. Deine Sessions bleiben erhalten.`
        : `„${e?.name}" wird gelöscht.`;
      if (!await bestaetige({ titel: 'Einheit löschen?', text, jaText: 'Löschen', gefahr: true })) return;
      loescheEinheit(S(), MODUL, d.einheit);
      await speichernUndZeigen();
    },
    async 'k.planUebungSchieb'(d) { verschiebeAktivitaetInEinheit(S(), MODUL, d.einheit, +d.i, +d.r); await speichernUndZeigen(); },
    async 'k.planUebungWeg'(d) { entferneAktivitaetAusEinheit(S(), MODUL, d.einheit, d.akt); await speichernUndZeigen(); },

    // ---- Plan: Zyklus (Ablauf) ----
    async 'k.zyklusSchieb'(d) { verschiebeImZyklus(S(), MODUL, +d.i, +d.r); await speichernUndZeigen(); },
    async 'k.zyklusWeg'(d) { entferneAusZyklus(S(), MODUL, +d.i); await speichernUndZeigen(); },
    async 'k.zyklusPlusDirekt'(d) { addZuZyklus(S(), MODUL, d.einheit); await speichernUndZeigen(); },
    'k.zyklusPlus'() { picker = { ziel: 'zyklus', suche: '' }; sheet.oeffne(zyklusPickerHtml()); },
    'k.zyklusSuche'(d, el) { picker.suche = el.value; sheet.aktualisiere(zyklusPickerHtml(el.value)); },
    async 'k.zyklusWaehle'(d) {
      addZuZyklus(S(), MODUL, d.einheit);
      picker = null; sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'k.zyklusNeu'() {
      const name = picker?.suche.trim();
      if (!name) return;
      const e = addEinheit(S(), MODUL, { name });
      addZuZyklus(S(), MODUL, e.id);
      planOffen.add(e.id);
      picker = null; sheet.schliesse();
      await speichernUndZeigen();
    },

    // ---- Heute korrigieren (Zyklus-Zeiger per Stelle setzen) ----
    'k.heuteWaehlen'() { sheet.oeffne(heuteWaehlenHtml()); },
    async 'k.heuteSetzen'(d) {
      const zielEinheit = zyklusEinheiten(S(), MODUL)[+d.i] ?? null;
      // Bestehende heutige Session behandeln, damit die neu gewählte Einheit
      // im Heute-Tab auch wirklich erscheint (nicht die alte „klebt").
      const s = heutigeSession();
      if (s) {
        const leer = !s.abgeschlossen && s.segmente.every(seg => !seg.erledigt && seg.eintraege.length === 0);
        const gleicheEinheit = zielEinheit && s.ausPlan === zielEinheit.id;
        if (leer) {
          S().sessions = S().sessions.filter(x => x !== s);   // leere immer verwerfen
        } else if (!gleicheEinheit) {
          // Session mit Daten/abgeschlossen, aber ANDERE Einheit → nachfragen
          const ok = await bestaetige({
            titel: 'Andere Einheit heute?',
            text: 'Für heute liegt schon eine andere Einheit vor. Verwerfen und neu starten? Bei Abbrechen bleibt sie im Verlauf.',
            jaText: 'Verwerfen', gefahr: true,
          });
          if (ok) {
            S().sessions = S().sessions.filter(x => x !== s);
          }
          // Bei „Abbrechen" bleibt sie erhalten; da sie abgeschlossen/befüllt ist,
          // zeigt der Heute-Tab sie weiter an — das ist dann bewusst so gewählt.
        }
      }
      setzeAnker(S(), MODUL, +d.i);
      sheet.schliesse();
      tabWechsel('heute');
      await speichernUndZeigen();
    },

    // ---- Einstellungen-Sheet ----
    'k.einstellungen'(d) { sheet.oeffne(einstellungenHtml(d.akt, d.alt || null)); },
    async 'k.aktName'(d, el) {
      const name = el.value.trim();
      if (!name) return;
      benenneUm(S(), d.akt, name);
      await ctx.save(); ctx.render(); // Sheet-Titel nicht neu bauen (Fokus im Feld halten)
    },
    async 'k.geraeteNotiz'(d, el) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      const t = el.value.trim();
      if (t) akt.notiz = t; else delete akt.notiz;
      await ctx.save(); ctx.render();   // Heute-Tab zeigt die Notiz dann sofort
    },
    async 'k.mwToggle'(d) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      const hat = akt.messwerte.includes(d.typ);
      // Mindestens ein Messwert muss bleiben
      if (hat && akt.messwerte.length <= 1) { await hinweis('Mindestens ein Messwert muss aktiv bleiben.'); return; }
      const neu = hat ? akt.messwerte.filter(t => t !== d.typ) : [...akt.messwerte, d.typ];
      setzeMesswerte(S(), d.akt, neu);
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.aktArchiv'(d) {
      const akt = findeAktivitaet(S(), d.akt);
      if (!await bestaetige({ titel: 'Übung archivieren?',
        text: `„${akt?.name}" verschwindet aus Auswahllisten, dein Verlauf bleibt erhalten.`,
        jaText: 'Archivieren' })) return;
      archiviere(S(), d.akt);
      sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'k.aktWeg'(d) {
      const akt = findeAktivitaet(S(), d.akt);
      if (!await bestaetige({ titel: 'Übung löschen?',
        text: `„${akt?.name}" wird endgültig gelöscht.`, jaText: 'Löschen', gefahr: true })) return;
      try {
        entferneAktivitaet(S(), d.akt);
        sheet.schliesse();
        await speichernUndZeigen();
      } catch (err) {
        await hinweis('Nicht möglich', err.message);
      }
    },
    async 'k.flagEinarmig'(d) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      akt.einstellungen ??= {};
      if (akt.einstellungen.einarmig) delete akt.einstellungen.einarmig;
      else akt.einstellungen.einarmig = true;
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.flagAssist'(d) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      akt.einstellungen ??= {};
      if (akt.einstellungen.assist) delete akt.einstellungen.assist;
      else akt.einstellungen.assist = true;
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.progArt'(d) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      const ziel = d.alt ? akt.alternativen.find(a => a.id === d.alt) : akt;
      ziel.einstellungen ??= {};
      if (d.art === 'off') delete ziel.einstellungen.prog;
      else ziel.einstellungen.prog = { art: d.art, ...PROG_DEFAULTS[d.art], ...(ziel.einstellungen.prog?.art === d.art ? ziel.einstellungen.prog : {}), art: d.art };
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, d.alt || null));
      ctx.render();
    },
    async 'k.progParam'(d, el) {
      const akt = findeAktivitaet(S(), d.akt);
      const ziel = d.alt ? akt?.alternativen.find(a => a.id === d.alt) : akt;
      const prog = ziel?.einstellungen?.prog; if (!prog) return;
      const n = parseZahl(el.value);
      if (n != null && n > 0) prog[d.param] = n;
      await ctx.save(); ctx.render();
    },
    'k.altPlus'(d) {
      umbenennen = { typ: 'altNeu', id: d.akt, titel: 'Neue Alternative',
        hinweis: 'Name der Ersatzübung — z.B. „KH-Bankdrücken".', wert: '' };
      sheet.oeffne(umbenennenHtml());
    },
    'k.altName'(d) {
      const akt = findeAktivitaet(S(), d.akt);
      const alt = akt?.alternativen.find(a => a.id === d.alt); if (!alt) return;
      umbenennen = { typ: 'altName', id: d.akt, altId: d.alt, titel: 'Alternative umbenennen', wert: alt.name };
      sheet.oeffne(umbenennenHtml());
    },
    async 'k.altWeg'(d) {
      if (!await bestaetige({ titel: 'Alternative löschen?', jaText: 'Löschen', gefahr: true })) return;
      try {
        entferneAlternative(S(), d.akt, d.alt);
        await ctx.save();
      } catch (err) {
        await hinweis('Nicht möglich', err.message); // steckt in Sessions → bleibt erhalten
      }
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
  };

  return { heuteHtml, planHtml, fortschrittHtml, actions };
}
