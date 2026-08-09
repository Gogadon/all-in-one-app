// ============================================================
// modules/kraft/logik.js — die Rechenregeln des Kraft-Trainings.
//
// Reine Funktionen über dem Zustand: Progression, persönliche Rekorde,
// Historie, Prefill, Zusammenfassungen, Wochenvolumen. Kein DOM, kein
// Oberflächen-Zustand — das Verhalten stammt 1:1 aus der alten Gym-App und
// ist der Teil, der sich am wenigsten ändern darf.
//
// Bewusst getrennt von der Darstellung: Diese Datei ist das, was in Node
// vollständig prüfbar ist, und sie soll auch dann noch stimmen, wenn die
// Oberfläche darüber umgebaut wird.
// ============================================================

import { formatWert, formatZahl } from '../../core/metrics.js';
import {
  heuteIso, neuerEintrag, hatFlag, loeseSegmentAuf,
} from '../../core/model.js';

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

/**
 * Sind alle Sätze eines Segments noch unberührte Vorschläge?
 * Nur dann darf ein Wechsel der Übung sie ersetzen — getippte Werte
 * gehören dem Nutzer und bleiben in jedem Fall stehen.
 */
export function nurVorschlaege(segment) {
  const eintraege = segment?.eintraege ?? [];
  return eintraege.length > 0 && eintraege.every(e => e.quelle === 'prefill');
}

/** Der Nutzer hat den Satz angefasst — ab jetzt ist er kein Vorschlag mehr. */
export function beruehrt(eintrag) {
  if (eintrag) eintrag.quelle = 'manuell';
}

/**
 * Die Kraft-Session eines Tages — null, wenn es keine gibt.
 * Übersprungene zählen nicht: die sind ja gerade das Gegenteil einer Einheit.
 */
export function kraftSessionAmTag(state, datum) {
  return (state.sessions ?? []).find(s =>
    s.datum === datum && (s.modul ?? 'kraft') === 'kraft' && !s.uebersprungen) ?? null;
}

/**
 * Darf für diesen Tag eine Kraft-Session angelegt werden?
 *
 * REGEL: höchstens EINE pro Kalendertag. Zwei volle Einheiten an einem Tag
 * (morgens Pull, abends Push) sind nichts, was der Körper leistet — und der
 * Zyklus rechnet ohnehin in Kalendertagen. Wer abends noch etwas nachträgt,
 * ergänzt die bestehende Einheit; sie bleibt den ganzen Tag bearbeitbar.
 *
 * Bewusst hier im Kern und nicht nur als ausgeblendeter Knopf: sonst kann
 * jede spätere UI-Änderung die Regel versehentlich aushebeln.
 */
export function kannKraftSessionStarten(state, datum) {
  return kraftSessionAmTag(state, datum) == null;
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
