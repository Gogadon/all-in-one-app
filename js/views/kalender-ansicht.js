// ============================================================
// views/kalender-ansicht.js — die drei Ebenen des Kalenders.
//
//   Ebene 1: Wochen-Streifen aufs Dashboard
//   Ebene 2: Monats-Raster im Overlay
//   Ebene 3: Tages-Sheet beim Antippen eines Tages
//
// Gerechnet wird in core-naher Schicht (kalender.js, Node-getestet); hier
// steht nur die Darstellung. Alles, was der Zustand der Oberfläche beisteuert
// (welcher Tag offen ist, welche Zeilen aufgeklappt sind), kommt als Argument
// herein — damit sind diese Funktionen ohne Browser prüfbar.
// ============================================================

import { esc } from '../ui/components.js';
import { formatZahl, formatWert } from '../core/metrics.js';
import { istWertbareTour, sessionWert } from '../core/model.js';
import { findeEinheit } from '../core/plan.js';
import { sessionVolumenErledigt } from '../modules/kraft.js';
import { wochenStreifen, monatsGitter, tagDetail } from '../kalender.js';
import { KRAFT, PLANBARE_MODULE, MODUL_LABEL, sessionNameFuer } from '../module-registry.js';
import { erledigteSegmentZeilen } from './session-zeilen.js';

/**
 * Die Punkte eines Tages: erledigt = gefüllt, geplant = Umriss.
 * Ein Ausfall-Tag (krank) bekommt ein eigenes, neutrales Zeichen — es verdrängt
 * nichts: wer trotz Erkältung radeln war, sieht beides.
 */
export function kalPunkte(module, geplant = [], ausfall = null) {
  return (ausfall ? `<span class="punkt ausfall ${ausfall}" title="Krank"></span>` : '')
    + module.map(m => `<span class="punkt ${m}"></span>`).join('')
    + geplant.map(m => `<span class="punkt umriss ${m}"></span>`).join('');
}

/** Ebene 1: der Wochen-Streifen fürs Dashboard. Jeder Tag → Tages-Sheet,
 *  der Pfeil rechts → Monats-Overlay. */
export function kalenderStreifenHtml(state) {
  const { tage } = wochenStreifen(state);
  const zellen = tage.map(t => {
    const klasse = ['kal-tag', t.istHeute ? 'heute' : '', t.istZukunft ? 'zukunft' : '']
      .filter(Boolean).join(' ');
    return `<button class="${klasse}" data-action="tag.auf" data-iso="${t.iso}">
      <span class="kal-wt">${t.kurz}</span>
      <span class="kal-num">${t.tag}</span>
      <span class="kal-dots">${kalPunkte(t.module, t.geplant, t.ausfall)}</span>
    </button>`;
  }).join('');
  return `<p class="sheet-abschnitt zwischen">Kalender</p>
    <div class="karte kal-streifen">
      <div class="kal-woche">${zellen}</div>
      <button class="kal-chevron-btn" data-action="kalender.auf" aria-label="Monatskalender öffnen">
        <span class="kal-chevron" aria-hidden="true"></span>
      </button>
    </div>`;
}

/** Ebene 2: das Monats-Raster im Overlay (mit Monats-Navigation). */
export function kalenderMonatHtml(state, anker) {
  const g = monatsGitter(state, anker);
  const kopfTage = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    .map(d => `<span class="kal-wt">${d}</span>`).join('');
  const zellen = g.wochen.flat().map(t => {
    const klasse = ['kal-zelle',
      t.imMonat ? '' : 'aus',
      t.istHeute ? 'heute' : '',
      t.istZukunft ? 'zukunft' : ''].filter(Boolean).join(' ');
    return `<button class="${klasse}" data-action="tag.auf" data-iso="${t.iso}">
      <span class="kal-num">${t.tag}</span>
      <span class="kal-dots">${kalPunkte(t.module, t.geplant, t.ausfall)}</span>
    </button>`;
  }).join('');
  return `<div class="kal-nav">
      <button class="kal-pfeil" data-action="kalender.rueck" aria-label="Voriger Monat"><span class="kal-pfeil-ico links"></span></button>
      <span class="kal-monat-label">${esc(g.label)}</span>
      <button class="kal-pfeil" data-action="kalender.vor" aria-label="Nächster Monat"><span class="kal-pfeil-ico"></span></button>
    </div>
    <div class="kal-kopf-tage">${kopfTage}</div>
    <div class="kal-gitter">${zellen}</div>`;
}

// ---- Ebene 3: Tages-Sheet ----------------------------------

/** „Montag, 13. Juli 2026" — voller Kopf fürs Sheet. */
export function langesDatum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Aufgeklappte Detail-Zeilen einer Session (Segmente mit Zusammenfassung). */
function tagZeileDetailHtml(state, s) {
  const zeilen = erledigteSegmentZeilen(state, s);
  const notiz = s.notiz ? `<p class="tz-notiz dim">${esc(s.notiz)}</p>` : '';
  return `<div class="tz-detail">${zeilen || '<small class="dim">Nichts abgehakt.</small>'}${notiz}</div>`;
}

