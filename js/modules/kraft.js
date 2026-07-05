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
  zyklusEinheiten, addZuZyklus, entferneAusZyklus, verschiebeImZyklus, setzePosition,
  naechsteEinheit, schalteWeiter, sessionAusEinheit,
} from '../core/plan.js';

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

/** Bestwert vor einem Tag: höchstes Gewicht + Wdh bei diesem Gewicht. */
export function bestVorTag(state, identId, tagIso) {
  let maxKg = null, wdhBeiMax = null;
  for (const { segment } of segmenteVor(state, identId, tagIso)) {
    for (const e of segment.eintraege) {
      if (!istArbeitssatz(e)) continue;
      const kg = e.messwerte.gewicht, w = e.messwerte.wdh ?? null;
      if (maxKg == null || kg > maxKg) { maxKg = kg; wdhBeiMax = w; }
      else if (kg === maxKg && w != null && (wdhBeiMax == null || w > wdhBeiMax)) { wdhBeiMax = w; }
    }
  }
  return { maxKg, wdhBeiMax };
}

/** Neuer Rekord? → null | 'gewicht' | 'wdh'. Erste Session zählt nicht. */
export function eintragPR(state, identId, eintrag, tagIso = heuteIso()) {
  if (hatFlag(eintrag, 'aufwaermsatz')) return null;
  const kg = eintrag.messwerte.gewicht, w = eintrag.messwerte.wdh;
  if (typeof kg !== 'number' || typeof w !== 'number') return null;
  const { maxKg, wdhBeiMax } = bestVorTag(state, identId, tagIso);
  if (maxKg == null) return null;
  if (kg > maxKg) return 'gewicht';
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
      topSaetze.every(e => (e.messwerte.wdh ?? -1) >= p.wdhMax);
    if (fertig) {
      const next = Math.round((topKg + p.schritt) * 100) / 100;
      return { text: `↗ Auf ${formatZahl(next)} kg steigern · Ziel ${p.wdhMin}×${p.saetze}`, art: 'steigern', nextKg: next };
    }
    return { text: `${formatZahl(topKg)} kg halten · Ziel ${p.wdhMax} Wdh in allen Sätzen`, art: 'halten', zielWdh: p.wdhMax };
  }
  if (prog.art === 'strength') {
    const p = { ...PROG_DEFAULTS.strength, ...prog };
    const fertig = topSaetze.length >= p.saetze &&
      topSaetze.every(e => (e.messwerte.wdh ?? -1) >= p.wdh);
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
  if (e.messwerte.wdh != null) mw.wdh = e.messwerte.wdh;
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
  return session.segmente.filter(s => s.erledigt === true)
    .reduce((sum, s) => sum + segmentVolumen(s), 0);
}

