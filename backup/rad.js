// ============================================================
// rad.js — das Rad-Modul (dünnes Modul auf dickem Kern).
//
// Anders als Kraft: KEINE Progression, KEINE Sätze, KEIN Zyklus.
// Eine Radtour ist eine Session mit genau EINEM Segment (die Tour),
// das genau EINEN Eintrag mit den Tour-Messwerten hat. Freie Touren,
// wann immer man Lust hat — kein Plan.
//
// Nutzt exakt dieselben Kern-Bausteine wie Kraft (model, metrics,
// library, charts, share). Das ist der Beweis, dass „ein Datenmodell
// für alles" trägt.
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

export const MODUL = 'rad';

// Standard-Messwerte einer Radtour (schnell einzutragen).
const STANDARD_MESSWERTE = ['dauer', 'distanz', 'tempo_avg', 'hoehenmeter', 'kalorien', 'puls_avg'];
// Optional dazuschaltbar (im ⚙️): für wer's genau will.
const OPTIONAL_MESSWERTE = ['tempo_max', 'puls_max', 'watt_avg', 'trittfrequenz'];

// ============================================================
// 1) REINE LOGIK (Node-testbar)
// ============================================================

/** Alle Radtouren (Sessions dieses Moduls), neueste zuerst. */
export function alleTouren(state) {
  return sortiereNeuesteZuerst(
    state.sessions.filter(s => s.modul === MODUL && !s.uebersprungen));
}

/** Die eine Tour-Aktivität (wird bei Bedarf angelegt — „Radtour"). */
export function tourAktivitaet(state, { anlegen = true } = {}) {
  let akt = state.bibliothek.find(a => a.kategorie === MODUL);
  if (!akt && anlegen) {
    akt = addAktivitaet(state, {
      name: 'Radtour', kategorie: MODUL,
      messwerte: [...STANDARD_MESSWERTE],
    });
  }
  return akt;
}

/** Messwerte-Werte eines Tour-Segments (der eine Eintrag). */
export function tourWerte(session) {
  const seg = session.segmente[0];
  return seg?.eintraege[0]?.messwerte ?? {};
}

/** Summen/Kennzahlen über alle Touren (für die Kopf-Statistik). */
export function tourStatistik(state) {
  const touren = alleTouren(state).filter(istWertbareTour);
  let distanz = 0, dauer = 0, hoehen = 0;
  for (const s of touren) {
    const mw = tourWerte(s);
    distanz += mw.distanz ?? 0;
    dauer += mw.dauer ?? 0;
    hoehen += mw.hoehenmeter ?? 0;
  }
  return { anzahl: touren.length, distanz, dauer, hoehen };
}

/**
 * Highlights einer Tour: Ist sie ein persönlicher Rekord?
 * Vergleicht gegen alle ANDEREN abgeschlossenen Touren.
 */
export function tourHighlights(state, session) {
  const mw = tourWerte(session);
  const andere = alleTouren(state).filter(t => t.id !== session.id && t.abgeschlossen);
  const hl = [];

  const rekord = (typ, label, format) => {
    const wert = mw[typ];
    if (wert == null || wert <= 0) return;
    const bisher = andere.map(t => tourWerte(t)[typ] ?? 0);
    const best = bisher.length ? Math.max(...bisher) : 0;
    if (wert > best) hl.push({ name: label, text: format(wert), pr: true });
  };

  rekord('distanz', 'Längste Tour', v => formatZahl(v / 1000, 1) + ' km');
  rekord('hoehenmeter', 'Meiste Höhenmeter', v => formatZahl(v, 0) + ' hm');
  rekord('dauer', 'Längste Fahrzeit', v => formatWert('dauer', v));
  rekord('tempo_avg', 'Schnellste Ø-Geschw.', v => formatZahl(v, 1) + ' km/h');

  return hl;
}

// ============================================================
// 2) MODUL-FABRIK
// ============================================================

