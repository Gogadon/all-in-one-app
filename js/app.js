// ============================================================
// app.js — Einstieg & Schale
// Lädt den Zustand, rendert Navi + aktiven Tab und leitet alle
// Klicks/Änderungen über data-action / data-change an die
// registrierten Aktionen weiter (Module bringen ihre eigenen mit).
// ============================================================

import { load, save, exportBackup, importBackup, leererZustand } from './core/storage.js';
import { formatZahl } from './core/metrics.js';
import { heuteIso, findeAktivitaet, sessionKategorien, wochenStart } from './core/model.js';
import { findeEinheit, naechsteEinheit } from './core/plan.js';
import { esc, formatDatum, sheet, bestaetige, hinweis } from './ui/components.js';
import {
  erstelleKraftModul, MODUL as KRAFT,
  sessionVolumenErledigt, segmentZusammenfassungKraft, segmentZusammenfassungWerte,
} from './modules/kraft.js';
import { erstelleRadModul, MODUL as RAD, tourStatistik } from './modules/rad.js';
import { erstelleWanderModul, MODUL as WANDERN, wanderStatistik } from './modules/wandern.js';
import { erstelleChallengeModul, MODUL as CHALLENGE, fortschritt } from './modules/challenge.js';

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
let unterseite = null;   // null | 'daten' — Overlay-Unterseite (übers Zahnrad)

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
const challenge = erstelleChallengeModul(ctx);

// Welches Modul zeigt der Heute-/Verlauf-Tab gerade? (Plan bleibt Kraft.)
let aktivesModul = KRAFT;

// ------------------------------------------------------------
// Aktionen: App-eigene + Modul-Aktionen in einem Register
// ------------------------------------------------------------
const actions = {
  'tab'(d) { tab = d.tab; unterseite = null; sheet.schliesse(); render(); window.scrollTo(0, 0); },
  'unterseiteAuf'(d) { unterseite = d.seite; render(); mainInner.parentElement.scrollTo(0, 0); },
  'unterseiteZu'() { unterseite = null; render(); mainInner.parentElement.scrollTo(0, 0); },
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
    [CHALLENGE]: ['dashboard', 'heute'],
  };
  const erlaubt = modulTabs[aktivesModul] ?? ['dashboard', 'heute'];

  // Manche Tabs heißen je Modul anders. Challenge: „Heute" → „Ziele".
  // Rad/Wandern: „Heute" → „Touren" (der Tab ist die Tour-Übersicht mit
  // Knopf zum Neu-Eintragen; „Heute" wäre irreführend, da man auch ältere
  // Touren sieht).
  const heisstTouren = aktivesModul === RAD || aktivesModul === WANDERN;
  const labelFuer = (t) => {
    // Rad/Wandern: der Verlauf-Tab ist die Statistik-Ansicht.
    if (t.id === 'verlauf' && heisstTouren) return 'Statistik';
    if (t.id !== 'heute') return t.label;
    if (aktivesModul === CHALLENGE) return 'Ziele';
    if (heisstTouren) return 'Touren';
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

/** Wochen-Statistik (diese Woche, modulübergreifend).
 *  Nutzt die robuste wochenStart-Funktion aus challenge.js: sie rechnet rein
 *  in UTC auf Basis des lokal ermittelten heuteIso() und kann deshalb an
 *  Tagesgrenzen nicht kippen (toISOString() auf ein lokales Date wäre buggy). */
function wochenStatistik() {
  const abMo = wochenStart();
  let einheiten = 0, touren = 0, km = 0, volumen = 0;
  for (const s of state.sessions) {
    if (s.datum < abMo || s.uebersprungen) continue;
    if ((s.modul ?? KRAFT) === KRAFT) {
      if (s.abgeschlossen) einheiten++;
      volumen += sessionVolumenErledigt(s);
    } else if (s.modul === RAD) {
      touren++;
      const mw = s.segmente[0]?.eintraege[0]?.messwerte ?? {};
      km += (mw.distanz ?? 0) / 1000;
    } else if (s.modul === WANDERN) {
      touren++;
      const mw = s.segmente[0]?.eintraege[0]?.messwerte ?? {};
      km += (mw.distanz ?? 0) / 1000;
    }
  }
  return { einheiten, touren, km, volumen };
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
  const chStatus = (() => {
    const ziele = state.challenges ?? [];
    if (!ziele.length) return 'Keine Ziele';
    const offen = ziele.filter(z => !fortschritt(state, z).fertig).length;
    return offen > 0 ? `${ziele.length} Ziele · ${offen} offen` : `${ziele.length} Ziele · alle geschafft ✓`;
  })();

  html += `<div class="dash-module">
    <button class="modul-kachel kraft" data-action="modulOeffne" data-m="${KRAFT}">
      <span class="mk-label">Kraft</span>
      <span class="mk-status">${esc(kraftStatus)}</span>
    </button>
    <button class="modul-kachel rad" data-action="modulOeffne" data-m="${RAD}">
      <span class="mk-label">Rad</span>
      <span class="mk-status">${esc(radStatus)}</span>
    </button>
    <button class="modul-kachel wandern" data-action="modulOeffne" data-m="${WANDERN}">
      <span class="mk-label">Wandern</span>
      <span class="mk-status">${esc(wanderStatus)}</span>
    </button>
    <button class="modul-kachel challenge" data-action="modulOeffne" data-m="${CHALLENGE}">
      <span class="mk-label">Challenge</span>
      <span class="mk-status">${esc(chStatus)}</span>
    </button>
  </div>`;

  // Wochen-Statistik
  const w = wochenStatistik();
  html += `<p class="sheet-abschnitt zwischen">Diese Woche</p>
    <div class="karte dash-stats">
      <div class="dash-stat"><span class="ds-zahl">${w.einheiten}</span><span class="dim">Einheiten</span></div>
      <div class="dash-stat"><span class="ds-zahl">${w.touren}</span><span class="dim">Touren</span></div>
      <div class="dash-stat"><span class="ds-zahl">${formatZahl0(w.km)}</span><span class="dim">km</span></div>
      <div class="dash-stat"><span class="ds-zahl">${formatZahl0(w.volumen)}</span><span class="dim">kg bewegt</span></div>
    </div>`;

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

  switch (tab) {
    case 'dashboard':
      mainInner.innerHTML = dashboardHtml();
      break;
    case 'heute':
      mainInner.innerHTML =
        aktivesModul === RAD ? rad.heuteHtml()
        : aktivesModul === WANDERN ? wandern.heuteHtml()
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