/** Eine erledigte Session als aufklappbare Zeile im Tages-Sheet. */
function tagZeileHtml(state, s, auf) {
  const modul = s.modul ?? KRAFT;

  let titel, wert = '';
  if (modul === KRAFT) {
    const e = s.ausPlan ? findeEinheit(state, KRAFT, s.ausPlan) : null;
    titel = e ? e.name : 'Freie Session';
    const vol = sessionVolumenErledigt(s);
    if (vol > 0) wert = `${formatZahl(vol, 0)} kg`;
  } else {
    // Der Name kommt aus der Registry, also aus der Config des jeweiligen
    // Moduls. Früher stand hier ein Ternary „Rad ? Radtour : Wanderung",
    // wodurch JEDE Schwimmeinheit als „Wanderung" auftauchte.
    titel = s.name || sessionNameFuer(modul) || 'Einheit';
    const dist = sessionWert(s, 'distanz');
    if (dist) wert = formatWert('distanz', dist);
  }

  return `<div class="karte tag-zeile-karte">
    <button class="tour-kopf" data-action="tag.zeile" data-sid="${s.id}">
      <span class="tz-titel"><span class="punkt ${modul}"></span><strong>${esc(titel)}</strong></span>
      <span class="tz-rechts">${wert ? `<span class="dim num">${esc(wert)}</span>` : ''}<span class="pfeil-ico ${auf ? 'runter' : ''}"></span></span>
    </button>
    ${auf ? tagZeileDetailHtml(state, s) : ''}
  </div>`;
}

/** Eine Termin-Zeile: Modul-Umrisspunkt + optionale Notiz + Entfernen. */
function terminZeileHtml(t) {
  return `<div class="karte termin-karte">
    <span class="tz-titel"><span class="punkt umriss ${t.modul}"></span><strong>${esc(MODUL_LABEL[t.modul] ?? t.modul)}</strong></span>
    <input class="termin-notiz" type="text" data-change="termin.notiz" data-id="${t.id}" value="${esc(t.notiz)}" placeholder="Notiz…">
    <button class="termin-weg" data-action="termin.weg" data-id="${t.id}" aria-label="Termin entfernen">✕</button>
  </div>`;
}

/** Planungs-Abschnitt: bestehende Termine + Modul-Chips zum Anlegen. */
function planungHtml(termine, gesicht, iso) {
  const rows = termine.map(terminZeileHtml).join('');
  const chips = PLANBARE_MODULE.map(m =>
    `<button class="chip" data-action="termin.neu" data-iso="${iso}" data-m="${m}">+ ${esc(MODUL_LABEL[m])}</button>`
  ).join('');
  return `<p class="sheet-abschnitt zwischen">${gesicht === 'heute' ? 'Geplant' : 'Planung'}</p>
    ${rows || '<p class="tag-plan-leer dim">Noch nichts geplant.</p>'}
    <div class="plan-chips">${chips}</div>`;
}

/**
 * Ausfall-Abschnitt: Tag als krank melden bzw. die Meldung zurücknehmen.
 * Beim Melden lässt sich optional ein Enddatum angeben — eine Erkältung dauert
 * selten genau einen Tag, und so muss man nicht jeden Tag einzeln antippen.
 */
function ausfallHtml(ausfall, iso, krankBis) {
  if (ausfall) {
    return `<p class="sheet-abschnitt zwischen">Ausfall</p>
      <div class="karte ausfall-zeile">
        <span class="au-titel"><span class="punkt ausfall krank"></span><strong>Krank gemeldet</strong></span>
        <button class="knopf klein" data-action="tag.krankWeg" data-iso="${iso}">Zurücknehmen</button>
      </div>`;
  }
  return `<p class="sheet-abschnitt zwischen">Ausfall</p>
    <div class="karte ausfall-neu">
      <button class="knopf" data-action="tag.krank" data-iso="${iso}">Krank melden</button>
      <label class="au-bis">bis (optional)
        <input type="date" value="${esc(krankBis)}" data-change="tag.krankBis">
      </label>
    </div>`;
}

/**
 * Der ganze Inhalt des Tages-Sheets für einen Tag.
 * `offen` sind die IDs der aufgeklappten Session-Zeilen, `krankBis` das
 * optionale Enddatum im Krankmelde-Feld — beides reiner Oberflächen-Zustand.
 */
export function tagSheetHtml(state, iso, { offen = new Set(), krankBis = '' } = {}) {
  const d = tagDetail(state, iso);
  const erledigt = d.sessions.filter(istWertbareTour);
  const planbar = d.gesicht === 'heute' || d.gesicht === 'zukunft';

  let badge = '';
  if (d.gesicht === 'heute') badge = '<span class="tag-badge heute">Heute</span>';
  else if (d.gesicht === 'zukunft') badge = '<span class="tag-badge zukunft">Vorschau</span>';

  let koerper = '';

  // Rückblick (erledigte Aktivitäten) — bei vergangenen und heutigen Tagen
  if (d.gesicht !== 'zukunft') {
    if (erledigt.length) {
      koerper += erledigt.map(s => tagZeileHtml(state, s, offen.has(s.id))).join('');
    } else if (d.gesicht === 'vergangen') {
      koerper += '<div class="tag-leer"><p>An diesem Tag war nichts eingetragen.</p></div>';
    }
  }

  // Planung (Termine) — bei heute und in der Zukunft
  if (planbar) koerper += planungHtml(d.termine, d.gesicht, iso);

  // Ausfall (krank) — für heute und vergangene Tage. In der Zukunft ergibt
  // „krank melden" keinen Sinn; das wäre eine Vorhersage, kein Protokoll.
  if (d.gesicht !== 'zukunft') koerper += ausfallHtml(d.ausfall, iso, krankBis);

  return `<div class="tag-sheet-kopf"><h3>${esc(langesDatum(iso))}</h3>${badge}</div>${koerper}`;
}