/** Ein Satz als Kurztext: "80×8" (Aufwärmsätze mit A-Präfix). */
export function fmtSatz(e) {
  const kg = e.messwerte.gewicht, w = e.messwerte.wdh;
  const kern = `${kg != null ? formatZahl(kg) : '?'}×${w != null ? formatZahl(w, 0) : '?'}`;
  return hatFlag(e, 'aufwaermsatz') ? `A ${kern}` : kern;
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

/**
 * DER eine Eingabe-Renderer: baut für einen Eintrag die Felder aus
 * aktivitaet.messwerte + Registry. Wird für Kraftsätze UND
 * Cardio-Segmente benutzt — der Akzeptanztest hängt hieran.
 */
export function eintragInputsHtml(aktivitaet, segment, eintrag) {
  return aktivitaet.messwerte.map(typ => {
    const def = MESSWERTE[typ];
    const roh = eintrag.messwerte[typ];
    const wert = roh == null ? ''
      : (def.anzeige === 'zeit' ? dauerInputWert(roh) : formatZahl(roh, def.dezimal ?? 2));
    const platzhalter = def.anzeige === 'zeit' ? 'min' : (def.kurz ?? def.label);
    return `<label class="feld">
      <input type="text" inputmode="decimal" value="${escT(wert)}" placeholder="${escT(platzhalter)}"
        data-change="k.wert" data-seg="${segment.id}" data-eintrag="${eintrag.id}" data-typ="${typ}">
      <span>${escT(def.einheit && def.anzeige !== 'zeit' && def.anzeige !== 'distanz' ? def.einheit : def.anzeige === 'zeit' ? 'min' : def.kurz ?? def.label)}</span>
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
  const offen = new Set();          // aufgeklappte Segment-Karten
  const verlaufOffen = new Set();   // aufgeklappte Verläufe
  const altOffen = new Set();       // offene Alternativen-Umschalter
  const planOffen = new Set();      // aufgeklappte Plan-Einheiten
  let picker = null;                // { ziel:'session'|'einheit', einheitId?, suche:'' }

  const S = () => ctx.state;
  // Heutige Kraft-Sessions; eine noch OFFENE hat Vorrang (die bearbeitet man
  // gerade), sonst die zuletzt angelegte. So blockiert eine bereits
  // abgeschlossene Einheit nicht das Starten einer zweiten am selben Tag.
  const heutigeSessions = () =>
    S().sessions.filter(s => s.datum === heuteIso() && s.modul === MODUL);
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
      <div class="vol"><span class="num">${formatZahl(vol, 0)}</span><span class="dim">kg bewegt</span></div>
    </div>`;

    html += s.segmente.map(seg => segmentKarteHtml(s, seg)).join('');

    html += `<button class="knopf geist voll" data-action="k.uebungPlus">+ Übung hinzufügen</button>`;
    html += fertig
      ? `<div class="fertig-banner anim">
          <span>Einheit abgeschlossen ✓</span>
          <button class="knopf klein" data-action="k.wiederOeffnen">Wieder öffnen</button>
        </div>`
      : `<button class="knopf primaer gross voll" data-action="k.abschliessen">Einheit abschließen ✓</button>`;
    return html;
  }

  function segmentKarteHtml(session, seg) {
    const { aktivitaet, anzeigeName } = loeseSegmentAuf(S(), seg);
    if (!aktivitaet) return '';
    const istKraft = aktivitaet.kategorie === 'kraft';
    const auf = offen.has(seg.id);
    const check = seg.erledigt === true;
    const zsf = istKraft ? segmentZusammenfassungKraft(seg) : segmentZusammenfassungWerte(aktivitaet, seg);
    const punktKlasse = aktivitaet.kategorie === 'kraft' ? 'kraft' : aktivitaet.kategorie;

    let html = `<div class="karte segment ${check ? 'erledigt' : ''} anim">
      <div class="seg-kopf">
        <button class="check ${check ? 'an' : ''}" data-action="k.check" data-seg="${seg.id}" aria-label="abhaken"></button>
        <button class="seg-titel" data-action="k.auf" data-seg="${seg.id}">
          <strong><span class="punkt ${punktKlasse}"></span>${esc(anzeigeName)}</strong>
          <small class="dim">${esc(zsf)}</small>
        </button>
        <button class="zahn" data-action="k.einstellungen" data-akt="${aktivitaet.id}" ${seg.altOf ? `data-alt="${seg.altOf}"` : ''}>⚙️</button>
      </div>`;

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
        // Cardio/Sonstiges: genau ein Eintrag → Felder direkt anzeigen.
        let e = seg.eintraege[0];
        if (!e) { e = neuerEintrag({}); seg.eintraege.push(e); } // Altbestand absichern
        html += `<div class="satz cardio">${eintragInputsHtml(aktivitaet, seg, e)}</div>`;
      }

      html += `</div>`;
    }
    return html + `</div>`;
  }

  function satzZeileHtml(session, seg, aktivitaet, eintrag, idx) {
    const warm = hatFlag(eintrag, 'aufwaermsatz');
    const pr = eintragPR(S(), identVon(seg), eintrag, session.datum);
    return `<div class="satz ${warm ? 'warm' : ''}">
      <button class="satz-nr ${warm ? 'warm' : ''}" data-action="k.warmup" data-seg="${seg.id}" data-eintrag="${eintrag.id}" title="Aufwärmsatz umschalten">${warm ? 'A' : idx + 1}</button>
      ${eintragInputsHtml(aktivitaet, seg, eintrag)}
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
    const pos = plan?.position ?? 0;

    let html = `<div class="tab-kopf anim"><span class="eyebrow"><span class="pip"></span>Kraft</span><h1>Plan</h1></div>`;

    // ---- ZYKLUS (Ablauf) ----
    html += `<p class="sheet-abschnitt zwischen">Zyklus · Ablauf</p>`;
    if (!zyklus.length) {
      html += `<div class="karte leer anim"><p>Noch kein Ablauf. Leg unten Einheiten an und füg sie hier zum Zyklus hinzu — dieselbe Einheit darf mehrfach vorkommen.</p></div>`;
    } else {
      html += `<div class="karte zyklus-karte anim">` + zyklus.map((e, i) => `
        <div class="zyklus-zeile ${i === pos ? 'aktuell' : ''}">
          <span class="tag-nr">${i + 1}</span>
          <span class="name">${esc(e.name)}${i === pos ? ' <span class="dim">· heute</span>' : ''}</span>
          <span class="werkzeuge">
            <button data-action="k.zyklusSchieb" data-i="${i}" data-r="-1">▲</button>
            <button data-action="k.zyklusSchieb" data-i="${i}" data-r="1">▼</button>
            <button data-action="k.zyklusWeg" data-i="${i}">✕</button>
          </span>
        </div>`).join('') + `</div>`;
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
            <button data-action="k.planUebungSchieb" data-einheit="${einheit.id}" data-i="${i}" data-r="-1">▲</button>
            <button data-action="k.planUebungSchieb" data-einheit="${einheit.id}" data-i="${i}" data-r="1">▼</button>
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

      // Messwerte an/abwählen — genau die Felder, die beim Loggen erscheinen
      const auswahl = akt.kategorie === 'kraft'
        ? ['gewicht', 'wdh', 'dauer']
        : ['dauer', 'puls_avg', 'puls_max', 'distanz', 'hoehenmeter', 'kalorien'];
      const aktiv = akt.messwerte ?? [];
      html += `<p class="sheet-abschnitt">Messwerte beim Loggen</p>
        <div class="chip-zeile">${auswahl.map(typ => {
          const an = aktiv.includes(typ);
          return `<button class="chip ${an ? 'aktiv' : ''}" data-action="k.mwToggle" data-akt="${aktId}" data-typ="${typ}">${esc(MESSWERTE[typ].label)}</button>`;
        }).join('')}</div>`;
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
    async 'k.ueberspringen'() { schalteWeiter(S(), MODUL); await speichernUndZeigen(); },
    async 'k.frei'() {
      const s = neueSession(); s.modul = MODUL;
      S().sessions.push(s);
      await speichernUndZeigen();
    },
    async 'k.abschliessen'() {
      const s = heutigeSession(); if (!s) return;
      s.abgeschlossen = true;
      const naechste = naechsteEinheit(S(), MODUL);
      // Nur weiterschalten, wenn diese Einheit die aktuell fällige war —
      // und merken, dass wir es getan haben (für „Wieder öffnen").
      if (s.ausPlan && naechste && s.ausPlan === naechste.id) {
        schalteWeiter(S(), MODUL);
        s.hatWeitergeschaltet = true;
      }
      await speichernUndZeigen();
    },
    async 'k.wiederOeffnen'() {
      const s = heutigeSession(); if (!s) return;
      s.abgeschlossen = false;
      if (s.hatWeitergeschaltet) {           // Zyklus einen Schritt zurück
        const plan = planFuer(S(), MODUL);
        if (plan && plan.zyklus.length) {
          plan.position = (plan.position - 1 + plan.zyklus.length) % plan.zyklus.length;
        }
        delete s.hatWeitergeschaltet;
      }
      await speichernUndZeigen();
    },

    'k.auf'(d) { offen.has(d.seg) ? offen.delete(d.seg) : offen.add(d.seg); ctx.render(); },
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
        offen.delete(seg.id);       // abgehakt → Karte fährt zu (wie Gym-App)
      } else {
        seg.erledigt = false;
        offen.add(seg.id);          // wieder freigemacht → Karte öffnet sich
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
      const wert = def.anzeige === 'zeit' ? parseDauer(el.value) : parseZahl(el.value);
      if (wert == null) delete e.messwerte[d.typ]; else e.messwerte[d.typ] = wert;
      await ctx.save(); ctx.render();
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
    async 'k.einheitName'(d) {
      const e = findeEinheit(S(), MODUL, d.einheit);
      const name = prompt('Neuer Name:', e?.name ?? '');
      if (!name?.trim()) return;
      benenneEinheitUm(S(), MODUL, d.einheit, name);
      await speichernUndZeigen();
    },
    async 'k.einheitWeg'(d) {
      const e = findeEinheit(S(), MODUL, d.einheit);
      const imZyklus = (planFuer(S(), MODUL)?.zyklus ?? []).filter(id => id === d.einheit).length;
      const warnung = imZyklus
        ? `„${e?.name}" löschen? Verschwindet ${imZyklus}× aus dem Zyklus. (Sessions bleiben erhalten.)`
        : `„${e?.name}" löschen?`;
      if (!confirm(warnung)) return;
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
          const ok = confirm('Für heute liegt schon eine andere Einheit vor. Verwerfen und neu starten? (Abbrechen behält sie im Verlauf.)');
          if (ok) {
            S().sessions = S().sessions.filter(x => x !== s);
          }
          // Bei „Abbrechen" bleibt sie erhalten; da sie abgeschlossen/befüllt ist,
          // zeigt der Heute-Tab sie weiter an — das ist dann bewusst so gewählt.
        }
      }
      setzePosition(S(), MODUL, +d.i);
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
    async 'k.mwToggle'(d) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      const hat = akt.messwerte.includes(d.typ);
      // Mindestens ein Messwert muss bleiben
      if (hat && akt.messwerte.length <= 1) { alert('Mindestens ein Messwert muss aktiv bleiben.'); return; }
      const neu = hat ? akt.messwerte.filter(t => t !== d.typ) : [...akt.messwerte, d.typ];
      setzeMesswerte(S(), d.akt, neu);
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.aktArchiv'(d) {
      const akt = findeAktivitaet(S(), d.akt);
      if (!confirm(`„${akt?.name}" archivieren? Verschwindet aus Auswahllisten, Verlauf bleibt erhalten.`)) return;
      archiviere(S(), d.akt);
      sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'k.aktWeg'(d) {
      const akt = findeAktivitaet(S(), d.akt);
      if (!confirm(`„${akt?.name}" endgültig löschen?`)) return;
      try {
        entferneAktivitaet(S(), d.akt);
        sheet.schliesse();
        await speichernUndZeigen();
      } catch (err) {
        alert(err.message);
      }
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
    async 'k.altPlus'(d) {
      const name = prompt('Name der Alternative:');
      if (!name?.trim()) return;
      addAlternative(S(), d.akt, { name });
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.altName'(d) {
      const akt = findeAktivitaet(S(), d.akt);
      const alt = akt?.alternativen.find(a => a.id === d.alt); if (!alt) return;
      const name = prompt('Neuer Name:', alt.name);
      if (!name?.trim()) return;
      alt.name = name.trim();
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.altWeg'(d) {
      if (!confirm('Alternative löschen?')) return;
      try {
        entferneAlternative(S(), d.akt, d.alt);
        await ctx.save();
      } catch (err) {
        alert(err.message); // steckt in Sessions → bleibt erhalten
      }
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
  };

  return { heuteHtml, planHtml, actions };
}