export function erstelleRadModul(ctx) {
  const S = () => ctx.state;
  const esc = ctx.esc;
  const tabWechsel = ctx.tabWechsel ?? (() => {});
  const formatDatum = ctx.formatDatum;

  // UI-Zustand (nicht persistiert)
  let offeneTour = null;      // id der gerade bearbeiteten Tour-Session
  const detailOffen = new Set();

  // Statistik-Tab: aktueller Zeitraum. `anker` = ein Tag im Zeitraum,
  // die vor/zurück-Pfeile verschieben ihn. Default: laufender Monat.
  let statArt = 'monat';       // 'woche' | 'monat' | 'jahr'
  let statAnker = heuteIso();

  // Touren-Tab: ganze Liste aus- oder eingeklappt (Default: nur letzte 5).
  let alleTourenAuf = false;

  async function speichernUndZeigen() { await ctx.save(); ctx.render(); }

  // ----------------------------------------------------------
  // Heute-Tab: neue Tour starten oder aktuelle bearbeiten
  // ----------------------------------------------------------

  // Die aktuell offene (in Bearbeitung befindliche) Tour — direkt aus dem
  // State abgeleitet, nicht aus der flüchtigen Variable offeneTour. Dadurch
  // funktioniert die Bearbeitung auch nach einem Reload und bei älteren Touren.
  function findeOffeneTour() {
    return S().sessions.find(s =>
      s.modul === MODUL && !s.abgeschlossen && !s.uebersprungen) ?? null;
  }

  function heuteHtml() {
    const offen = findeOffeneTour();
    if (offen) {
      offeneTour = offen.id;      // flüchtige Variable nachführen (für Reload)
      return tourHtml(offen);
    }
    return startHtml();
  }

  function startHtml() {
    const stat = tourStatistik(S());
    let html = `<div class="tab-kopf anim">
      <span class="eyebrow"><span class="pip rad"></span>Rad</span>
      <h1>Touren</h1>
    </div>`;

    // Kleine Gesamt-Statistik, falls schon Touren da sind
    if (stat.anzahl > 0) {
      html += `<div class="karte anim stat-karte">
        <div class="stat-3">
          <div><span class="stat-zahl">${stat.anzahl}</span><span class="dim">Touren</span></div>
          <div><span class="stat-zahl">${formatZahl(stat.distanz / 1000, 0)}</span><span class="dim">km gesamt</span></div>
          <div><span class="stat-zahl">${formatZahl(stat.hoehen, 0)}</span><span class="dim">Höhenmeter</span></div>
        </div>
      </div>`;
    }

    html += `<button class="knopf primaer gross voll" data-action="rad.neu">+ Neue Tour eintragen</button>`;

    // Touren-Liste: standardmäßig die letzten 5, per „Alle anzeigen" ausklappbar.
    const alle = alleTouren(S());
    if (alle.length) {
      const touren = alleTourenAuf ? alle : alle.slice(0, 5);
      html += `<p class="sheet-abschnitt zwischen">${alleTourenAuf ? 'Alle Touren' : 'Zuletzt'}</p>`;
      html += touren.map(t => tourZeileHtml(t)).join('');
      if (alle.length > 5) {
        html += alleTourenAuf
          ? `<button class="knopf geist voll" data-action="rad.alleTouren">Weniger anzeigen</button>`
          : `<button class="knopf geist voll" data-action="rad.alleTouren">Alle anzeigen (${alle.length})</button>`;
      }
    } else {
      html += `<div class="karte leer anim"><p>Noch keine Touren. Trag deine erste Runde ein — freie Fahrt, wann immer du Lust hast. 🚲</p></div>`;
    }
    return html;
  }

  /** Eine Tour als kompakte Verlaufszeile. */
  function tourZeileHtml(t) {
    const mw = tourWerte(t);
    const km = mw.distanz != null ? formatZahl(mw.distanz / 1000, 1) + ' km' : '';
    const dauer = mw.dauer != null ? formatWert('dauer', mw.dauer) : '';
    const teile = [km, dauer].filter(Boolean).join(' · ');
    const auf = detailOffen.has(t.id);
    return `<div class="karte anim">
      <button class="tour-kopf" data-action="rad.detail" data-sid="${t.id}">
        <div>
          <strong>${esc(t.name || 'Radtour')}</strong><br>
          <small class="dim">${esc(formatDatum(t.datum))}${teile ? ' · ' + esc(teile) : ''}</small>
        </div>
        <span class="pfeil-ico ${auf ? 'runter' : ''}" style="border-bottom-color:var(--rad)"></span>
      </button>
      ${auf ? tourDetailHtml(findeAktivitaet(S(), t.segmente[0]?.aktivitaetId) ?? tourAktivitaet(S()), mw)
        + `<div class="knopf-zeile">
            <button class="knopf klein" data-action="rad.teilen" data-sid="${t.id}">Teilen</button>
            <button class="knopf klein" data-action="rad.wiederOeffnen" data-sid="${t.id}">Bearbeiten</button>
          </div>` : ''}
    </div>`;
  }

  /** Die Bearbeitungs-Ansicht einer Tour (Messwerte eintragen). */
  function tourHtml(s) {
    const akt = findeAktivitaet(S(), s.segmente[0]?.aktivitaetId) ?? tourAktivitaet(S());
    const seg = s.segmente[0];
    const e = seg.eintraege[0];
    const fertig = s.abgeschlossen === true;
    const mw = e.messwerte;

    const km = mw.distanz != null ? formatZahl(mw.distanz / 1000, 1) : '0';

    let html = `<div class="session-kopf anim">
      <div>
        <span class="eyebrow"><span class="pip rad"></span>${fertig ? 'Tour · fertig' : 'Neue Tour'}</span>
        <h1>${esc(s.name || 'Radtour')}</h1>
        <p class="dim">${esc(formatDatum(s.datum))}</p>
      </div>
      <div class="vol"><span class="num" style="color:var(--rad)">${km}</span><span class="dim">km</span></div>
    </div>`;

    if (!fertig) {
      // Name der Tour (optional)
      html += `<div class="karte">
        <label class="sheet-abschnitt">Name der Tour <span class="dim">(optional)</span></label>
        <input class="tour-name-feld" type="text" value="${esc(s.name ?? '')}"
          placeholder="z.B. Lüdenscheid Rundfahrt" data-change="rad.name">
      </div>`;

      // Messwert-Felder
      const felder = (akt.messwerte ?? STANDARD_MESSWERTE);
      html += `<div class="karte tour-felder">
        ${felder.map(typ => feldHtml(typ, mw[typ])).join('')}
      </div>`;

      // Optionale Werte dazuschalten
      const zusatz = OPTIONAL_MESSWERTE.filter(t => !felder.includes(t));
      if (zusatz.length) {
        html += `<p class="sheet-abschnitt zwischen">Mehr Werte</p>
          <div class="chip-zeile">${zusatz.map(t =>
            `<button class="chip" data-action="rad.mwPlus" data-typ="${t}">+ ${esc(MESSWERTE[t].label)}</button>`).join('')}</div>`;
      }

      html += `<button class="knopf primaer gross voll" data-action="rad.fertig">Tour speichern ✓</button>`;
      html += `<button class="knopf geist voll" data-action="rad.verwerfen">Verwerfen</button>`;
    } else {
      html += tourDetailHtml(akt, mw);
      html += `<div class="knopf-zeile">
        <button class="knopf klein" data-action="rad.teilen" data-sid="${s.id}">Teilen</button>
        <button class="knopf klein" data-action="rad.wiederOeffnen" data-sid="${s.id}">Bearbeiten</button>
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
      else if (typ === 'tempo_avg' || typ === 'tempo_max') wert = formatZahl(roh, 1);
      else wert = formatZahl(roh, def.dezimal ?? 0);
    }
    const einheit = def.anzeige === 'zeit' ? ''      // Format steht im Placeholder
      : def.anzeige === 'distanz' ? 'km' : (def.einheit || '');

    // Placeholder zeigt das erwartete Format — bei der Dauer besonders wichtig,
    // weil „35:50" hier Minuten:Sekunden meint (wie auf Uhr/Bordcomputer).
    let platzhalter = '0';
    if (def.anzeige === 'zeit') platzhalter = '35:50';
    else if (def.anzeige === 'distanz') platzhalter = '10,5';
    else if (typ === 'tempo_avg' || typ === 'tempo_max') platzhalter = '16,8';
    else if (typ === 'hoehenmeter') platzhalter = '143';
    else if (typ === 'kalorien') platzhalter = '365';
    else if (typ === 'puls_avg' || typ === 'puls_max') platzhalter = '116';

    const kannWeg = OPTIONAL_MESSWERTE.includes(typ);
    // Beim Dauer-Feld das Format dauerhaft erklären — der Placeholder
    // verschwindet ja, sobald getippt wird.
    const hinweisText = def.anzeige === 'zeit' ? 'Min:Sek · oder Std:Min:Sek' : '';
    return `<div class="tour-feld">
      <label>${esc(def.label)}${hinweisText ? ` <span class="feld-format">${esc(hinweisText)}</span>` : ''}</label>
      <div class="tour-feld-eingabe">
        <input type="text" inputmode="${def.anzeige === 'zeit' ? 'text' : 'decimal'}"
          value="${esc(wert)}" placeholder="${esc(platzhalter)}"
          data-change="rad.wert" data-typ="${typ}">
        ${einheit ? `<span class="einheit">${esc(einheit)}</span>` : ''}
        ${kannWeg ? `<button class="feld-weg" data-action="rad.mwWeg" data-typ="${typ}">✕</button>` : ''}
      </div>
    </div>`;
  }

  /** Detail-Anzeige einer fertigen Tour (alle Werte schön dargestellt). */
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
    const s = Math.round(sek % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Tour-Dauer parsen: "MM:SS", "H:MM:SS" oder nackte Zahl = Minuten.
   *  Anders als Kraft-Cardio (H:MM), weil Radtour-Zeiten wie auf der Uhr
   *  in Minuten:Sekunden angegeben werden (z.B. "35:50" = 35 min 50 s). */
  function parseTourDauer(str) {
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
      const [m, sek] = teile.map(Number);
      if ([m, sek].some(isNaN)) return null;
      return m * 60 + sek;
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
    // „vor" sperren, sobald wir im laufenden (oder einem späteren) Zeitraum sind —
    // in die Zukunft zu blättern zeigt nur leere Zeiträume.
    const aktuellerStart = zeitraum(statArt, heuteIso()).von;
    const istAktuell = r.von >= aktuellerStart;

    let html = `<div class="statistik" style="--akzent:var(--rad)">
      <div class="tab-kopf anim">
        <span class="eyebrow"><span class="pip rad"></span>Rad</span><h1>Statistik</h1>
      </div>`;

    // Zeitraum-Art
    const arten = [['woche', 'Woche'], ['monat', 'Monat'], ['jahr', 'Jahr']];
    html += `<div class="chip-zeile stat-arten anim">${arten.map(([a, l]) =>
      `<button class="chip ${statArt === a ? 'aktiv' : ''}" data-action="rad.statArt" data-art="${a}">${l}</button>`).join('')}</div>`;

    // vor/zurück + Zeitraum-Beschriftung
    html += `<div class="karte stat-nav anim">
      <button class="stat-pfeil" data-action="rad.statZurueck" aria-label="Früher">${PFEIL_LINKS}</button>
      <div class="stat-zeitraum ${istAktuell ? 'jetzt' : ''}">${esc(zeitraumLabel(statArt, statAnker))}</div>
      <button class="stat-pfeil ${istAktuell ? 'aus' : ''}" ${istAktuell ? 'disabled' : ''} data-action="rad.statVor" aria-label="Später">${PFEIL_RECHTS}</button>
    </div>`;

    if (r.anzahl === 0) {
      return html + `<div class="karte leer anim"><p>Keine Touren in diesem Zeitraum. Blätter zurück oder wechsle den Zeitraum. 🚲</p></div></div>`;
    }

    // Kennzahlen des Zeitraums (Reihenfolge & Aggregation kommen aus der Registry)
    html += `<p class="stat-anzahl dim anim">${r.anzahl} ${r.anzahl === 1 ? 'Tour' : 'Touren'}</p>`;
    html += `<div class="karte stat-kennzahlen anim">${
      Object.entries(r.kennzahlen).map(([typ, wert]) => `<div class="stat-kennzahl">
        <span class="sk-wert">${esc(formatWert(typ, wert, { kategorie: MODUL }))}</span>
        <span class="sk-label dim">${esc(MESSWERTE[typ].label)}</span>
      </div>`).join('')
    }</div>`;

    // Antippbare Tourenliste des Zeitraums → bestehendes Detail
    html += `<p class="sheet-abschnitt zwischen">Touren</p>`;
    html += r.sessions.map(t => tourZeileHtml(t)).join('');

    return html + `</div>`;
  }

  // ----------------------------------------------------------
  // Aktionen
  // ----------------------------------------------------------

  // Die gerade bearbeitete Tour holen. Nutzt die flüchtige Variable, fällt
  // aber auf die State-Ableitung zurück (falls offeneTour nach einem Reload
  // noch null ist). So laufen die Aktionen nach einem Reload nicht ins Leere.
  function aktuelleTour() {
    let s = offeneTour ? S().sessions.find(x => x.id === offeneTour) : null;
    if (!s) { s = findeOffeneTour(); if (s) offeneTour = s.id; }
    return s;
  }

  const actions = {
    async 'rad.neu'() {
      const akt = tourAktivitaet(S());
      const s = neueSession(); s.modul = MODUL;
      const seg = addSegment(s, neuesSegment(akt.id));
      addEintrag(seg, neuerEintrag({}));
      S().sessions.push(s);
      offeneTour = s.id;
      await speichernUndZeigen();
    },
    async 'rad.name'(d, el) {
      const s = aktuelleTour(); if (!s) return;
      s.name = el.value;
      await ctx.save();  // kein Render → Fokus bleibt
    },
    async 'rad.wert'(d, el) {
      const s = aktuelleTour(); if (!s) return;
      const e = s.segmente[0].eintraege[0];
      const def = MESSWERTE[d.typ];
      let wert;
      if (def.anzeige === 'zeit') wert = parseTourDauer(el.value);
      else if (def.anzeige === 'distanz') { const n = parseZahl(el.value); wert = n == null ? null : Math.round(n * 1000); }
      else wert = parseZahl(el.value);
      if (wert == null) delete e.messwerte[d.typ]; else e.messwerte[d.typ] = wert;
      await ctx.save();  // kein Render → Fokus bleibt
    },
    async 'rad.mwPlus'(d) {
      const akt = tourAktivitaet(S());
      if (!akt.messwerte.includes(d.typ)) akt.messwerte = [...akt.messwerte, d.typ];
      await speichernUndZeigen();
    },
    async 'rad.mwWeg'(d) {
      const akt = tourAktivitaet(S());
      akt.messwerte = akt.messwerte.filter(t => t !== d.typ);
      const s = aktuelleTour();
      if (s) delete s.segmente[0].eintraege[0].messwerte[d.typ];
      await speichernUndZeigen();
    },
    async 'rad.fertig'() {
      const s = aktuelleTour(); if (!s) return;
      const mw = s.segmente[0].eintraege[0].messwerte;
      if (Object.keys(mw).length === 0) {
        await hinweis('Nichts eingetragen', 'Trag mindestens einen Wert ein, bevor du die Tour speicherst.');
        return;
      }
      s.abgeschlossen = true;
      s.segmente[0].erledigt = true;
      offeneTour = null;
      await speichernUndZeigen();
    },
    async 'rad.verwerfen'() {
      const s = aktuelleTour(); if (!s) return;
      if (!await bestaetige({ titel: 'Tour verwerfen?', jaText: 'Verwerfen', gefahr: true })) return;
      S().sessions = S().sessions.filter(x => x.id !== s.id);
      offeneTour = null;
      await speichernUndZeigen();
    },
    async 'rad.oeffne'(d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      s.abgeschlossen = false;
      s.segmente[0].erledigt = false;
      offeneTour = s.id;
      tabWechsel('heute');       // Bearbeitung passiert im Heute-Tab
      await speichernUndZeigen();
    },
    async 'rad.wiederOeffnen'(d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      s.abgeschlossen = false;
      s.segmente[0].erledigt = false;
      offeneTour = s.id;
      tabWechsel('heute');       // Bearbeitung passiert im Heute-Tab
      await speichernUndZeigen();
    },
    'rad.detail'(d) {
      detailOffen.has(d.sid) ? detailOffen.delete(d.sid) : detailOffen.add(d.sid);
      ctx.render();
    },
    'rad.statArt'(d) {
      statArt = d.art;
      ctx.render();
    },
    'rad.statZurueck'() {
      statAnker = verschiebeZeitraum(statArt, statAnker, -1);
      ctx.render();
    },
    'rad.statVor'() {
      const neu = verschiebeZeitraum(statArt, statAnker, +1);
      // nicht in die Zukunft blättern (leere Zeiträume)
      if (zeitraum(statArt, neu).von > zeitraum(statArt, heuteIso()).von) return;
      statAnker = neu;
      ctx.render();
    },
    'rad.alleTouren'() {
      alleTourenAuf = !alleTourenAuf;
      ctx.render();
    },
    async 'rad.teilen'(d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      const akt = findeAktivitaet(S(), s.segmente[0]?.aktivitaetId) ?? tourAktivitaet(S());
      const mw = tourWerte(s);

      // Messwerte als Zeilen — nur die, die auch gefüllt sind.
      const zeilen = (akt.messwerte ?? STANDARD_MESSWERTE)
        .filter(typ => typ !== 'distanz' && mw[typ] != null)   // Distanz ist der Hero-Wert
        .map(typ => ({
          name: MESSWERTE[typ].label,
          detail: formatWert(typ, mw[typ], { kategorie: MODUL }),
        }));

      const kmText = mw.distanz != null ? `${formatZahl(mw.distanz / 1000, 1)} km` : '–';
      const hl = tourHighlights(S(), s);

      // Tagesrückblick: die Tour in Kennzahlen
      const rueckblick = [];
      if (mw.distanz != null) rueckblick.push({ icon: '🚴', text: `${formatZahl(mw.distanz / 1000, 1)} km` });
      if (mw.hoehenmeter != null) rueckblick.push({ icon: '⛰️', text: `${formatZahl(mw.hoehenmeter, 0)} Höhenmeter` });
      if (mw.dauer != null) rueckblick.push({ icon: '⏱️', text: formatWert('dauer', mw.dauer) });
      if (mw.kalorien != null) rueckblick.push({ icon: '🔥', text: `${formatZahl(mw.kalorien, 0)} kcal` });

      const daten = {
        modul: MODUL,
        eyebrow: 'RAD · TOUR',
        titel: s.name || 'Radtour',
        datum: ctx.formatDatum(s.datum),
        volumenText: kmText,
        volumenLabel: 'STRECKE',
        zeilen,
        highlights: hl,
        rueckblick,
        notiz: (s.notiz ?? '').trim() || null,
      };

      try {
        const res = await teileKarte(daten, `all-in-one-tour-${s.datum}.png`);
        if (res === 'heruntergeladen') await hinweis('Bild gespeichert ✓');
      } catch (err) {
        await hinweis('Teilen nicht möglich', err.message);
      }
    },
  };

  return { heuteHtml, statistikHtml, actions };
}
