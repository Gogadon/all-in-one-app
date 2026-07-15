// ============================================================
// app.js — Einstieg & Schale
// Lädt den Zustand, rendert Navi + aktiven Tab und leitet alle
// Klicks/Änderungen über data-action / data-change an die
// registrierten Aktionen weiter (Module bringen ihre eigenen mit).
// ============================================================

import { load, save, exportBackup, importBackup, leererZustand } from './core/storage.js';
import { formatZahl, formatWert } from './core/metrics.js';
import { heuteIso, findeAktivitaet, sessionKategorien, verschiebeZeitraum,
  istWertbareTour, sessionWert, loeseSegmentAuf, neuerTermin } from './core/model.js';
import { findeEinheit, naechsteEinheit } from './core/plan.js';
import { esc, formatDatum, sheet, bestaetige, hinweis } from './ui/components.js';
import {
  erstelleKraftModul, MODUL as KRAFT,
  sessionVolumenErledigt, segmentZusammenfassungKraft, segmentZusammenfassungWerte,
} from './modules/kraft.js';
import { erstelleRadModul, MODUL as RAD, tourStatistik } from './modules/rad.js';
import { erstelleWanderModul, MODUL as WANDERN, wanderStatistik } from './modules/wandern.js';
import { erstelleSchwimmModul, MODUL as SCHWIMMEN, schwimmStatistik } from './modules/schwimmen.js';
import { erstelleChallengeModul, MODUL as CHALLENGE, fortschritt } from './modules/challenge.js';
import { wochenUebersicht } from './dashboard.js';
import { wochenStreifen, monatsGitter, tagDetail } from './kalender.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');

// Sichtbare Viewport-Höhe exakt messen und als CSS-Variable setzen.
// Zuverlässiger als 100dvh (Firefox-Android rechnet dvh sonst falsch → Spalt
// unter der Navi). visualViewport bevorzugen, sonst innerHeight.
function setzeAppHoehe() {
  const h = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
}
setzeAppHoehe();
window.addEventListener('resize', setzeAppHoehe);
window.visualViewport?.addEventListener('resize', setzeAppHoehe);
window.addEventListener('orientationchange', () => setTimeout(setzeAppHoehe, 200));

// Feste Grundstruktur im Scroll-Container: Reload-Indikator + Inhaltsbereich.
main.innerHTML = `<div id="ptr" class="ptr"><span class="ptr-spinner"></span></div><div class="main-inner" id="mainInner"></div>`;
const mainInner = document.getElementById('mainInner');
const ptr = document.getElementById('ptr');

let state = null;
let tab = 'dashboard';
let unterseite = null;   // null | 'daten' | 'kalender' — Overlay über den Tabs
let kalenderAnker = heuteIso();   // welchen Monat zeigt das Kalender-Overlay
let tagSheetIso = null;           // welcher Tag im Tages-Sheet offen ist
const tagDetailOffen = new Set(); // welche Sessions im Tages-Sheet aufgeklappt sind

// ------------------------------------------------------------
// Kontext für Module
// ------------------------------------------------------------
const ctx = {
  get state() { return state; },
  save: async () => { await save(state); },
  render, sheet, esc, formatDatum,
  tabWechsel: (t) => { tab = t; },
};
const kraft = erstelleKraftModul(ctx);
const rad = erstelleRadModul(ctx);
const wandern = erstelleWanderModul(ctx);
const schwimmen = erstelleSchwimmModul(ctx);
const challenge = erstelleChallengeModul(ctx);

// Welches Modul zeigt der Heute-/Verlauf-Tab gerade? (Plan bleibt Kraft.)
let aktivesModul = KRAFT;

// Kalender-Planung: welche Module planbar sind (Challenge = Auswertung, kein Tun)
// und ihre Anzeigenamen.
const MODUL_LABEL = { [KRAFT]: 'Kraft', [RAD]: 'Rad', [WANDERN]: 'Wandern', [SCHWIMMEN]: 'Schwimmen', [CHALLENGE]: 'Challenge' };
const PLANBARE_MODULE = [KRAFT, RAD, WANDERN, SCHWIMMEN];
// Module, die über die gemeinsame Touren-Fabrik laufen (spontanes Loggen,
// „Heute" = Liste, Verlauf = Statistik). Schwimmen zählt in Einheiten.
const TOUREN_MODULE = [RAD, WANDERN, SCHWIMMEN];

// Line-Icons (stroke, viewBox 0 0 24 24) für die Dashboard-Kacheln.
const MODUL_ICON = {
  [KRAFT]: '<svg viewBox="0 0 24 24"><path d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12"/></svg>',
  [RAD]: '<svg viewBox="0 0 24 24"><circle cx="6" cy="16.5" r="3.3"/><circle cx="18" cy="16.5" r="3.3"/><path d="M6 16.5l5-8 7 8M11 8.5h5"/></svg>',
  [WANDERN]: '<svg viewBox="0 0 24 24"><path d="M3 19h18M6 19l4-6 3 4M12.5 19l4-7 4.5 7"/></svg>',
  [SCHWIMMEN]: '<svg viewBox="0 0 24 24"><path d="M2 8c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2M2 14c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/></svg>',
  [CHALLENGE]: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>',
};

