// ============================================================
// app.js — Einstieg & Schale
// Lädt den Zustand, rendert Navi + aktiven Tab und leitet alle
// Klicks/Änderungen über data-action / data-change an die
// registrierten Aktionen weiter (Module bringen ihre eigenen mit).
// ============================================================

import {
  load, save, exportBackup, importBackup, leererZustand, backupDateiname,
  snapshots, sichereSnapshot, ladeSnapshot, loescheSnapshots,
  merkeExport, tageSeitExport, brauchtExportErinnerung, verschiebeErinnerung,
} from './core/storage.js';
import { formatZahl, formatWert } from './core/metrics.js';
import { heuteIso, findeAktivitaet, sessionKategorien, verschiebeZeitraum,
  neuerTermin, markiereAusfall, entferneAusfall } from './core/model.js';
import { findeEinheit } from './core/plan.js';
import { esc, formatDatum, sheet, bestaetige, hinweis } from './ui/components.js';
import { sessionVolumenErledigt } from './modules/kraft.js';
import {
  erstelleModule, MODULE, MODUL_TABS, KRAFT,
} from './module-registry.js';
import { wochenUebersicht } from './dashboard.js';
import { routeVonZustand, routeParsen } from './route.js';
import { installiereTastaturVerhalten } from './ui/tastatur.js';
import { erledigteSegmentZeilen } from './views/session-zeilen.js';
import { datenHtml } from './views/daten-ansicht.js';
import { kalenderStreifenHtml, kalenderMonatHtml, tagSheetHtml } from './views/kalender-ansicht.js';

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
let krankBis = '';                // optionales Enddatum beim Krankmelden (nur UI)

// ------------------------------------------------------------
// Kontext für Module
// ------------------------------------------------------------
const ctx = {
  get state() { return state; },
  save: async () => { await save(state); },
  render, sheet, esc, formatDatum,
  tabWechsel: (t) => { tab = t; },
};
const module = erstelleModule(ctx);

// Welches Modul zeigt der Heute-/Verlauf-Tab gerade? (Plan bleibt Kraft.)
let aktivesModul = KRAFT;

/** Das gerade aktive Modul samt Instanz. */
const aktives = () => module.nach(aktivesModul) ?? module.nach(KRAFT);


