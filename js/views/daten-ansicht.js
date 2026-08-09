// ============================================================
// views/daten-ansicht.js — die Unterseite „Daten & Backup".
//
// Reine Darstellung: baut HTML aus dem Zustand. Das eigentliche Ein- und
// Auslesen (Datei einlesen, Snapshot laden, zurücksetzen) bleibt in app.js,
// weil es den Zustand ersetzt — das ist Steuerung, keine Anzeige.
// ============================================================

import { esc, formatDatum } from '../ui/components.js';
import { snapshots, tageSeitExport, brauchtExportErinnerung, MAX_SNAPSHOTS } from '../core/storage.js';

/** „vor 3 Tagen" / „heute" / „noch nie" — für die Export-Zeile. */
export function exportStatusText(state) {
  const tage = tageSeitExport(state);
  if (tage == null) return 'Noch nie als Datei exportiert';
  if (tage === 0) return 'Zuletzt exportiert: heute';
  if (tage === 1) return 'Zuletzt exportiert: gestern';
  return `Zuletzt exportiert: vor ${tage} Tagen`;
}

export function datenHtml(state) {
  const punkte = snapshots();
  const warnen = brauchtExportErinnerung(state);

  let html = `<div class="tab-kopf anim"><span class="eyebrow"><span class="pip"></span>Backup & Speicher</span><h1>Daten</h1></div>
    <div class="karte anim">
      <p class="dim">${state.sessions.length} Sessions · ${state.bibliothek.length} Übungen/Aktivitäten</p>
      <p class="dim ${warnen ? 'export-alt' : ''}">${esc(exportStatusText(state))}</p>
      <div class="knopf-zeile">
        <button class="knopf primaer" data-action="daten.export">Backup exportieren</button>
        <button class="knopf" data-action="daten.import">Backup importieren</button>
      </div>
      <input type="file" id="importDatei" accept=".json,application/json" hidden data-change="daten.datei">
    </div>`;

  // Automatische Tages-Snapshots — Rettung bei versehentlichem Löschen.
  html += `<p class="sheet-abschnitt zwischen">Wiederherstellungspunkte</p>`;
  if (punkte.length) {
    html += punkte.map(p => `<div class="karte anim snap-zeile">
      <div>
        <strong>${esc(formatDatum(p.datum))}</strong>${p.grund ? ` <span class="dim klein-text">· ${esc(p.grund)}</span>` : ''}<br>
        <small class="dim">${p.sessions} Sessions · ${p.uebungen} Übungen</small>
      </div>
      <button class="knopf klein" data-action="daten.snapshot" data-marke="${esc(p.erstelltAm)}">Laden</button>
    </div>`).join('');
  } else {
    html += `<div class="karte leer anim"><p>Noch keine Punkte. Die App legt beim Öffnen automatisch einen pro Tag an.</p></div>`;
  }
  html += `<p class="dim bib-hinweis">Automatisch, die letzten ${MAX_SNAPSHOTS} Tage. Liegt auf diesem Gerät — schützt vor versehentlichem Löschen, aber <strong>nicht</strong> vor Handy-Wechsel oder gelöschten Browserdaten. Dafür der Datei-Export oben.</p>`;

  html += `<div class="karte anim">
      <p class="dim">Alles auf Anfang — löscht sämtliche Daten dieser App auf diesem Gerät.</p>
      <button class="knopf gefahr" data-action="daten.reset">Alles zurücksetzen</button>
    </div>`;
  return html;
}