// ------------------------------------------------------------
// Aktionen: App-eigene + Modul-Aktionen in einem Register
// ------------------------------------------------------------
const actions = {
  'tab'(d) { tab = d.tab; unterseite = null; sheet.schliesse(); render(); window.scrollTo(0, 0); },
  'unterseiteAuf'(d) { unterseite = d.seite; render(); mainInner.parentElement.scrollTo(0, 0); },
  'unterseiteZu'() { unterseite = null; render(); mainInner.parentElement.scrollTo(0, 0); },
  'kalender.auf'() { kalenderAnker = heuteIso(); unterseite = 'kalender'; render(); mainInner.parentElement.scrollTo(0, 0); },
  'kalender.vor'() { kalenderAnker = verschiebeZeitraum('monat', kalenderAnker, +1); render(); },
  'kalender.rueck'() { kalenderAnker = verschiebeZeitraum('monat', kalenderAnker, -1); render(); },
  'tag.auf'(d) { tagSheetIso = d.iso; tagDetailOffen.clear(); sheet.oeffne(tagSheetHtml()); },
  'tag.zeile'(d) {
    tagDetailOffen.has(d.sid) ? tagDetailOffen.delete(d.sid) : tagDetailOffen.add(d.sid);
    sheet.aktualisiere(tagSheetHtml());
  },
  async 'termin.neu'(d) {
    (state.termine ??= []).push(neuerTermin({ datum: d.iso, modul: d.m }));
    await ctx.save();
    render();                            // Punkte im Streifen/Raster darunter aktualisieren
    sheet.aktualisiere(tagSheetHtml());
  },
  async 'termin.weg'(d) {
    state.termine = (state.termine ?? []).filter(t => t.id !== d.id);
    await ctx.save();
    render();
    sheet.aktualisiere(tagSheetHtml());
  },
  async 'termin.notiz'(d, el) {
    const t = (state.termine ?? []).find(x => x.id === d.id);
    if (t) { t.notiz = el.value; await ctx.save(); }   // kein Re-Render → Fokus bleibt
  },
  'modulOeffne'(d) { aktivesModul = d.m; tab = 'heute'; unterseite = null; render(); window.scrollTo(0, 0); },
  'verlaufSub'(d) { verlaufSub = d.s; render(); mainInner.parentElement.scrollTo(0, 0); },

  'daten.export'() {
    const blob = new Blob([exportBackup(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `all-in-one-backup-${heuteIso()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  'daten.import'() { document.getElementById('importDatei')?.click(); },
  'daten.datei'(d, el) { importiereDatei(el); },
  async 'daten.reset'() {
    if (!await bestaetige({ titel: 'Alles zurücksetzen?',
      text: 'Sämtliche Sessions, Pläne und Übungen auf diesem Gerät werden gelöscht. Am besten vorher ein Backup exportieren.',
      jaText: 'Weiter', gefahr: true })) return;
    if (!await bestaetige({ titel: 'Wirklich alles löschen?',
      text: 'Letzte Chance — das lässt sich nicht rückgängig machen.',
      jaText: 'Alles löschen', gefahr: true })) return;
    state = leererZustand();
    unterseite = null; tab = 'dashboard';
    await ctx.save(); render();
  },

  ...kraft.actions,
  ...rad.actions,
  ...wandern.actions,
  ...schwimmen.actions,
  ...challenge.actions,
};

// Führt eine Aktion aus und fängt Fehler zentral ab. Viele Aktionen sind
// async (save, Import, Teilen); ohne diesen Wrapper würde ein Fehler dort zu
// einer unbehandelten Promise-Rejection — die App wirkt „eingefroren", ohne
// dem Nutzer zu sagen, was los ist. So gibt es stattdessen einen Hinweis.
async function fuehreAktionAus(fn, data, el, event) {
  try {
    await fn(data, el, event);
  } catch (err) {
    console.error('Aktion fehlgeschlagen:', err);
    try { await hinweis('Etwas ist schiefgelaufen', err?.message ?? String(err)); }
    catch { /* selbst der Hinweis kann scheitern — dann bleibt nur die Konsole */ }
  }
}

// Klicks: nächstes Element mit data-action suchen und ausführen
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) fuehreAktionAus(fn, el.dataset, el, e);
});

// Eingaben: data-change feuert bei „change" (Verlassen des Felds)
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const fn = actions[el.dataset.change];
  if (fn) fuehreAktionAus(fn, el.dataset, el, e);
});

// Komfort: beim Antippen eines Zahlen-/Wertfelds den Inhalt sofort markieren,
// damit man direkt die neue Zahl tippt, statt erst die alte zu löschen.
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el.tagName === 'INPUT' && el.dataset.change === 'k.wert') {
    // kurz warten, bis der Cursor gesetzt ist, dann alles markieren
    requestAnimationFrame(() => { try { el.select(); } catch {} });
  }
});

// ------------------------------------------------------------
// Tabs
// ------------------------------------------------------------
const TABS = [
  { id: 'dashboard', label: 'Start', icon: '<svg viewBox="0 0 24 24"><path d="M4 13h7V4H4v9zM13 20h7V4h-7v16zM4 20h7v-5H4v5z"/></svg>' },
  { id: 'heute',   label: 'Heute',   icon: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M2.5 9.5v5M21.5 9.5v5M6.5 12h11"/></svg>' },
  { id: 'plan',    label: 'Plan',    icon: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>' },
  { id: 'verlauf', label: 'Verlauf', icon: '<svg viewBox="0 0 24 24"><path d="M12 8v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z"/></svg>' },
];

function navHtml() {
  // Im Dashboard gibt es KEINE untere Navi — die Modul-Kacheln sind der Einstieg.
  if (tab === 'dashboard') return '';

  // Welche Tabs hat das aktive Modul? Start führt immer heim.
  // Kraft: alle. Rad: kein Plan. Challenge: nur Heute (kein Plan/Verlauf).
  const modulTabs = {
    [KRAFT]:     ['dashboard', 'heute', 'plan', 'verlauf'],
    [RAD]:       ['dashboard', 'heute', 'verlauf'],
    [WANDERN]:   ['dashboard', 'heute', 'verlauf'],
    [SCHWIMMEN]: ['dashboard', 'heute', 'verlauf'],
    [CHALLENGE]: ['dashboard', 'heute'],
  };
  const erlaubt = modulTabs[aktivesModul] ?? ['dashboard', 'heute'];

  // Manche Tabs heißen je Modul anders. Challenge: „Heute" → „Ziele".
  // Rad/Wandern: „Heute" → „Touren" (der Tab ist die Tour-Übersicht mit
  // Knopf zum Neu-Eintragen; „Heute" wäre irreführend, da man auch ältere
  // Touren sieht).
  const heisstTouren = TOUREN_MODULE.includes(aktivesModul);
  const labelFuer = (t) => {
    // Rad/Wandern/Schwimmen: der Verlauf-Tab ist die Statistik-Ansicht.
    if (t.id === 'verlauf' && heisstTouren) return 'Statistik';
    if (t.id !== 'heute') return t.label;
    if (aktivesModul === CHALLENGE) return 'Ziele';
    // Schwimmen zählt in Einheiten, Rad/Wandern in Touren.
    if (heisstTouren) return aktivesModul === SCHWIMMEN ? 'Einheiten' : 'Touren';
    return t.label;
  };

  // Challenge nutzt fürs „Heute" ein Zielscheiben-Icon statt der Hantel.
  const zielIcon = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>';
  // Rad/Wandern: Routen-Icon (Wegpunkte mit Pfad) statt der Hantel.
  const tourenIcon = '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 17c4 0 4-10 8-10"/></svg>';
  // Rad/Wandern: Balken-Icon für den Statistik-Tab statt der Uhr.
  const statistikIcon = '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';
  const iconFuer = (t) => {
    if (t.id === 'verlauf' && heisstTouren) return statistikIcon;
    if (t.id !== 'heute') return t.icon;
    if (aktivesModul === CHALLENGE) return zielIcon;
    if (heisstTouren) return tourenIcon;
    return t.icon;
  };

  const sichtbar = TABS.filter(t => erlaubt.includes(t.id));
  return sichtbar.map(t =>
    `<button class="nav-tab ${tab === t.id ? 'aktiv' : ''}" data-action="tab" data-tab="${t.id}">
      ${iconFuer(t)}<span>${labelFuer(t)}</span>
    </button>`).join('');
}

// ------------------------------------------------------------
// Verlauf-Tab (modulübergreifender Feed — Phase 1: nur Kraft da)
// ------------------------------------------------------------
let verlaufSub = 'feed';   // 'feed' | 'fortschritt'

function verlaufHtml() {
  // Rad: eigene Statistik-Ansicht (Zeitraum → Kennzahlen + Touren)
  if (aktivesModul === RAD) {
    return rad.statistikHtml();
  }
  // Wandern: eigene Statistik-Ansicht
  if (aktivesModul === WANDERN) {
    return wandern.statistikHtml();
  }
  // Schwimmen: eigene Statistik-Ansicht
  if (aktivesModul === SCHWIMMEN) {
    return schwimmen.statistikHtml();
  }

  // Kraft: Feed + Fortschritt wie gehabt
  const umschalter = `<div class="chip-zeile" style="margin:0 2px 14px">
    <button class="chip ${verlaufSub === 'feed' ? 'aktiv' : ''}" data-action="verlaufSub" data-s="feed">Verlauf</button>
    <button class="chip ${verlaufSub === 'fortschritt' ? 'aktiv' : ''}" data-action="verlaufSub" data-s="fortschritt">Fortschritt</button>
  </div>`;

  if (verlaufSub === 'fortschritt') {
    return umschalter + kraft.fortschrittHtml();
  }

  // Kraft-Feed: nur Kraft-Sessions (Rad hat eigenen Verlauf).
  // Übersprungene Tage nur, wenn beim Überspringen „im Verlauf vermerken" an war.
  const sessions = [...state.sessions]
    .filter(s => (s.modul ?? KRAFT) === KRAFT)
    .filter(s => !s.uebersprungen || s.imVerlauf === true)
    .sort((a, b) => b.datum.localeCompare(a.datum));
  let html = umschalter + `<div class="tab-kopf anim" style="margin-top:0"><span class="eyebrow"><span class="pip"></span>Kraft</span><h1>Verlauf</h1></div>`;
  if (!sessions.length) {
    return html + `<div class="karte leer anim"><p>Noch keine Sessions. Deine erste startest du im Heute-Tab.</p></div>`;
  }
  html += sessions.map(s => {
    // Übersprungener Tag: schlichte graue Zeile, keine volle Karte.
    if (s.uebersprungen) {
      return `<div class="karte anim uebersprungen-karte">
        <div class="verlauf-kopf">
          <div><span class="dim">${esc(s.uebersprungenName ?? 'Einheit')} · übersprungen</span><br>
            <small class="dim">${formatDatum(s.datum)}</small></div>
          <span class="skip-ico">›</span>
        </div>
      </div>`;
    }
    const einheit = s.ausPlan ? findeEinheit(state, s.modul ?? KRAFT, s.ausPlan) : null;
    const titel = einheit ? einheit.name : 'Freie Session';
    const vol = sessionVolumenErledigt(s);
    const kats = sessionKategorien(state, s);
    const zeilen = s.segmente.filter(seg => seg.erledigt === true).map(seg => {
      const akt = findeAktivitaet(state, seg.aktivitaetId);
      if (!akt) return '';
      const alt = seg.altOf ? (akt.alternativen ?? []).find(a => a.id === seg.altOf) : null;
      const zsf = akt.kategorie === 'kraft'
        ? segmentZusammenfassungKraft(seg)
        : segmentZusammenfassungWerte(akt, seg);
      return `<div class="verlauf-zeile"><span class="punkt ${akt.kategorie}"></span>${esc(alt?.name ?? akt.name)} <span class="dim">${esc(zsf)}</span></div>`;
    }).join('');
    return `<div class="karte anim">
      <div class="verlauf-kopf">
        <div><strong>${esc(titel)}</strong><br><small class="dim">${formatDatum(s.datum)}</small></div>
        <div class="chips-mini">${kats.map(k => `<span class="punkt ${k}"></span>`).join('')}
          ${vol > 0 ? `<span class="num dim">${formatZahl(vol, 0)} kg</span>` : ''}</div>
      </div>
      ${zeilen || '<small class="dim">Nichts abgehakt.</small>'}
      ${s.abgeschlossen ? `<button class="knopf klein geist voll" data-action="k.teilen" data-datum="1" data-sid="${s.id}" style="margin-top:12px">Teilen</button>` : ''}
    </div>`;
  }).join('');
  return html;
}

// ------------------------------------------------------------
// Daten-Tab (Backup rein/raus)
// ------------------------------------------------------------
function datenHtml() {
  return `<div class="tab-kopf anim"><span class="eyebrow"><span class="pip"></span>Backup & Speicher</span><h1>Daten</h1></div>
    <div class="karte anim">
      <p class="dim">${state.sessions.length} Sessions · ${state.bibliothek.length} Übungen/Aktivitäten</p>
      <div class="knopf-zeile">
        <button class="knopf primaer" data-action="daten.export">Backup exportieren</button>
        <button class="knopf" data-action="daten.import">Backup importieren</button>
      </div>
      <input type="file" id="importDatei" accept=".json,application/json" hidden data-change="daten.datei">
    </div>
    <div class="karte anim">
      <p class="dim">Alles auf Anfang — löscht sämtliche Daten dieser App auf diesem Gerät.</p>
      <button class="knopf gefahr" data-action="daten.reset">Alles zurücksetzen</button>
    </div>`;
}

function importiereDatei(input) {
  const datei = input.files?.[0];
  if (!datei) return;
  const leser = new FileReader();
  leser.onload = async () => {
    try {
      state = importBackup(String(leser.result));
      await ctx.save();
      await hinweis('Backup importiert ✓');
      // Zurück ins Dashboard: dort sieht man sofort alle Module und die
      // Wochenstatistik mit den frisch importierten Daten.
      unterseite = null; tab = 'dashboard';
      render();
    } catch (err) {
      await hinweis('Import fehlgeschlagen', err.message);
    }
  };
  leser.readAsText(datei);
  input.value = '';
}

// ------------------------------------------------------------
// Render & Start
// ------------------------------------------------------------
// ------------------------------------------------------------
// Verlauf-Tab
// ------------------------------------------------------------

// ------------------------------------------------------------
// Dashboard (Start-Tab): Module wählen + Wochen-Übersicht
// ------------------------------------------------------------

// Anzeige-Konfig je Modul für die Wochen-Aufschlüsselung. Reine UI-Sache:
// Name, Zählwort (Ein-/Mehrzahl) und die Sekundär-Kennzahl als fertiger Text.
// Rechnen tut die Kern-Funktion wochenUebersicht() — hier nur formatieren.
// Reihenfolge/Farbe kommen aus dem Ergebnis (module[]) bzw. via --<modul>.
const WOCHE_MODUL = {
  kraft:   { name: 'Kraft',   ein: 'Einheit', mehr: 'Einheiten',
             metrik: m => `${formatZahl0(m.kennzahlen.volumen ?? 0)} kg` },
  rad:     { name: 'Rad',     ein: 'Tour',    mehr: 'Touren',
             metrik: m => formatWert('distanz', m.kennzahlen.distanz ?? 0) },
  wandern: { name: 'Wandern', ein: 'Tour',    mehr: 'Touren',
             metrik: m => formatWert('distanz', m.kennzahlen.distanz ?? 0) },
  schwimmen: { name: 'Schwimmen', ein: 'Einheit', mehr: 'Einheiten',
             metrik: m => `${formatZahl0(m.kennzahlen.bahnen ?? 0)} Bahnen` },
};

/**
 * Zweistufige Wochen-Statistik fürs Dashboard.
 *   Stufe 1: universelle Kopfzeile (Aktivitäten + aktive Tage).
 *   Stufe 2: pro Modul eine Zeile in Akzentfarbe — nur Module mit Aktivität,
 *            leere werden ausgeblendet (der Kopf zeigt die Summen ohnehin).
 * Die Zahlen liefert wochenUebersicht() aus dashboard.js (modulübergreifend,
 * Node-getestet); hier passiert nur noch die Darstellung.
 */
function wochenStatistikHtml() {
  const u = wochenUebersicht(state);

  const kopf = `<div class="wo-kopf">
      <div class="wo-stat"><span class="wo-zahl">${u.aktivitaeten}</span><span class="dim">Aktivitäten</span></div>
      <div class="wo-stat"><span class="wo-zahl">${u.aktiveTage}</span><span class="dim">aktive Tage</span></div>
    </div>`;

  const zeilen = u.module
    .filter(m => m.anzahl > 0 && WOCHE_MODUL[m.modul])
    .map(m => {
      const cfg = WOCHE_MODUL[m.modul];
      const zaehlwort = m.anzahl === 1 ? cfg.ein : cfg.mehr;
      return `<div class="wo-modul" style="--akzent:var(--${m.modul})">
        <span class="wo-name">${cfg.name}</span>
        <span class="wo-werte"><b>${m.anzahl}</b> ${zaehlwort} <span class="wo-trenn">·</span> <b>${cfg.metrik(m)}</b></span>
      </div>`;
    }).join('');

  const koerper = zeilen ||
    `<p class="wo-leer">Diese Woche noch nichts eingetragen. Zeit für die erste Einheit. 💪</p>`;

  return `<p class="sheet-abschnitt zwischen">Diese Woche</p>
    <div class="karte woche-karte">${kopf}<div class="wo-module">${koerper}</div></div>`;
}

// ------------------------------------------------------------
// Kalender (Werkzeug B) — Ebene 1: Wochen-Streifen aufs Dashboard,
// Ebene 2: Monats-Overlay. Die Rechnerei steckt in kalender.js
// (Node-getestet); hier nur Darstellung. Tag-Antippen → Tages-Sheet
// folgt in Etappe 3.
// ------------------------------------------------------------

/** Die Modul-Punkte eines Tages: erledigt = gefüllt, geplant = Umriss. */
function kalPunkte(module, geplant = []) {
  return module.map(m => `<span class="punkt ${m}"></span>`).join('')
    + geplant.map(m => `<span class="punkt umriss ${m}"></span>`).join('');
}

/** Ebene 1: der Wochen-Streifen fürs Dashboard. Jeder Tag → Tages-Sheet,
 *  der Pfeil rechts → Monats-Overlay. */
function kalenderStreifenHtml() {
  const { tage } = wochenStreifen(state);
  const zellen = tage.map(t => {
    const klasse = ['kal-tag', t.istHeute ? 'heute' : '', t.istZukunft ? 'zukunft' : '']
      .filter(Boolean).join(' ');
    return `<button class="${klasse}" data-action="tag.auf" data-iso="${t.iso}">
      <span class="kal-wt">${t.kurz}</span>
      <span class="kal-num">${t.tag}</span>
      <span class="kal-dots">${kalPunkte(t.module, t.geplant)}</span>
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
function kalenderHtml() {
  const g = monatsGitter(state, kalenderAnker);
  const kopfTage = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    .map(d => `<span class="kal-wt">${d}</span>`).join('');
  const zellen = g.wochen.flat().map(t => {
    const klasse = ['kal-zelle',
      t.imMonat ? '' : 'aus',
      t.istHeute ? 'heute' : '',
      t.istZukunft ? 'zukunft' : ''].filter(Boolean).join(' ');
    return `<button class="${klasse}" data-action="tag.auf" data-iso="${t.iso}">
      <span class="kal-num">${t.tag}</span>
      <span class="kal-dots">${kalPunkte(t.module, t.geplant)}</span>
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

// ------------------------------------------------------------
// Kalender Ebene 3 — Tages-Sheet. Öffnet sich beim Antippen eines Tages
// (Streifen oder Monatsraster). Zeigt je nach „Gesicht":
//   vergangen → Rückblick (erledigte Aktivitäten, aufklappbar bis ins Detail)
//   heute     → dasselbe (Planung folgt in Etappe 4)
//   zukunft   → neutraler Leer-Zustand (Planung folgt in Etappe 4)
// tagDetail() (kalender.js, Node-getestet) liefert Gesicht + rohe Sessions;
// hier nur Darstellung + das modul-spezifische Formatieren der Zeilen.
// ------------------------------------------------------------

/** „Montag, 13. Juli 2026" — voller Kopf fürs Sheet. */
function langesDatum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Eine erledigte Session als aufklappbare Zeile im Tages-Sheet. */
function tagZeileHtml(s) {
  const modul = s.modul ?? KRAFT;
  const auf = tagDetailOffen.has(s.id);

  let titel, wert = '';
  if (modul === KRAFT) {
    const e = s.ausPlan ? findeEinheit(state, KRAFT, s.ausPlan) : null;
    titel = e ? e.name : 'Freie Session';
    const vol = sessionVolumenErledigt(s);
    if (vol > 0) wert = `${formatZahl(vol, 0)} kg`;
  } else {
    titel = s.name || (modul === RAD ? 'Radtour' : 'Wanderung');
    const dist = sessionWert(s, 'distanz');
    if (dist) wert = formatWert('distanz', dist);
  }

  return `<div class="karte tag-zeile-karte">
    <button class="tour-kopf" data-action="tag.zeile" data-sid="${s.id}">
      <span class="tz-titel"><span class="punkt ${modul}"></span><strong>${esc(titel)}</strong></span>
      <span class="tz-rechts">${wert ? `<span class="dim num">${esc(wert)}</span>` : ''}<span class="pfeil-ico ${auf ? 'runter' : ''}"></span></span>
    </button>
    ${auf ? tagZeileDetailHtml(s) : ''}
  </div>`;
}

/** Aufgeklappte Detail-Zeilen einer Session (Segmente mit Zusammenfassung). */
function tagZeileDetailHtml(s) {
  const zeilen = s.segmente.filter(seg => seg.erledigt === true).map(seg => {
    const { aktivitaet, anzeigeName } = loeseSegmentAuf(state, seg);
    if (!aktivitaet) return '';
    const zsf = aktivitaet.kategorie === 'kraft'
      ? segmentZusammenfassungKraft(seg)
      : segmentZusammenfassungWerte(aktivitaet, seg);
    return `<div class="verlauf-zeile"><span class="punkt ${aktivitaet.kategorie}"></span>${esc(anzeigeName)} <span class="dim">${esc(zsf)}</span></div>`;
  }).join('');
  const notiz = s.notiz ? `<p class="tz-notiz dim">${esc(s.notiz)}</p>` : '';
  return `<div class="tz-detail">${zeilen || '<small class="dim">Nichts abgehakt.</small>'}${notiz}</div>`;
}

/** Der ganze Inhalt des Tages-Sheets für den aktuell gewählten Tag. */
function tagSheetHtml() {
  const d = tagDetail(state, tagSheetIso);
  const erledigt = d.sessions.filter(istWertbareTour);
  const planbar = d.gesicht === 'heute' || d.gesicht === 'zukunft';

  let badge = '';
  if (d.gesicht === 'heute') badge = '<span class="tag-badge heute">Heute</span>';
  else if (d.gesicht === 'zukunft') badge = '<span class="tag-badge zukunft">Vorschau</span>';

  let koerper = '';

  // Rückblick (erledigte Aktivitäten) — bei vergangenen und heutigen Tagen
  if (d.gesicht !== 'zukunft') {
    if (erledigt.length) {
      koerper += erledigt.map(tagZeileHtml).join('');
    } else if (d.gesicht === 'vergangen') {
      koerper += '<div class="tag-leer"><p>An diesem Tag war nichts eingetragen.</p></div>';
    }
  }

  // Planung (Termine) — bei heute und in der Zukunft
  if (planbar) koerper += planungHtml(d.termine, d.gesicht);

  return `<div class="tag-sheet-kopf"><h3>${esc(langesDatum(tagSheetIso))}</h3>${badge}</div>${koerper}`;
}

/** Planungs-Abschnitt: bestehende Termine + Modul-Chips zum Anlegen. */
function planungHtml(termine, gesicht) {
  const rows = termine.map(terminZeileHtml).join('');
  const chips = PLANBARE_MODULE.map(m =>
    `<button class="chip" data-action="termin.neu" data-iso="${tagSheetIso}" data-m="${m}">+ ${esc(MODUL_LABEL[m])}</button>`
  ).join('');
  return `<p class="sheet-abschnitt zwischen">${gesicht === 'heute' ? 'Geplant' : 'Planung'}</p>
    ${rows || '<p class="tag-plan-leer dim">Noch nichts geplant.</p>'}
    <div class="plan-chips">${chips}</div>`;
}

/** Eine Termin-Zeile: Modul-Umrisspunkt + optionale Notiz + Entfernen. */
function terminZeileHtml(t) {
  return `<div class="karte termin-karte">
    <span class="tz-titel"><span class="punkt umriss ${t.modul}"></span><strong>${esc(MODUL_LABEL[t.modul] ?? t.modul)}</strong></span>
    <input class="termin-notiz" type="text" data-change="termin.notiz" data-id="${t.id}" value="${esc(t.notiz)}" placeholder="Notiz…">
    <button class="termin-weg" data-action="termin.weg" data-id="${t.id}" aria-label="Termin entfernen">✕</button>
  </div>`;
}

function dashboardHtml() {
  let html = `<div class="dash-kopf">
    <div><span class="eyebrow"><span class="pip"></span>All-in-One</span><h1>Start</h1></div>
    <button class="zahnrad" data-action="unterseiteAuf" data-seite="daten" aria-label="Daten & Einstellungen">⚙️</button>
  </div>`;

  // Modul-Kacheln
  const kraftStatus = (() => {
    const e = naechsteEinheit(state, KRAFT);
    return e ? e.name : 'Kein Plan';
  })();
  const radStat = tourStatistik(state);
  const radStatus = radStat.anzahl > 0 ? `${radStat.anzahl} Touren · ${Math.round(radStat.distanz / 1000)} km` : 'Noch keine Tour';
  const wanderStat = wanderStatistik(state);
  const wanderStatus = wanderStat.anzahl > 0 ? `${wanderStat.anzahl} Touren · ${Math.round(wanderStat.distanz / 1000)} km` : 'Noch keine Tour';
  const schwimmStat = schwimmStatistik(state);
  const schwimmStatus = schwimmStat.anzahl > 0 ? `${schwimmStat.anzahl} Einheiten · ${schwimmStat.bahnen} Bahnen` : 'Noch keine Einheit';
  const chStatus = (() => {
    const ziele = state.challenges ?? [];
    if (!ziele.length) return 'Keine Ziele';
    const offen = ziele.filter(z => !fortschritt(state, z).fertig).length;
    return offen > 0 ? `${ziele.length} Ziele · ${offen} offen` : `${ziele.length} Ziele · alle geschafft ✓`;
  })();

  html += `<div class="dash-module">
    <button class="modul-kachel kraft" data-action="modulOeffne" data-m="${KRAFT}">
      <span class="mk-icon">${MODUL_ICON[KRAFT]}</span>
      <span class="mk-label">Kraft</span>
      <span class="mk-status">${esc(kraftStatus)}</span>
    </button>
    <button class="modul-kachel rad" data-action="modulOeffne" data-m="${RAD}">
      <span class="mk-icon">${MODUL_ICON[RAD]}</span>
      <span class="mk-label">Rad</span>
      <span class="mk-status">${esc(radStatus)}</span>
    </button>
    <button class="modul-kachel wandern" data-action="modulOeffne" data-m="${WANDERN}">
      <span class="mk-icon">${MODUL_ICON[WANDERN]}</span>
      <span class="mk-label">Wandern</span>
      <span class="mk-status">${esc(wanderStatus)}</span>
    </button>
    <button class="modul-kachel schwimmen" data-action="modulOeffne" data-m="${SCHWIMMEN}">
      <span class="mk-icon">${MODUL_ICON[SCHWIMMEN]}</span>
      <span class="mk-label">Schwimmen</span>
      <span class="mk-status">${esc(schwimmStatus)}</span>
    </button>
    <button class="modul-kachel challenge" data-action="modulOeffne" data-m="${CHALLENGE}">
      <span class="mk-icon">${MODUL_ICON[CHALLENGE]}</span>
      <span class="mk-label">Challenge</span>
      <span class="mk-status">${esc(chStatus)}</span>
    </button>
  </div>`;

  // Wochen-Statistik (zweistufig: Kopfzeile + Modul-Aufschlüsselung)
  html += wochenStatistikHtml();

  // Kalender-Streifen (Ebene 1): Glance auf die Woche, tippen → Monats-Overlay
  html += kalenderStreifenHtml();

  return html;
}

function formatZahl0(n) {
  return Math.round(n).toLocaleString('de-DE');
}

function render() {
  const navInhalt = navHtml();
  nav.innerHTML = navInhalt;
  // Ohne untere Navi (Dashboard) den Platz voll nutzen.
  document.body.classList.toggle('ohne-navi', navInhalt === '');

  // Unterseite (z.B. Daten) liegt über den Tabs, mit Zurück-Pfeil.
  if (unterseite === 'daten') {
    mainInner.innerHTML = unterseiteHtml('Daten & Backup', datenHtml());
    return;
  }
  if (unterseite === 'kalender') {
    mainInner.innerHTML = unterseiteHtml('Kalender', kalenderHtml());
    return;
  }

  switch (tab) {
    case 'dashboard':
      mainInner.innerHTML = dashboardHtml();
      break;
    case 'heute':
      mainInner.innerHTML =
        aktivesModul === RAD ? rad.heuteHtml()
        : aktivesModul === WANDERN ? wandern.heuteHtml()
        : aktivesModul === SCHWIMMEN ? schwimmen.heuteHtml()
        : aktivesModul === CHALLENGE ? challenge.heuteHtml()
        : kraft.heuteHtml();
      break;
    case 'plan':
      // Plan ist Kraft-spezifisch (Rad hat keinen Zyklus)
      mainInner.innerHTML = kraft.planHtml();
      break;
    case 'verlauf':
      mainInner.innerHTML = verlaufHtml();
      break;
  }
}

/** Rahmen für eine Unterseite: Zurück-Pfeil + Titel + Inhalt. */
function unterseiteHtml(titel, inhalt) {
  return `<div class="unterseite-kopf">
      <button class="zurueck" data-action="unterseiteZu" aria-label="Zurück">
        <span class="zurueck-pfeil"></span>
      </button>
      <h2>${esc(titel)}</h2>
    </div>${inhalt}`;
}

// ------------------------------------------------------------
// Pull-to-Reload: am oberen Rand nach unten ziehen lädt die Seite neu.
// Nötig, weil der native Browser-Reload durch den Scroll-Container wegfällt.
// ------------------------------------------------------------
(function pullToReload() {
  const SCHWELLE = 70;      // px Zug bis Auslösen
  const MAX = 110;          // maximale sichtbare Zugstrecke
  let startY = null, zug = 0, aktiv = false;

  main.addEventListener('touchstart', e => {
    // Nur starten, wenn ganz oben und kein Sheet/Dialog offen ist.
    const ueberlagerung = document.body.classList.contains('sheet-auf')
      || document.querySelector('.dialog.offen');
    if (main.scrollTop <= 0 && !ueberlagerung) {
      startY = e.touches[0].clientY; aktiv = true; zug = 0;
    } else { aktiv = false; }
  }, { passive: true });

  main.addEventListener('touchmove', e => {
    if (!aktiv || startY == null) return;
    // Sobald die Liste gescrollt ist, ist die Geste kein Pull-to-Reload mehr.
    // (Sonst löst ein Richtungswechsel mitten im Scrollen einen Reload aus.)
    if (main.scrollTop > 0) {
      aktiv = false; zug = 0; startY = null;
      ptr.style.height = '0px'; ptr.classList.remove('bereit');
      return;
    }
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) {
      // Nach oben gewischt: Zug zurücksetzen, aber Startpunkt nachführen,
      // damit ein späterer Zug wieder bei 0 beginnt.
      zug = 0; startY = e.touches[0].clientY;
      ptr.style.height = '0px'; ptr.classList.remove('bereit');
      return;
    }
    zug = Math.min(delta * 0.5, MAX);           // gedämpft
    ptr.style.height = zug + 'px';
    ptr.classList.toggle('bereit', zug >= SCHWELLE);
  }, { passive: true });

  const ende = () => {
    if (!aktiv) return;
    aktiv = false;
    if (zug >= SCHWELLE) {
      ptr.classList.add('laedt');
      location.reload();
    } else {
      ptr.style.height = '0px';
      ptr.classList.remove('bereit');
    }
    startY = null;
  };
  main.addEventListener('touchend', ende, { passive: true });
  main.addEventListener('touchcancel', ende, { passive: true });
})();

try {
  state = await load();
  render();
} catch (err) {
  mainInner.innerHTML = `<div class="karte leer"><h2>Da klemmt was.</h2><p class="dim">${esc(err.message)}</p></div>`;
  console.error(err);
}
