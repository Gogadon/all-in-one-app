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

import { MESSWERTE, formatWert, formatZahl, parseZahl, parseDauer } from '../core/metrics.js';
import {
  heuteIso, neueSession, neuesSegment, neuerEintrag,
  addSegment, addEintrag, findeAktivitaet, loeseSegmentAuf,
} from '../core/model.js';
import { addAktivitaet, aktivitaetenNachKategorie } from '../core/library.js';
import { sparkline, trend } from '../ui/charts.js';
import { bestaetige, hinweis } from '../ui/components.js';

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
  return state.sessions
    .filter(s => s.modul === MODUL && !s.uebersprungen)
    .sort((a, b) => b.datum.localeCompare(a.datum));
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
  const touren = alleTouren(state);
  let distanz = 0, dauer = 0, hoehen = 0;
  for (const s of touren) {
    const mw = tourWerte(s);
    distanz += mw.distanz ?? 0;
    dauer += mw.dauer ?? 0;
    hoehen += mw.hoehenmeter ?? 0;
  }
  return { anzahl: touren.length, distanz, dauer, hoehen };
}

// ============================================================
// 2) MODUL-FABRIK
// ============================================================

export function erstelleRadModul(ctx) {
  const S = () => ctx.state;
  const esc = ctx.esc;
  const formatDatum = ctx.formatDatum;

  // UI-Zustand (nicht persistiert)
  let offeneTour = null;      // id der gerade bearbeiteten Tour-Session
  const detailOffen = new Set();

  async function speichernUndZeigen() { await ctx.save(); ctx.render(); }

  // ----------------------------------------------------------
  // Heute-Tab: neue Tour starten oder aktuelle bearbeiten
  // ----------------------------------------------------------

  function heuteHtml() {
    // Gibt es heute schon eine offene (nicht abgeschlossene) Tour?
    const heute = S().sessions.find(s =>
      s.modul === MODUL && s.datum === heuteIso() && !s.abgeschlossen && !s.uebersprungen);
    if (heute) return tourHtml(heute);
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

    // Letzte Touren als Vorschau
    const touren = alleTouren(S()).slice(0, 5);
    if (touren.length) {
      html += `<p class="sheet-abschnitt zwischen">Zuletzt</p>`;
      html += touren.map(t => tourZeileHtml(t)).join('');
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
    return `<button class="karte anim tour-zeile" data-action="rad.oeffne" data-sid="${t.id}">
      <div>
        <strong>${esc(t.name || 'Radtour')}</strong>
        <small class="dim">${esc(formatDatum(t.datum))}${teile ? ' · ' + esc(teile) : ''}</small>
      </div>
      <span class="pfeil-ico" style="border-bottom-color:var(--rad)"></span>
    </button>`;
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
      html += `<button class="knopf klein" data-action="rad.wiederOeffnen" data-sid="${s.id}">Bearbeiten</button>`;
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
    const einheit = def.anzeige === 'zeit' ? 'min'
      : def.anzeige === 'distanz' ? 'km' : (def.einheit || '');
    const kannWeg = OPTIONAL_MESSWERTE.includes(typ);
    return `<div class="tour-feld">
      <label>${esc(def.label)}</label>
      <div class="tour-feld-eingabe">
        <input type="text" inputmode="decimal" value="${esc(wert)}"
          placeholder="0" data-change="rad.wert" data-typ="${typ}">
        <span class="einheit">${esc(einheit)}</span>
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
  // Verlauf-Tab (eigene Tour-Liste)
  // ----------------------------------------------------------

  function verlaufHtml() {
    const touren = alleTouren(S());
    let html = `<div class="tab-kopf anim">
      <span class="eyebrow"><span class="pip rad"></span>Rad</span><h1>Touren-Verlauf</h1></div>`;
    if (!touren.length) {
      return html + `<div class="karte leer anim"><p>Noch keine Touren eingetragen.</p></div>`;
    }
    html += touren.map(t => {
      const mw = tourWerte(t);
      const auf = detailOffen.has(t.id);
      const km = mw.distanz != null ? formatZahl(mw.distanz / 1000, 1) + ' km' : '–';
      const meta = [
        mw.dauer != null ? formatWert('dauer', mw.dauer) : null,
        mw.tempo_avg != null ? formatZahl(mw.tempo_avg, 1) + ' km/h' : null,
        mw.hoehenmeter != null ? formatZahl(mw.hoehenmeter, 0) + ' hm' : null,
      ].filter(Boolean).join(' · ');
      return `<div class="karte anim">
        <button class="tour-kopf" data-action="rad.detail" data-sid="${t.id}">
          <div><strong>${esc(t.name || 'Radtour')}</strong><br>
            <small class="dim">${esc(formatDatum(t.datum))}</small></div>
          <div class="tour-km"><span style="color:var(--rad)">${km}</span>
            <span class="pfeil-ico ${auf ? 'runter' : ''}" style="border-bottom-color:var(--dim)"></span></div>
        </button>
        ${meta ? `<p class="dim tour-meta">${esc(meta)}</p>` : ''}
        ${auf ? tourDetailHtml(findeAktivitaet(S(), t.segmente[0]?.aktivitaetId) ?? tourAktivitaet(S()), mw) : ''}
      </div>`;
    }).join('');
    return html;
  }

  // ----------------------------------------------------------
  // Aktionen
  // ----------------------------------------------------------

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
      const s = S().sessions.find(x => x.id === offeneTour); if (!s) return;
      s.name = el.value;
      await ctx.save();  // kein Render → Fokus bleibt
    },
    async 'rad.wert'(d, el) {
      const s = S().sessions.find(x => x.id === offeneTour); if (!s) return;
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
      const s = S().sessions.find(x => x.id === offeneTour);
      if (s) delete s.segmente[0].eintraege[0].messwerte[d.typ];
      await speichernUndZeigen();
    },
    async 'rad.fertig'() {
      const s = S().sessions.find(x => x.id === offeneTour); if (!s) return;
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
      const s = S().sessions.find(x => x.id === offeneTour); if (!s) return;
      if (!await bestaetige({ titel: 'Tour verwerfen?', jaText: 'Verwerfen', gefahr: true })) return;
      S().sessions = S().sessions.filter(x => x.id !== offeneTour);
      offeneTour = null;
      await speichernUndZeigen();
    },
    async 'rad.oeffne'(d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      s.abgeschlossen = false;
      s.segmente[0].erledigt = false;
      offeneTour = s.id;
      await speichernUndZeigen();
    },
    async 'rad.wiederOeffnen'(d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      s.abgeschlossen = false;
      s.segmente[0].erledigt = false;
      offeneTour = s.id;
      await speichernUndZeigen();
    },
    'rad.detail'(d) {
      detailOffen.has(d.sid) ? detailOffen.delete(d.sid) : detailOffen.add(d.sid);
      ctx.render();
    },
  };

  return { heuteHtml, verlaufHtml, actions };
}
