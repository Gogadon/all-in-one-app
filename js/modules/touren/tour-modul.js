// ============================================================
// tour-modul.js — gemeinsame FABRIK für alle „Touren"-Module.
//
// Rad, Wandern (und später Joggen, Schwimmen) sind strukturell gleich:
// eine Session mit genau EINEM Segment (die Tour), das genau EINEN Eintrag
// mit den Tour-Messwerten hat. Freie Touren, kein Plan.
//
// Die gesamte Logik + UI steht EINMAL hier. Jedes Sportmodul liefert nur
// noch eine CONFIG (der schlanke Verteiler) und ruft `erstelleTourModul`.
// Neue Outdoor-Module = neue Config-Datei, kein neuer Code.
//
// Andockstellen für spätere Module stecken schon in der Config:
//   dauerModus ('minSek' | 'stdMin'), hero (welche Kennzahl ist die große
//   Zahl), heroEinheit, Platzhalter-Map, Share-Konfiguration.
// ============================================================

import { MESSWERTE, formatWert, formatZahl, parseZahl } from '../../core/metrics.js';
import {
  heuteIso, neueSession, neuesSegment, neuerEintrag,
  addSegment, addEintrag, findeAktivitaet,
  zeitraum, verschiebeZeitraum, sortiereNeuesteZuerst, istWertbareTour,
} from '../../core/model.js';
import { zeitraumStatistik, zeitraumLabel, gewichtNachGroesse } from '../../core/statistik.js';
import { addAktivitaet } from '../../core/library.js';
import { bestaetige, hinweis } from '../../ui/components.js';
import { teileKarte } from '../../ui/share.js';

// ============================================================
// 1) REINE LOGIK (Node-testbar) — jeweils config-gebunden.
//    Die Modul-Dateien reichen diese als tourStatistik/alleTouren/…
//    unter ihren gewohnten Namen weiter (Oberfläche bleibt stabil).
// ============================================================

/** Alle Touren dieses Moduls, neueste zuerst. */
export function tourenFuer(state, config) {
  return sortiereNeuesteZuerst(
    state.sessions.filter(s => s.modul === config.modul && !s.uebersprungen));
}

/** Die eine Tour-Aktivität des Moduls (wird bei Bedarf angelegt). */
export function aktivitaetFuer(state, config, { anlegen = true } = {}) {
  let akt = state.bibliothek.find(a => a.kategorie === config.modul);
  if (!akt && anlegen) {
    akt = addAktivitaet(state, {
      name: config.titelEinzahl, kategorie: config.modul,
      messwerte: [...config.standardMesswerte],
    });
  }
  return akt;
}

/** Messwerte-Werte eines Tour-Segments (der eine Eintrag). Modul-unabhängig. */
export function werteVon(session) {
  const seg = session.segmente[0];
  return seg?.eintraege[0]?.messwerte ?? {};
}

/** Summen/Kennzahlen über alle (abgeschlossenen) Touren — für die Kopf-Statistik. */
export function statistikFuer(state, config) {
  const touren = tourenFuer(state, config).filter(istWertbareTour);
  let distanz = 0, dauer = 0, hoehen = 0, bahnen = 0;
  for (const s of touren) {
    const mw = werteVon(s);
    distanz += mw.distanz ?? 0;
    dauer += mw.dauer ?? 0;
    hoehen += mw.hoehenmeter ?? 0;
    bahnen += mw.bahnen ?? 0;
  }
  return { anzahl: touren.length, distanz, dauer, hoehen, bahnen };
}

/** Highlights einer Tour: persönliche Rekorde (aus config.rekorde). */
export function highlightsFuer(state, config, session) {
  const mw = werteVon(session);
  const andere = tourenFuer(state, config).filter(t => t.id !== session.id && t.abgeschlossen);
  const hl = [];
  for (const [typ, label, format] of config.rekorde ?? []) {
    const wert = mw[typ];
    if (wert == null || wert <= 0) continue;
    const bisher = andere.map(t => werteVon(t)[typ] ?? 0);
    const best = bisher.length ? Math.max(...bisher) : 0;
    if (wert > best) hl.push({ name: label, text: format(wert), pr: true });
  }
  return hl;
}

