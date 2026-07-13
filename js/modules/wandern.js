// ============================================================
// wandern.js — das Wandern-Modul (dünnes Modul auf dickem Kern).
//
// Baugleich zum Rad-Modul: eine Wanderung ist eine Session mit genau
// EINEM Segment (die Wanderung), das genau EINEN Eintrag mit den
// Messwerten hat. Freie Wanderungen, kein Plan.
//
// Eigener Fokus ggü. Rad: Höhenmeter und Schritte statt Geschwindigkeit.
// Dauer wird als Std:Min gelesen (eine Wanderung dauert Stunden, nicht
// Minuten:Sekunden wie eine Radtour-Zeitmessung).
// ============================================================

import { MESSWERTE, formatWert, formatZahl, parseZahl } from '../core/metrics.js';
import {
  heuteIso, neueSession, neuesSegment, neuerEintrag,
  addSegment, addEintrag, findeAktivitaet,
  zeitraum, verschiebeZeitraum, sortiereNeuesteZuerst, istWertbareTour,
} from '../core/model.js';
import { zeitraumStatistik, zeitraumLabel } from '../core/statistik.js';
import { addAktivitaet } from '../core/library.js';
import { bestaetige, hinweis } from '../ui/components.js';
import { teileKarte } from '../ui/share.js';

export const MODUL = 'wandern';

// Standard-Messwerte einer Wanderung (schnell einzutragen).
const STANDARD_MESSWERTE = ['dauer', 'distanz', 'hoehenmeter', 'schritte', 'kalorien', 'puls_avg'];
// Optional dazuschaltbar (im ⚙️).
const OPTIONAL_MESSWERTE = ['puls_max'];

// ============================================================
// 1) REINE LOGIK (Node-testbar)
// ============================================================

/** Alle Wanderungen (Sessions dieses Moduls), neueste zuerst. */
export function alleWanderungen(state) {
  return sortiereNeuesteZuerst(
    state.sessions.filter(s => s.modul === MODUL && !s.uebersprungen));
}

/** Die eine Wander-Aktivität (wird bei Bedarf angelegt — „Wanderung"). */
export function wanderAktivitaet(state, { anlegen = true } = {}) {
  let akt = state.bibliothek.find(a => a.kategorie === MODUL);
  if (!akt && anlegen) {
    akt = addAktivitaet(state, {
      name: 'Wanderung', kategorie: MODUL,
      messwerte: [...STANDARD_MESSWERTE],
    });
  }
  return akt;
}

/** Messwerte-Werte eines Wander-Segments (der eine Eintrag). */
export function wanderWerte(session) {
  const seg = session.segmente[0];
  return seg?.eintraege[0]?.messwerte ?? {};
}

/** Summen/Kennzahlen über alle Wanderungen (für die Kopf-Statistik). */
export function wanderStatistik(state) {
  const touren = alleWanderungen(state).filter(istWertbareTour);
  let distanz = 0, dauer = 0, hoehen = 0;
  for (const s of touren) {
    const mw = wanderWerte(s);
    distanz += mw.distanz ?? 0;
    dauer += mw.dauer ?? 0;
    hoehen += mw.hoehenmeter ?? 0;
  }
  return { anzahl: touren.length, distanz, dauer, hoehen };
}

/**
 * Highlights einer Wanderung: persönlicher Rekord?
 * Vergleicht gegen alle ANDEREN abgeschlossenen Wanderungen.
 */
export function wanderHighlights(state, session) {
  const mw = wanderWerte(session);
  const andere = alleWanderungen(state).filter(t => t.id !== session.id && t.abgeschlossen);
  const hl = [];

  const rekord = (typ, label, format) => {
    const wert = mw[typ];
    if (wert == null || wert <= 0) return;
    const bisher = andere.map(t => wanderWerte(t)[typ] ?? 0);
    const best = bisher.length ? Math.max(...bisher) : 0;
    if (wert > best) hl.push({ name: label, text: format(wert), pr: true });
  };

  rekord('distanz', 'Längste Wanderung', v => formatZahl(v / 1000, 1) + ' km');
  rekord('hoehenmeter', 'Meiste Höhenmeter', v => formatZahl(v, 0) + ' hm');
  rekord('dauer', 'Längste Gehzeit', v => formatWert('dauer', v));
  rekord('schritte', 'Meiste Schritte', v => formatZahl(v, 0));

  return hl;
}

