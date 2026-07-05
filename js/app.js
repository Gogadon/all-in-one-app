// ============================================================
// app.js — Einstieg & Schale
// Lädt den Zustand, rendert Navi + aktiven Tab und leitet alle
// Klicks/Änderungen über data-action / data-change an die
// registrierten Aktionen weiter (Module bringen ihre eigenen mit).
// ============================================================

import { load, save, exportBackup, importBackup, leererZustand } from './core/storage.js';
import { formatZahl } from './core/metrics.js';
import { heuteIso, findeAktivitaet, sessionKategorien } from './core/model.js';
import { findeEinheit } from './core/plan.js';
import { esc, formatDatum, sheet } from './ui/components.js';
import {
  erstelleKraftModul, MODUL as KRAFT,
  sessionVolumenErledigt, segmentZusammenfassungKraft, segmentZusammenfassungWerte,
} from './modules/kraft.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');

// Feste Grundstruktur im Scroll-Container: Reload-Indikator + Inhaltsbereich.
main.innerHTML = `<div id="ptr" class="ptr"><span class="ptr-spinner"></span></div><div class="main-inner" id="mainInner"></div>`;
const mainInner = document.getElementById('mainInner');
const ptr = document.getElementById('ptr');

let state = null;
let tab = 'heute';

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

// ------------------------------------------------------------
// Aktionen: App-eigene + Modul-Aktionen in einem Register
// ------------------------------------------------------------
const actions = {
  'tab'(d) { tab = d.tab; sheet.schliesse(); render(); window.scrollTo(0, 0); },

  'daten.export'() {
    const blob = new Blob([exportBackup(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gogadon-backup-${heuteIso()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  'daten.import'() { document.getElementById('importDatei')?.click(); },
  async 'daten.reset'() {
    if (!confirm('Wirklich ALLES löschen? Ein Backup vorher wäre klug.')) return;
    if (!confirm('Letzte Chance — alle Sessions, Pläne und Übungen werden entfernt.')) return;
    state = leererZustand();
    await ctx.save(); render();
  },

  ...kraft.actions,
};

// Klicks: nächstes Element mit data-action suchen und ausführen
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el.dataset, el, e);
});

// Eingaben: data-change feuert bei „change" (Verlassen des Felds)
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  if (el.id === 'importDatei') return importiereDatei(el);
  const fn = actions[el.dataset.change];
  if (fn) fn(el.dataset, el, e);
});

// ------------------------------------------------------------
// Tabs
// ------------------------------------------------------------
const TABS = [
  { id: 'heute',   label: 'Heute',   icon: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M2.5 9.5v5M21.5 9.5v5M6.5 12h11"/></svg>' },
  { id: 'plan',    label: 'Plan',    icon: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>' },
  { id: 'verlauf', label: 'Verlauf', icon: '<svg viewBox="0 0 24 24"><path d="M12 8v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z"/></svg>' },
  { id: 'daten',   label: 'Daten',   icon: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>' },
];

function navHtml() {
  return TABS.map(t =>
    `<button class="nav-tab ${tab === t.id ? 'aktiv' : ''}" data-action="tab" data-tab="${t.id}">
      ${t.icon}<span>${t.label}</span>
    </button>`).join('');
}

// ------------------------------------------------------------
// Verlauf-Tab (modulübergreifender Feed — Phase 1: nur Kraft da)
// ------------------------------------------------------------
function verlaufHtml() {
  const sessions = [...state.sessions].sort((a, b) => b.datum.localeCompare(a.datum));
  let html = `<div class="tab-kopf anim"><span class="eyebrow"><span class="pip"></span>Alle Aktivitäten</span><h1>Verlauf</h1></div>`;
  if (!sessions.length) {
    return html + `<div class="karte leer anim"><p>Noch keine Sessions. Deine erste startest du im Heute-Tab.</p></div>`;
  }
  html += sessions.map(s => {
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
      alert('Backup importiert. ✓');
      render();
    } catch (err) {
      alert(err.message);
    }
  };
  leser.readAsText(datei);
  input.value = '';
}

// ------------------------------------------------------------
// Render & Start
// ------------------------------------------------------------
function render() {
  nav.innerHTML = navHtml();
  switch (tab) {
    case 'heute':   mainInner.innerHTML = kraft.heuteHtml(); break;
    case 'plan':    mainInner.innerHTML = kraft.planHtml(); break;
    case 'verlauf': mainInner.innerHTML = verlaufHtml(); break;
    case 'daten':   mainInner.innerHTML = datenHtml(); break;
  }
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
    // Nur starten, wenn ganz oben und Sheet zu
    if (main.scrollTop <= 0 && !document.body.classList.contains('sheet-auf')) {
      startY = e.touches[0].clientY; aktiv = true; zug = 0;
    } else { aktiv = false; }
  }, { passive: true });

  main.addEventListener('touchmove', e => {
    if (!aktiv || startY == null) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) { zug = 0; ptr.style.height = '0px'; ptr.classList.remove('bereit'); return; }
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