/** Inhalt des Tages-Sheets für den gerade offenen Tag. */
const tagSheet = () => tagSheetHtml(state, tagSheetIso, { offen: tagDetailOffen, krankBis });

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
  'tag.auf'(d) { tagSheetIso = d.iso; tagDetailOffen.clear(); sheet.oeffne(tagSheet()); },
  'tag.zeile'(d) {
    tagDetailOffen.has(d.sid) ? tagDetailOffen.delete(d.sid) : tagDetailOffen.add(d.sid);
    sheet.aktualisiere(tagSheet());
  },
  async 'termin.neu'(d) {
    (state.termine ??= []).push(neuerTermin({ datum: d.iso, modul: d.m }));
    await ctx.save();
    render();                            // Punkte im Streifen/Raster darunter aktualisieren
    sheet.aktualisiere(tagSheet());
  },
  async 'termin.weg'(d) {
    state.termine = (state.termine ?? []).filter(t => t.id !== d.id);
    await ctx.save();
    render();
    sheet.aktualisiere(tagSheet());
  },
  async 'termin.notiz'(d, el) {
    const t = (state.termine ?? []).find(x => x.id === d.id);
    if (t) { t.notiz = el.value; await ctx.save(); }   // kein Re-Render → Fokus bleibt
  },
  'tag.krankBis'(d, el) { krankBis = el.value; },      // nur merken, kein Re-Render
  async 'tag.krank'(d) {
    // Ohne Enddatum genau dieser eine Tag; mit Enddatum der ganze Zeitraum.
    const anzahl = markiereAusfall(state, d.iso, krankBis || d.iso);
    krankBis = '';
    await ctx.save();
    render();
    sheet.aktualisiere(tagSheet());
    if (anzahl > 1) await hinweis('Gute Besserung', `${anzahl} Tage als krank vermerkt.`);
  },
  async 'tag.krankWeg'(d) {
    entferneAusfall(state, d.iso);
    await ctx.save();
    render();
    sheet.aktualisiere(tagSheet());
  },
  'modulOeffne'(d) { aktivesModul = d.m; tab = 'heute'; unterseite = null; render(); window.scrollTo(0, 0); },
  'verlaufSub'(d) { verlaufSub = d.s; render(); mainInner.parentElement.scrollTo(0, 0); },

  async 'daten.export'() {
    const blob = new Blob([exportBackup(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = backupDateiname();
    a.click();
    URL.revokeObjectURL(a.href);
    // Datum merken → die Export-Erinnerung ist damit für 30 Tage still.
    merkeExport(state);
    await ctx.save();
    render();
  },
  async 'daten.erinnerungSpaeter'() {
    verschiebeErinnerung(state);
    await ctx.save();
    render();
  },
  async 'daten.snapshot'(d) {
    const punkt = snapshots().find(s => s.erstelltAm === d.marke);
    if (!punkt) { await hinweis('Nicht mehr da', 'Dieser Wiederherstellungspunkt existiert nicht mehr.'); return; }
    if (!await bestaetige({
      titel: `Stand vom ${formatDatum(punkt.datum)} laden?`,
      text: `Der aktuelle Stand (${state.sessions.length} Sessions) wird dabei ersetzt durch ${punkt.sessions} Sessions. Am besten vorher ein Backup exportieren.`,
      jaText: 'Wiederherstellen', gefahr: true })) return;
    state = ladeSnapshot(d.marke);
    await ctx.save();
    await hinweis('Wiederhergestellt ✓');
    unterseite = null; tab = 'dashboard';
    render();
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
    loescheSnapshots();   // „alles" heißt alles — sonst bliebe der alte Stand hintenrum liegen
    unterseite = null; tab = 'dashboard';
    await ctx.save(); render();
  },

  ...module.actions,
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

// Bildschirmtastatur: „Weiter" springt ins nächste Feld, verdeckte Felder
// werden nachgeführt. Steckt in ui/tastatur.js — hängt nur am DOM.
installiereTastaturVerhalten(main);

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
  const erlaubt = MODUL_TABS[aktivesModul] ?? ['dashboard', 'heute'];

  // Manche Tabs heißen je Modul anders — was, steht in der Registry.
  // Challenge: „Heute" → „Ziele". Rad/Wandern: „Heute" → „Touren" (der Tab
  // ist die Tour-Übersicht; „Heute" wäre irreführend, man sieht auch ältere).
  // Bei den Touren-Modulen ist „Verlauf" die Statistik-Ansicht.
  const m = aktives();
  const labelFuer = (t) => {
    if (t.id === 'verlauf') return m.verlaufLabel ?? t.label;
    if (t.id === 'heute') return m.heuteLabel ?? t.label;
    return t.label;
  };

  const iconFuer = (t) => {
    if (t.id === 'verlauf') return m.verlaufIcon ?? t.icon;
    if (t.id === 'heute') return m.heuteIcon ?? t.icon;
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
  // Touren-Module bringen ihre eigene Verlauf-Ansicht mit (die Statistik über
  // einen Zeitraum). Welche das sind, weiß die Registry — hier steht kein
  // Modulname mehr, den man beim nächsten Modul vergessen könnte.
  const m = aktives();
  if (m.verlaufHtml) return m.verlaufHtml(m.instanz);

  // Kraft: Feed + Fortschritt wie gehabt
  const umschalter = `<div class="chip-zeile" style="margin:0 2px 14px">
    <button class="chip ${verlaufSub === 'feed' ? 'aktiv' : ''}" data-action="verlaufSub" data-s="feed">Verlauf</button>
    <button class="chip ${verlaufSub === 'fortschritt' ? 'aktiv' : ''}" data-action="verlaufSub" data-s="fortschritt">Fortschritt</button>
  </div>`;

  if (verlaufSub === 'fortschritt') {
    return umschalter + m.instanz.fortschrittHtml();
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
    const zeilen = erledigteSegmentZeilen(state, s);
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
/**
 * Backup einlesen. Reihenfolge mit Absicht: erst PRÜFEN, dann FRAGEN, dann
 * einen Rettungspunkt anlegen, erst danach ersetzen.
 *
 * Vorher ersetzte die Datei den lokalen Stand sofort und wortlos — eine
 * versehentlich gewählte (oder alte) Datei kostete alles, was seitdem
 * dazugekommen war. Gefragt wird erst NACH dem Prüfen, damit niemand einen
 * Import bestätigen muss, der ohnehin an einer kaputten Datei scheitert.
 */
function importiereDatei(input) {
  const datei = input.files?.[0];
  if (!datei) return;
  const leser = new FileReader();
  leser.onload = async () => {
    try {
      // 1) Prüfen — wirft bei Müll, ersetzt aber noch nichts.
      const neu = importBackup(String(leser.result));

      // 2) Fragen, mit Zahlen von beiden Seiten.
      const jetzt = `${state.sessions.length} Sessions · ${state.bibliothek.length} Übungen`;
      const dann = `${neu.sessions.length} Sessions · ${neu.bibliothek.length} Übungen`;
      const ok = await bestaetige({
        titel: 'Backup importieren?',
        text: `Der Stand auf diesem Gerät (${jetzt}) wird ersetzt durch ${dann}. `
          + 'Vorher wird automatisch ein Wiederherstellungspunkt angelegt.',
        jaText: 'Importieren', gefahr: true,
      });
      if (!ok) return;

      // 3) Rettungspunkt vom AKTUELLEN Stand — erzwungen, denn der heutige
      //    Tages-Snapshot ist der Stand von heute früh, nicht der von eben.
      //    Schlägt das fehl (voller Speicher), wird NICHT einfach weiter-
      //    gemacht: vorher versprach die App hinterher trotzdem, der alte
      //    Stand liege bereit — ausgerechnet dann, wenn er weg ist.
      const gesichert = sichereSnapshot(state, heuteIso(), { erzwingen: true, grund: 'vor Import' });
      if (!gesichert) {
        const trotzdem = await bestaetige({
          titel: 'Kein Rettungspunkt möglich',
          text: 'Der Wiederherstellungspunkt konnte nicht angelegt werden — der Speicher ist voll oder blockiert. '
            + 'Wenn du jetzt importierst, ist der Stand auf diesem Gerät endgültig weg. '
            + 'Sicherer: abbrechen und ihn erst über „Backup exportieren" als Datei sichern.',
          jaText: 'Trotzdem importieren', gefahr: true,
        });
        if (!trotzdem) return;
      }

      // 4) Erst jetzt ersetzen.
      state = neu;
      await ctx.save();
      await hinweis('Backup importiert ✓', gesichert
        ? 'Der vorherige Stand liegt als Wiederherstellungspunkt bereit.'
        : 'Achtung: Ein Wiederherstellungspunkt war nicht möglich — der vorherige Stand ist weg.');
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

function dashboardHtml() {
  let html = `<div class="dash-kopf">
    <div><span class="eyebrow"><span class="pip"></span>All-in-One</span><h1>Start</h1></div>
    <button class="zahnrad" data-action="unterseiteAuf" data-seite="daten" aria-label="Daten & Einstellungen">⚙️</button>
  </div>`;

  // Erinnerung ans Datei-Backup — GANZ OBEN, weil ein Hinweis, den man erst
  // erscrollen muss, keiner ist. Bewusst kein Modal: er käme bei jedem Start
  // wieder, bis exportiert ist, und würde sich zum Wegklick-Reflex abnutzen.
  // Stattdessen sichtbar, aber nicht blockierend — mit „Später" als Ventil.
  if (brauchtExportErinnerung(state)) {
    const tage = tageSeitExport(state);
    html += `<div class="export-hinweis anim">
      <div class="eh-text">
        <strong>${tage == null ? 'Noch kein Backup gesichert' : `Letztes Backup vor ${tage} Tagen`}</strong>
        <small>Snapshots liegen nur auf diesem Gerät — eine Datei nicht.</small>
      </div>
      <div class="eh-knoepfe">
        <button class="knopf klein primaer" data-action="unterseiteAuf" data-seite="daten">Sichern</button>
        <button class="knopf klein" data-action="daten.erinnerungSpaeter">Später</button>
      </div>
    </div>`;
  }

  // Modul-Kacheln — Reihenfolge, Icon, Label und Statuszeile kommen aus der
  // Registry. Ein neues Modul erscheint hier von allein, statt dass man den
  // Block per Copy-Paste um einen siebten Eintrag erweitert.
  html += `<div class="dash-module">${MODULE.map(m => `
    <button class="modul-kachel ${m.id}" data-action="modulOeffne" data-m="${m.id}">
      <span class="mk-icon">${m.icon}</span>
      <span class="mk-label">${esc(m.label)}</span>
      <span class="mk-status">${esc(m.status(state))}</span>
    </button>`).join('')}
  </div>`;

  // Wochen-Statistik (zweistufig: Kopfzeile + Modul-Aufschlüsselung)
  html += wochenStatistikHtml();

  // Kalender-Streifen (Ebene 1): Glance auf die Woche, tippen → Monats-Overlay
  html += kalenderStreifenHtml(state);

  return html;
}

function formatZahl0(n) {
  return Math.round(n).toLocaleString('de-DE');
}

// ------------------------------------------------------------
// URL-Routing — das Rechnen steckt in route.js (Node-getestet), hier nur
// das Anwenden auf den UI-Zustand und das Setzen der Adresse.
//
// Bewusst replaceState statt neuer History-Einträge: Der Zurück-Knopf verlässt
// die App wie bisher, statt sich erst durch jeden Tab-Wechsel zurückzuarbeiten.
// Wer Tab-Wechsel in der History haben will, tauscht das hier gegen pushState.
// ------------------------------------------------------------

let routeSchreibt = false;   // verhindert, dass unser eigenes Setzen zurückschlägt

/** Route auf den UI-Zustand anwenden. */
function wendeRouteAn(hash) {
  const z = routeParsen(hash, MODUL_TABS);
  unterseite = z.unterseite;
  tab = z.tab;
  if (z.modul) aktivesModul = z.modul;
  if (z.unterseite === 'kalender') kalenderAnker = heuteIso();
}

/** Adresse nachziehen, ohne die History vollzumüllen. */
function schreibeRoute() {
  const neu = routeVonZustand({ unterseite, tab, modul: aktivesModul });
  if (location.hash === neu) return;
  routeSchreibt = true;
  history.replaceState(null, '', location.pathname + location.search + neu);
  routeSchreibt = false;
}

window.addEventListener('hashchange', () => {
  if (routeSchreibt) return;    // von uns selbst ausgelöst
  wendeRouteAn(location.hash);
  render();
});

function render() {
  schreibeRoute();
  const navInhalt = navHtml();
  nav.innerHTML = navInhalt;
  // Ohne untere Navi (Dashboard) den Platz voll nutzen.
  document.body.classList.toggle('ohne-navi', navInhalt === '');

  // Unterseite (z.B. Daten) liegt über den Tabs, mit Zurück-Pfeil.
  if (unterseite === 'daten') {
    mainInner.innerHTML = unterseiteHtml('Daten & Backup', datenHtml(state));
    return;
  }
  if (unterseite === 'kalender') {
    mainInner.innerHTML = unterseiteHtml('Kalender', kalenderMonatHtml(state, kalenderAnker));
    return;
  }

  switch (tab) {
    case 'dashboard':
      mainInner.innerHTML = dashboardHtml();
      break;
    case 'heute':
      mainInner.innerHTML =
        aktives().instanz.heuteHtml();
      break;
    case 'plan':
      // Plan ist Kraft-spezifisch (Rad hat keinen Zyklus)
      mainInner.innerHTML = module.nach(KRAFT).instanz.planHtml();
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
  // Sicherheitsnetz: höchstens ein Snapshot pro Tag, direkt nach dem Laden —
  // also im Zustand VOR allem, was heute noch passiert. Schlägt es fehl
  // (Speicher voll), läuft die App trotzdem normal weiter.
  sichereSnapshot(state);
  wendeRouteAn(location.hash);   // Reload/Lesezeichen landet wieder dort, wo man war
  render();
} catch (err) {
  mainInner.innerHTML = `<div class="karte leer"><h2>Da klemmt was.</h2><p class="dim">${esc(err.message)}</p></div>`;
  console.error(err);
}