// ============================================================
// 2) MODUL-FABRIK
// ============================================================

export function erstelleWanderModul(ctx) {
  const S = () => ctx.state;
  const esc = ctx.esc;
  const tabWechsel = ctx.tabWechsel ?? (() => {});
  const formatDatum = ctx.formatDatum;

  let offeneTour = null;
  const detailOffen = new Set();

  // Statistik-Tab: aktueller Zeitraum (Default: laufender Monat).
  let statArt = 'monat';       // 'woche' | 'monat' | 'jahr'
  let statAnker = heuteIso();

  // Touren-Tab: ganze Liste aus- oder eingeklappt (Default: nur letzte 5).
  let alleTourenAuf = false;

  async function speichernUndZeigen() { await ctx.save(); ctx.render(); }

  function findeOffeneTour() {
    return S().sessions.find(s =>
      s.modul === MODUL && !s.abgeschlossen && !s.uebersprungen) ?? null;
  }

  function heuteHtml() {
    const offen = findeOffeneTour();
    if (offen) {
      offeneTour = offen.id;
      return tourHtml(offen);
    }
    return startHtml();
  }

  function startHtml() {
    const stat = wanderStatistik(S());
    let html = `<div class="tab-kopf anim">
      <span class="eyebrow"><span class="pip wandern"></span>Wandern</span>
      <h1>Wanderungen</h1>
    </div>`;

    if (stat.anzahl > 0) {
      html += `<div class="karte anim stat-karte">
        <div class="stat-3">
          <div><span class="stat-zahl">${stat.anzahl}</span><span class="dim">Touren</span></div>
          <div><span class="stat-zahl">${formatZahl(stat.distanz / 1000, 0)}</span><span class="dim">km gesamt</span></div>
          <div><span class="stat-zahl">${formatZahl(stat.hoehen, 0)}</span><span class="dim">Höhenmeter</span></div>
        </div>
      </div>`;
    }

    html += `<button class="knopf primaer gross voll" data-action="wandern.neu">+ Neue Wanderung eintragen</button>`;

    // Touren-Liste: standardmäßig die letzten 5, per „Alle anzeigen" ausklappbar.
    const alle = alleWanderungen(S());
    if (alle.length) {
      const touren = alleTourenAuf ? alle : alle.slice(0, 5);
      html += `<p class="sheet-abschnitt zwischen">${alleTourenAuf ? 'Alle Touren' : 'Zuletzt'}</p>`;
      html += touren.map(t => tourZeileHtml(t)).join('');
      if (alle.length > 5) {
        html += alleTourenAuf
          ? `<button class="knopf geist voll" data-action="wandern.alleTouren">Weniger anzeigen</button>`
          : `<button class="knopf geist voll" data-action="wandern.alleTouren">Alle anzeigen (${alle.length})</button>`;
      }
    } else {
      html += `<div class="karte leer anim"><p>Noch keine Wanderungen. Trag deine erste Tour ein — raus in die Natur, wann immer du Lust hast. 🥾</p></div>`;
    }
    return html;
  }

  function tourZeileHtml(t) {
    const mw = wanderWerte(t);
    const km = mw.distanz != null ? formatZahl(mw.distanz / 1000, 1) + ' km' : '';
    const hm = mw.hoehenmeter != null ? formatZahl(mw.hoehenmeter, 0) + ' hm' : '';
    const teile = [km, hm].filter(Boolean).join(' · ');
    const auf = detailOffen.has(t.id);
    return `<div class="karte anim">
      <button class="tour-kopf" data-action="wandern.detail" data-sid="${t.id}">
        <div>
          <strong>${esc(t.name || 'Wanderung')}</strong><br>
          <small class="dim">${esc(formatDatum(t.datum))}${teile ? ' · ' + esc(teile) : ''}</small>
        </div>
        <span class="pfeil-ico ${auf ? 'runter' : ''}" style="border-bottom-color:var(--wandern)"></span>
      </button>
      ${auf ? tourDetailHtml(findeAktivitaet(S(), t.segmente[0]?.aktivitaetId) ?? wanderAktivitaet(S()), mw)
        + `<div class="knopf-zeile">
            <button class="knopf klein" data-action="wandern.teilen" data-sid="${t.id}">Teilen</button>
            <button class="knopf klein" data-action="wandern.wiederOeffnen" data-sid="${t.id}">Bearbeiten</button>
          </div>` : ''}
    </div>`;
  }

  function tourHtml(s) {
    const akt = findeAktivitaet(S(), s.segmente[0]?.aktivitaetId) ?? wanderAktivitaet(S());
    const seg = s.segmente[0];
    const e = seg.eintraege[0];
    const fertig = s.abgeschlossen === true;
    const mw = e.messwerte;

    const km = mw.distanz != null ? formatZahl(mw.distanz / 1000, 1) : '0';

    let html = `<div class="session-kopf anim">
      <div>
        <span class="eyebrow"><span class="pip wandern"></span>${fertig ? 'Wanderung · fertig' : 'Neue Wanderung'}</span>
        <h1>${esc(s.name || 'Wanderung')}</h1>
        <p class="dim">${esc(formatDatum(s.datum))}</p>
      </div>
      <div class="vol"><span class="num" style="color:var(--wandern)">${km}</span><span class="dim">km</span></div>
    </div>`;

    if (!fertig) {
      html += `<div class="karte">
        <label class="sheet-abschnitt">Name der Wanderung <span class="dim">(optional)</span></label>
        <input class="tour-name-feld" type="text" value="${esc(s.name ?? '')}"
          placeholder="z.B. Nordhelle-Rundweg" data-change="wandern.name">
      </div>`;

      const felder = (akt.messwerte ?? STANDARD_MESSWERTE);
      html += `<div class="karte tour-felder">
        ${felder.map(typ => feldHtml(typ, mw[typ])).join('')}
      </div>`;

      const zusatz = OPTIONAL_MESSWERTE.filter(t => !felder.includes(t));
      if (zusatz.length) {
        html += `<p class="sheet-abschnitt zwischen">Mehr Werte</p>
          <div class="chip-zeile">${zusatz.map(t =>
            `<button class="chip" data-action="wandern.mwPlus" data-typ="${t}">+ ${esc(MESSWERTE[t].label)}</button>`).join('')}</div>`;
      }

      html += `<button class="knopf primaer gross voll" data-action="wandern.fertig">Wanderung speichern ✓</button>`;
      html += `<button class="knopf geist voll" data-action="wandern.verwerfen">Verwerfen</button>`;
    } else {
      html += tourDetailHtml(akt, mw);
      html += `<div class="knopf-zeile">
        <button class="knopf klein" data-action="wandern.teilen" data-sid="${s.id}">Teilen</button>
        <button class="knopf klein" data-action="wandern.wiederOeffnen" data-sid="${s.id}">Bearbeiten</button>
      </div>`;
    }
    return html;
  }

  /** Ein Eingabefeld für einen Messwert. */
  function feldHtml(typ, roh) {
    const def = MESSWERTE[typ];
    let wert = '';
    if (roh != null) {
      if (def.anzeige === 'zeit') wert = dauerInput(roh);
      else if (def.anzeige === 'distanz') wert = formatZahl(roh / 1000, 2);
      else wert = formatZahl(roh, def.dezimal ?? 0);
    }
    const einheit = def.anzeige === 'zeit' ? ''
      : def.anzeige === 'distanz' ? 'km' : (def.einheit || '');

    let platzhalter = '0';
    if (def.anzeige === 'zeit') platzhalter = '2:30';
    else if (def.anzeige === 'distanz') platzhalter = '8,5';
    else if (typ === 'hoehenmeter') platzhalter = '420';
    else if (typ === 'schritte') platzhalter = '12000';
    else if (typ === 'kalorien') platzhalter = '650';
    else if (typ === 'puls_avg' || typ === 'puls_max') platzhalter = '108';

    const kannWeg = OPTIONAL_MESSWERTE.includes(typ);
    // Beim Dauer-Feld das Format dauerhaft erklären (Stunden:Minuten beim Wandern).
    const hinweisText = def.anzeige === 'zeit' ? 'Std:Min' : '';
    return `<div class="tour-feld">
      <label>${esc(def.label)}${hinweisText ? ` <span class="feld-format">${esc(hinweisText)}</span>` : ''}</label>
      <div class="tour-feld-eingabe">
        <input type="text" inputmode="${def.anzeige === 'zeit' ? 'text' : 'decimal'}"
          value="${esc(wert)}" placeholder="${esc(platzhalter)}"
          data-change="wandern.wert" data-typ="${typ}">
        ${einheit ? `<span class="einheit">${esc(einheit)}</span>` : ''}
        ${kannWeg ? `<button class="feld-weg" data-action="wandern.mwWeg" data-typ="${typ}">✕</button>` : ''}
      </div>
    </div>`;
  }

  function tourDetailHtml(akt, mw) {
    const zeilen = (akt.messwerte ?? []).filter(typ => mw[typ] != null).map(typ => {
      const def = MESSWERTE[typ];
      return `<div class="detail-zeile">
        <span class="dim">${esc(def.label)}</span>
        <strong>${esc(formatWert(typ, mw[typ], { kategorie: MODUL }))}</strong>
      </div>`;
    }).join('');
    return `<div class="karte">${zeilen || '<p class="dim">Keine Werte eingetragen.</p>'}</div>`;
  }

  function dauerInput(sek) {
    if (sek == null) return '';
    const h = Math.floor(sek / 3600);
    const m = Math.floor((sek % 3600) / 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  /** Wander-Dauer parsen: "H:MM", "H:MM:SS" oder nackte Zahl = Minuten.
   *  Anders als Rad (Min:Sek), weil Wanderungen in Stunden:Minuten
   *  gedacht werden (z.B. "2:30" = 2 h 30 min). */
  function parseWanderDauer(str) {
    if (typeof str !== 'string') return null;
    const s = str.trim();
    if (s === '') return null;
    const teile = s.split(':').map(x => x.trim());
    if (teile.length === 3) {
      const [h, m, sek] = teile.map(Number);
      if ([h, m, sek].some(isNaN)) return null;
      return h * 3600 + m * 60 + sek;
    }
    if (teile.length === 2) {
      const [h, m] = teile.map(Number);       // Std:Min
      if ([h, m].some(isNaN)) return null;
      return h * 3600 + m * 60;
    }
    const n = parseZahl(s);
    return n == null ? null : Math.round(n * 60);   // nackte Zahl = Minuten
  }

  // ----------------------------------------------------------
  // Statistik-Tab: Zeitraum wählen → Kennzahlen + Touren des Zeitraums
  // ----------------------------------------------------------

  const PFEIL_LINKS  = '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>';
  const PFEIL_RECHTS = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';

  function statistikHtml() {
    const r = zeitraumStatistik(S(), MODUL, statArt, statAnker);
    const aktuellerStart = zeitraum(statArt, heuteIso()).von;
    const istAktuell = r.von >= aktuellerStart;

    let html = `<div class="statistik" style="--akzent:var(--wandern)">
      <div class="tab-kopf anim">
        <span class="eyebrow"><span class="pip wandern"></span>Wandern</span><h1>Statistik</h1>
      </div>`;

    const arten = [['woche', 'Woche'], ['monat', 'Monat'], ['jahr', 'Jahr']];
    html += `<div class="chip-zeile stat-arten anim">${arten.map(([a, l]) =>
      `<button class="chip ${statArt === a ? 'aktiv' : ''}" data-action="wandern.statArt" data-art="${a}">${l}</button>`).join('')}</div>`;

    html += `<div class="karte stat-nav anim">
      <button class="stat-pfeil" data-action="wandern.statZurueck" aria-label="Früher">${PFEIL_LINKS}</button>
      <div class="stat-zeitraum ${istAktuell ? 'jetzt' : ''}">${esc(zeitraumLabel(statArt, statAnker))}</div>
      <button class="stat-pfeil ${istAktuell ? 'aus' : ''}" ${istAktuell ? 'disabled' : ''} data-action="wandern.statVor" aria-label="Später">${PFEIL_RECHTS}</button>
    </div>`;

    if (r.anzahl === 0) {
      return html + `<div class="karte leer anim"><p>Keine Wanderungen in diesem Zeitraum. Blätter zurück oder wechsle den Zeitraum. 🥾</p></div></div>`;
    }

    html += `<p class="stat-anzahl dim anim">${r.anzahl} ${r.anzahl === 1 ? 'Wanderung' : 'Wanderungen'}</p>`;
    html += `<div class="karte stat-kennzahlen anim">${
      Object.entries(r.kennzahlen).map(([typ, wert]) => `<div class="stat-kennzahl">
        <span class="sk-wert">${esc(formatWert(typ, wert, { kategorie: MODUL }))}</span>
        <span class="sk-label dim">${esc(MESSWERTE[typ].label)}</span>
      </div>`).join('')
    }</div>`;

    html += `<p class="sheet-abschnitt zwischen">Touren</p>`;
    html += r.sessions.map(t => tourZeileHtml(t)).join('');

    return html + `</div>`;
  }

  // ----------------------------------------------------------
  // Aktionen
  // ----------------------------------------------------------

  function aktuelleTour() {
    let s = offeneTour ? S().sessions.find(x => x.id === offeneTour) : null;
    if (!s) { s = findeOffeneTour(); if (s) offeneTour = s.id; }
    return s;
  }

  const actions = {
    async 'wandern.neu'() {
      const akt = wanderAktivitaet(S());
      const s = neueSession(); s.modul = MODUL;
      const seg = addSegment(s, neuesSegment(akt.id));
      addEintrag(seg, neuerEintrag({}));
      S().sessions.push(s);
      offeneTour = s.id;
      await speichernUndZeigen();
    },
    async 'wandern.name'(d, el) {
      const s = aktuelleTour(); if (!s) return;
      s.name = el.value;
      await ctx.save();
    },
    async 'wandern.wert'(d, el) {
      const s = aktuelleTour(); if (!s) return;
      const e = s.segmente[0].eintraege[0];
      const def = MESSWERTE[d.typ];
      let wert;
      if (def.anzeige === 'zeit') wert = parseWanderDauer(el.value);
      else if (def.anzeige === 'distanz') { const n = parseZahl(el.value); wert = n == null ? null : Math.round(n * 1000); }
      else wert = parseZahl(el.value);
      if (wert == null) delete e.messwerte[d.typ]; else e.messwerte[d.typ] = wert;
      await ctx.save();
    },
    async 'wandern.mwPlus'(d) {
      const akt = wanderAktivitaet(S());
      if (!akt.messwerte.includes(d.typ)) akt.messwerte = [...akt.messwerte, d.typ];
      await speichernUndZeigen();
    },
    async 'wandern.mwWeg'(d) {
      const akt = wanderAktivitaet(S());
      akt.messwerte = akt.messwerte.filter(t => t !== d.typ);
      const s = aktuelleTour();
      if (s) delete s.segmente[0].eintraege[0].messwerte[d.typ];
      await speichernUndZeigen();
    },
    async 'wandern.fertig'() {
      const s = aktuelleTour(); if (!s) return;
      const mw = s.segmente[0].eintraege[0].messwerte;
      if (Object.keys(mw).length === 0) {
        await hinweis('Nichts eingetragen', 'Trag mindestens einen Wert ein, bevor du die Wanderung speicherst.');
        return;
      }
      s.abgeschlossen = true;
      s.segmente[0].erledigt = true;
      offeneTour = null;
      await speichernUndZeigen();
    },
    async 'wandern.verwerfen'() {
      const s = aktuelleTour(); if (!s) return;
      if (!await bestaetige({ titel: 'Wanderung verwerfen?', jaText: 'Verwerfen', gefahr: true })) return;
      S().sessions = S().sessions.filter(x => x.id !== s.id);
      offeneTour = null;
      await speichernUndZeigen();
    },
    async 'wandern.oeffne'(d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      s.abgeschlossen = false;
      s.segmente[0].erledigt = false;
      offeneTour = s.id;
      tabWechsel('heute');
      await speichernUndZeigen();
    },
    async 'wandern.wiederOeffnen'(d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      s.abgeschlossen = false;
      s.segmente[0].erledigt = false;
      offeneTour = s.id;
      tabWechsel('heute');
      await speichernUndZeigen();
    },
    'wandern.detail'(d) {
      detailOffen.has(d.sid) ? detailOffen.delete(d.sid) : detailOffen.add(d.sid);
      ctx.render();
    },
    'wandern.statArt'(d) {
      statArt = d.art;
      ctx.render();
    },
    'wandern.statZurueck'() {
      statAnker = verschiebeZeitraum(statArt, statAnker, -1);
      ctx.render();
    },
    'wandern.statVor'() {
      const neu = verschiebeZeitraum(statArt, statAnker, +1);
      if (zeitraum(statArt, neu).von > zeitraum(statArt, heuteIso()).von) return;
      statAnker = neu;
      ctx.render();
    },
    'wandern.alleTouren'() {
      alleTourenAuf = !alleTourenAuf;
      ctx.render();
    },
    async 'wandern.teilen'(d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      const akt = findeAktivitaet(S(), s.segmente[0]?.aktivitaetId) ?? wanderAktivitaet(S());
      const mw = wanderWerte(s);

      const zeilen = (akt.messwerte ?? STANDARD_MESSWERTE)
        .filter(typ => typ !== 'distanz' && typ !== 'hoehenmeter' && mw[typ] != null)
        .map(typ => ({
          name: MESSWERTE[typ].label,
          detail: formatWert(typ, mw[typ], { kategorie: MODUL }),
        }));

      const kmText = mw.distanz != null ? `${formatZahl(mw.distanz / 1000, 1)} km` : '–';
      // Höhenmeter prominent direkt unter dem Hero (der Stolz beim Wandern).
      const heroSub = mw.hoehenmeter != null
        ? { label: 'HÖHENMETER', wert: `${formatZahl(mw.hoehenmeter, 0)} hm` }
        : null;
      const hl = wanderHighlights(S(), s);

      const rueckblick = [];
      if (mw.distanz != null) rueckblick.push({ icon: '🥾', text: `${formatZahl(mw.distanz / 1000, 1)} km` });
      if (mw.hoehenmeter != null) rueckblick.push({ icon: '⛰️', text: `${formatZahl(mw.hoehenmeter, 0)} Höhenmeter` });
      if (mw.dauer != null) rueckblick.push({ icon: '⏱️', text: formatWert('dauer', mw.dauer) });
      if (mw.schritte != null) rueckblick.push({ icon: '👣', text: `${formatZahl(mw.schritte, 0)} Schritte` });

      const daten = {
        modul: MODUL,
        eyebrow: 'WANDERN · TOUR',
        titel: s.name || 'Wanderung',
        datum: ctx.formatDatum(s.datum),
        volumenText: kmText,
        volumenLabel: 'STRECKE',
        heroSub,
        zeilen,
        highlights: hl,
        rueckblick,
        notiz: (s.notiz ?? '').trim() || null,
      };

      try {
        const res = await teileKarte(daten, `all-in-one-wanderung-${s.datum}.png`);
        if (res === 'heruntergeladen') await hinweis('Bild gespeichert ✓');
      } catch (err) {
        await hinweis('Teilen nicht möglich', err.message);
      }
    },
  };

  return { heuteHtml, statistikHtml, actions };
}
