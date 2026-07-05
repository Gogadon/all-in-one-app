// ============================================================
// app.js — PLATZHALTER (wird in Etappe 1, Schritt 3 ersetzt)
//
// Zweck jetzt: Live-Beweis, dass auf GitHub Pages alles steht —
// ES-Module laden, Kern importierbar, localStorage funktioniert.
// ============================================================

import { load, save, SCHEMA_VERSION } from './core/storage.js';
import { MESSWERTE } from './core/metrics.js';

const main = document.getElementById('main');

try {
  const state = await load();
  await save(state); // einmal Runde drehen → Speichern funktioniert nachweislich

  main.innerHTML = `
    <div class="status-card anim">
      <span class="eyebrow"><span class="pip"></span>Fundament</span>
      <h1>Läuft. ✅</h1>
      <p>
        ES-Module geladen · Speicher OK (Schema ${SCHEMA_VERSION})<br>
        ${Object.keys(MESSWERTE).length} Messwert-Typen registriert ·
        ${state.sessions.length} Sessions · ${state.bibliothek.length} Aktivitäten
      </p>
    </div>`;
} catch (err) {
  main.innerHTML = `
    <div class="status-card anim">
      <span class="eyebrow"><span class="pip"></span>Fundament</span>
      <h1>Da klemmt was.</h1>
      <p class="fehler">${err.message}</p>
    </div>`;
  console.error(err);
}