// ============================================================
// 2) DAUER: Parsen/Anzeige je nach Modus.
//   minSek: „35:50" = 35 min 50 s (wie Rad-Computer). Nackt = Minuten.
//   stdMin: „2:30"  = 2 Std 30 min (Wanderung dauert Stunden). Nackt = Minuten.
// ============================================================

function parseDauerModus(str, modus) {
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
    const [a, b] = teile.map(Number);
    if ([a, b].some(isNaN)) return null;
    // minSek: Minuten:Sekunden — stdMin: Stunden:Minuten
    return modus === 'stdMin' ? a * 3600 + b * 60 : a * 60 + b;
  }
  const n = parseZahl(s);
  return n == null ? null : Math.round(n * 60);   // nackte Zahl = Minuten
}

function dauerInputModus(sek, modus) {
  if (sek == null) return '';
  const h = Math.floor(sek / 3600);
  const m = Math.floor((sek % 3600) / 60);
  const s = Math.round(sek % 60);
  if (modus === 'stdMin') {
    // Stunden:Minuten (Sekunden werden bei Wanderungen nicht angezeigt)
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ============================================================
// 3) MODUL-FABRIK
// ============================================================

export function erstelleTourModul(ctx, config) {
  const M = config.modul;
  const S = () => ctx.state;
  const esc = ctx.esc;
  const tabWechsel = ctx.tabWechsel ?? (() => {});
  const formatDatum = ctx.formatDatum;
  const akzent = `var(${config.akzentVar})`;

  // Config-gebundene Kurzhelfer
  const alleTouren = () => tourenFuer(S(), config);
  const tourAktivitaet = (opts) => aktivitaetFuer(S(), config, opts);
  const tourStatistik = () => statistikFuer(S(), config);
  const parseDauer = (str) => parseDauerModus(str, config.dauerModus);
  const dauerInput = (sek) => dauerInputModus(sek, config.dauerModus);

  // Hero-Zahl formatieren. Default: Meter → km (Rad/Wandern). Module mit einem
  // anderen Hero (z.B. Schwimmen: Bahnen als reine Anzahl) überschreiben das
  // per config.heroFormat. Bekommt den Rohwert, gibt die reine Zahl als Text
  // zurück (die Einheit hängt config.heroEinheit separat dran).
  const heroFormat = config.heroFormat ?? (roh => formatZahl(roh / 1000, 1));

  // Kopf-Statistik-Karte (Start-Tab): zwei Kennwerte neben der Anzahl. Default
  // ist Rad/Wandern (km gesamt + Höhenmeter); andere Module liefern eigene
  // Zellen über config.kopfStat. Jede Zelle: { zahl:(stat)=>Text, label }.
  const kopfStat = config.kopfStat ?? [
    { zahl: st => formatZahl(st.distanz / 1000, 0), label: 'km gesamt' },
    { zahl: st => formatZahl(st.hoehen, 0),         label: 'Höhenmeter' },
  ];

  // UI-Zustand (nicht persistiert)
  let offeneTour = null;
  const detailOffen = new Set();
  let statArt = 'monat';       // 'woche' | 'monat' | 'jahr'
  let statAnker = heuteIso();
  let alleTourenAuf = false;    // Touren-Tab: ganze Liste aus-/eingeklappt
  let statGewichtet = false;    // Statistik: Ø-Kennzahlen nach Größe gewichten

  async function speichernUndZeigen() { await ctx.save(); ctx.render(); }

  // Kurzformatierung einer Kennzahl für die kompakte Tour-Zeile.
  function kurzWert(typ, v) {
    if (v == null) return '';
    if (typ === 'distanz') return formatZahl(v / 1000, 1) + ' km';
    if (typ === 'hoehenmeter') return formatZahl(v, 0) + ' hm';
    if (typ === 'schritte') return formatZahl(v, 0) + ' Schritte';
    if (typ === 'dauer') return formatWert('dauer', v);
    return formatWert(typ, v, { kategorie: M });
  }

  // ----------------------------------------------------------
  // Heute-Tab: neue Tour starten oder aktuelle bearbeiten
  // ----------------------------------------------------------

  function findeOffeneTour() {
    return S().sessions.find(s =>
      s.modul === M && !s.abgeschlossen && !s.uebersprungen) ?? null;
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
    const stat = tourStatistik();
    let html = `<div class="tab-kopf anim">
      <span class="eyebrow"><span class="pip ${M}"></span>${esc(config.eyebrow)}</span>
      <h1>${esc(config.h1Touren)}</h1>
    </div>`;

    if (stat.anzahl > 0) {
      html += `<div class="karte anim stat-karte">
        <div class="stat-3">
          <div><span class="stat-zahl">${stat.anzahl}</span><span class="dim">${esc(config.nomenMehrzahl)}</span></div>
          ${kopfStat.map(c => `<div><span class="stat-zahl">${esc(c.zahl(stat))}</span><span class="dim">${esc(c.label)}</span></div>`).join('')}
        </div>
      </div>`;
    }

    html += `<button class="knopf primaer gross voll" data-action="${M}.neu">+ Neue ${esc(config.nomenEinzahl)} eintragen</button>`;

    const alle = alleTouren();
    if (alle.length) {
      const touren = alleTourenAuf ? alle : alle.slice(0, 5);
      html += `<p class="sheet-abschnitt zwischen">${alleTourenAuf ? `Alle ${esc(config.nomenMehrzahl)}` : 'Zuletzt'}</p>`;
      html += touren.map(t => tourZeileHtml(t)).join('');
      if (alle.length > 5) {
        html += alleTourenAuf
          ? `<button class="knopf geist voll" data-action="${M}.alleTouren">Weniger anzeigen</button>`
          : `<button class="knopf geist voll" data-action="${M}.alleTouren">Alle anzeigen (${alle.length})</button>`;
      }
    } else {
      html += `<div class="karte leer anim"><p>${esc(config.leerText)}</p></div>`;
    }
    return html;
  }

  /** Eine Tour als kompakte Verlaufszeile. */
  function tourZeileHtml(t) {
    const mw = werteVon(t);
    const teile = (config.zeileNeben ?? []).map(typ => kurzWert(typ, mw[typ])).filter(Boolean).join(' · ');
    const auf = detailOffen.has(t.id);
    return `<div class="karte anim">
      <button class="tour-kopf" data-action="${M}.detail" data-sid="${t.id}">
        <div>
          <strong>${esc(t.name || config.titelEinzahl)}</strong><br>
          <small class="dim">${esc(formatDatum(t.datum))}${teile ? ' · ' + esc(teile) : ''}</small>
        </div>
        <span class="pfeil-ico ${auf ? 'runter' : ''}" style="border-bottom-color:${akzent}"></span>
      </button>
      ${auf ? tourDetailHtml(findeAktivitaet(S(), t.segmente[0]?.aktivitaetId) ?? tourAktivitaet(), mw)
        + `<div class="knopf-zeile">
            <button class="knopf klein" data-action="${M}.teilen" data-sid="${t.id}">Teilen</button>
            <button class="knopf klein" data-action="${M}.wiederOeffnen" data-sid="${t.id}">Bearbeiten</button>
          </div>` : ''}
    </div>`;
  }

  /** Die Bearbeitungs-Ansicht einer Tour (Messwerte eintragen). */
  function tourHtml(s) {
    const akt = findeAktivitaet(S(), s.segmente[0]?.aktivitaetId) ?? tourAktivitaet();
    const seg = s.segmente[0];
    const e = seg.eintraege[0];
    const fertig = s.abgeschlossen === true;
    const mw = e.messwerte;

    const heroRoh = mw[config.hero];
    const heroText = heroRoh != null ? heroFormat(heroRoh) : '0';

    let html = `<div class="session-kopf anim">
      <div>
        <span class="eyebrow"><span class="pip ${M}"></span>${fertig ? `${esc(config.nomenEinzahl)} · fertig` : `Neue ${esc(config.nomenEinzahl)}`}</span>
        <h1>${esc(s.name || config.titelEinzahl)}</h1>
        <p class="dim">${esc(formatDatum(s.datum))}</p>
      </div>
      <div class="vol"><span class="num" style="color:${akzent}">${heroText}</span><span class="dim">${esc(config.heroEinheit)}</span></div>
    </div>`;

    if (!fertig) {
      html += `<div class="karte">
        <label class="sheet-abschnitt">Name der ${esc(config.nomenEinzahl)} <span class="dim">(optional)</span></label>
        <input class="tour-name-feld" type="text" value="${esc(s.name ?? '')}"
          placeholder="${esc(config.namePlatzhalter)}" data-change="${M}.name">
      </div>`;

      const felder = (akt.messwerte ?? config.standardMesswerte);
      html += `<div class="karte tour-felder">
        ${felder.map(typ => feldHtml(typ, mw[typ])).join('')}
      </div>`;

      const zusatz = config.optionalMesswerte.filter(t => !felder.includes(t));
      if (zusatz.length) {
        html += `<p class="sheet-abschnitt zwischen">Mehr Werte</p>
          <div class="chip-zeile">${zusatz.map(t =>
            `<button class="chip" data-action="${M}.mwPlus" data-typ="${t}">+ ${esc(MESSWERTE[t].label)}</button>`).join('')}</div>`;
      }

      html += `<button class="knopf primaer gross voll" data-action="${M}.fertig">${esc(config.nomenEinzahl)} speichern ✓</button>`;
      html += `<button class="knopf geist voll" data-action="${M}.verwerfen">Verwerfen</button>`;
    } else {
      html += tourDetailHtml(akt, mw);
      html += `<div class="knopf-zeile">
        <button class="knopf klein" data-action="${M}.teilen" data-sid="${s.id}">Teilen</button>
        <button class="knopf klein" data-action="${M}.wiederOeffnen" data-sid="${s.id}">Bearbeiten</button>
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
    const einheit = def.anzeige === 'zeit' ? ''
      : def.anzeige === 'distanz' ? 'km' : (def.einheit || '');

    let platzhalter = '0';
    if (def.anzeige === 'zeit') platzhalter = config.dauerModus === 'stdMin' ? '2:30' : '35:50';
    else if (config.platzhalter?.[typ] != null) platzhalter = config.platzhalter[typ];

    const kannWeg = config.optionalMesswerte.includes(typ);
    const hinweisText = def.anzeige === 'zeit'
      ? (config.dauerModus === 'stdMin' ? 'Std:Min' : 'Min:Sek · oder Std:Min:Sek')
      : '';
    return `<div class="tour-feld">
      <label>${esc(def.label)}${hinweisText ? ` <span class="feld-format">${esc(hinweisText)}</span>` : ''}</label>
      <div class="tour-feld-eingabe">
        <input type="text" inputmode="${def.anzeige === 'zeit' ? 'text' : 'decimal'}"
          value="${esc(wert)}" placeholder="${esc(platzhalter)}"
          data-change="${M}.wert" data-typ="${typ}">
        ${einheit ? `<span class="einheit">${esc(einheit)}</span>` : ''}
        ${kannWeg ? `<button class="feld-weg" data-action="${M}.mwWeg" data-typ="${typ}">✕</button>` : ''}
      </div>
    </div>`;
  }

  /** Detail-Anzeige einer fertigen Tour (alle Werte schön dargestellt). */
  function tourDetailHtml(akt, mw) {
    const zeilen = (akt.messwerte ?? []).filter(typ => mw[typ] != null).map(typ => {
      const def = MESSWERTE[typ];
      return `<div class="detail-zeile">
        <span class="dim">${esc(def.label)}</span>
        <strong>${esc(formatWert(typ, mw[typ], { kategorie: M }))}</strong>
      </div>`;
    }).join('');
    return `<div class="karte">${zeilen || '<p class="dim">Keine Werte eingetragen.</p>'}</div>`;
  }

  // ----------------------------------------------------------
  // Statistik-Tab: Zeitraum wählen → Kennzahlen + Touren des Zeitraums
  // ----------------------------------------------------------

  const PFEIL_LINKS  = '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>';
  const PFEIL_RECHTS = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';

  function statistikHtml() {
    const r = zeitraumStatistik(S(), M, statArt, statAnker,
      statGewichtet ? { gewicht: gewichtNachGroesse } : {});
    const aktuellerStart = zeitraum(statArt, heuteIso()).von;
    const istAktuell = r.von >= aktuellerStart;

    let html = `<div class="statistik" style="--akzent:${akzent}">
      <div class="tab-kopf anim">
        <span class="eyebrow"><span class="pip ${M}"></span>${esc(config.eyebrow)}</span><h1>Statistik</h1>
      </div>`;

    const arten = [['woche', 'Woche'], ['monat', 'Monat'], ['jahr', 'Jahr']];
    html += `<div class="chip-zeile stat-arten anim">${arten.map(([a, l]) =>
      `<button class="chip ${statArt === a ? 'aktiv' : ''}" data-action="${M}.statArt" data-art="${a}">${l}</button>`).join('')}</div>`;

    html += `<div class="karte stat-nav anim">
      <button class="stat-pfeil" data-action="${M}.statZurueck" aria-label="Früher">${PFEIL_LINKS}</button>
      <div class="stat-zeitraum ${istAktuell ? 'jetzt' : ''}">${esc(zeitraumLabel(statArt, statAnker))}</div>
      <button class="stat-pfeil ${istAktuell ? 'aus' : ''}" ${istAktuell ? 'disabled' : ''} data-action="${M}.statVor" aria-label="Später">${PFEIL_RECHTS}</button>
    </div>`;

    if (r.anzahl === 0) {
      return html + `<div class="karte leer anim"><p>${esc(config.leerZeitraumText)}</p></div></div>`;
    }

    html += `<p class="stat-anzahl dim anim">${r.anzahl} ${r.anzahl === 1 ? esc(config.nomenEinzahl) : esc(config.nomenMehrzahl)}</p>`;
    html += `<div class="karte stat-kennzahlen anim">${
      Object.entries(r.kennzahlen).map(([typ, wert]) => `<div class="stat-kennzahl">
        <span class="sk-wert">${esc(formatWert(typ, wert, { kategorie: M }))}</span>
        <span class="sk-label dim">${esc(MESSWERTE[typ].label)}</span>
      </div>`).join('')
    }</div>`;

    // Umschalter nur zeigen, wenn es überhaupt eine Ø-Kennzahl gibt, die
    // sich gewichten lässt (registry-getrieben, kein Metrik-Sonderfall).
    const hatMittel = Object.keys(r.kennzahlen).some(typ => MESSWERTE[typ].agg === 'mittel');
    if (hatMittel) {
      html += `<button class="chip klein stat-gewicht ${statGewichtet ? 'aktiv' : ''}" data-action="${M}.statGewicht" aria-pressed="${statGewichtet}">Ø nach Größe gewichten</button>`;
    }

    html += `<p class="sheet-abschnitt zwischen">${esc(config.nomenMehrzahl)}</p>`;
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
    async [`${M}.neu`]() {
      const akt = tourAktivitaet();
      const s = neueSession(); s.modul = M;
      const seg = addSegment(s, neuesSegment(akt.id));
      addEintrag(seg, neuerEintrag({}));
      S().sessions.push(s);
      offeneTour = s.id;
      await speichernUndZeigen();
    },
    async [`${M}.name`](d, el) {
      const s = aktuelleTour(); if (!s) return;
      s.name = el.value;
      await ctx.save();  // kein Render → Fokus bleibt
    },
    async [`${M}.wert`](d, el) {
      const s = aktuelleTour(); if (!s) return;
      const e = s.segmente[0].eintraege[0];
      const def = MESSWERTE[d.typ];
      let wert;
      if (def.anzeige === 'zeit') wert = parseDauer(el.value);
      else if (def.anzeige === 'distanz') { const n = parseZahl(el.value); wert = n == null ? null : Math.round(n * 1000); }
      else wert = parseZahl(el.value);
      if (wert == null) delete e.messwerte[d.typ]; else e.messwerte[d.typ] = wert;
      await ctx.save();  // kein Render → Fokus bleibt
    },
    async [`${M}.mwPlus`](d) {
      const akt = tourAktivitaet();
      if (!akt.messwerte.includes(d.typ)) akt.messwerte = [...akt.messwerte, d.typ];
      await speichernUndZeigen();
    },
    async [`${M}.mwWeg`](d) {
      const akt = tourAktivitaet();
      akt.messwerte = akt.messwerte.filter(t => t !== d.typ);
      const s = aktuelleTour();
      if (s) delete s.segmente[0].eintraege[0].messwerte[d.typ];
      await speichernUndZeigen();
    },
    async [`${M}.fertig`]() {
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
    async [`${M}.verwerfen`]() {
      const s = aktuelleTour(); if (!s) return;
      if (!await bestaetige({ titel: `${config.nomenEinzahl} verwerfen?`, jaText: 'Verwerfen', gefahr: true })) return;
      S().sessions = S().sessions.filter(x => x.id !== s.id);
      offeneTour = null;
      await speichernUndZeigen();
    },
    async [`${M}.oeffne`](d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      s.abgeschlossen = false;
      s.segmente[0].erledigt = false;
      offeneTour = s.id;
      tabWechsel('heute');
      await speichernUndZeigen();
    },
    async [`${M}.wiederOeffnen`](d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      s.abgeschlossen = false;
      s.segmente[0].erledigt = false;
      offeneTour = s.id;
      tabWechsel('heute');
      await speichernUndZeigen();
    },
    [`${M}.detail`](d) {
      detailOffen.has(d.sid) ? detailOffen.delete(d.sid) : detailOffen.add(d.sid);
      ctx.render();
    },
    [`${M}.statArt`](d) {
      statArt = d.art;
      ctx.render();
    },
    [`${M}.statZurueck`]() {
      statAnker = verschiebeZeitraum(statArt, statAnker, -1);
      ctx.render();
    },
    [`${M}.statVor`]() {
      const neu = verschiebeZeitraum(statArt, statAnker, +1);
      if (zeitraum(statArt, neu).von > zeitraum(statArt, heuteIso()).von) return;
      statAnker = neu;
      ctx.render();
    },
    [`${M}.alleTouren`]() {
      alleTourenAuf = !alleTourenAuf;
      ctx.render();
    },
    [`${M}.statGewicht`]() {
      statGewichtet = !statGewichtet;
      ctx.render();
    },
    async [`${M}.teilen`](d) {
      const s = S().sessions.find(x => x.id === d.sid); if (!s) return;
      const akt = findeAktivitaet(S(), s.segmente[0]?.aktivitaetId) ?? tourAktivitaet();
      const mw = werteVon(s);

      const zeilen = (akt.messwerte ?? config.standardMesswerte)
        .filter(typ => typ !== config.hero && mw[typ] != null)   // Hero-Wert ist die große Zahl
        .map(typ => ({
          name: MESSWERTE[typ].label,
          detail: formatWert(typ, mw[typ], { kategorie: M }),
        }));

      const heroText = mw[config.hero] != null ? `${heroFormat(mw[config.hero])} ${config.heroEinheit}` : '–';
      const hl = highlightsFuer(S(), config, s);

      const rueckblick = [];
      for (const [typ, icon, format] of config.share.rueckblick ?? []) {
        if (mw[typ] != null) rueckblick.push({ icon, text: format(mw[typ]) });
      }

      const daten = {
        modul: M,
        eyebrow: config.share.eyebrow,
        titel: s.name || config.titelEinzahl,
        datum: ctx.formatDatum(s.datum),
        volumenText: heroText,
        volumenLabel: config.share.heroLabel,
        zeilen,
        highlights: hl,
        rueckblick,
        notiz: (s.notiz ?? '').trim() || null,
      };

      try {
        const res = await teileKarte(daten, `${config.share.dateiBasis}-${s.datum}.png`);
        if (res === 'heruntergeladen') await hinweis('Bild gespeichert ✓');
      } catch (err) {
        await hinweis('Teilen nicht möglich', err.message);
      }
    },
  };

  return { heuteHtml, statistikHtml, actions };
}
