// ============================================================
// components.js — generische UI-Bausteine
// Modul-unabhängig: weiß nichts über Kraft, Pläne oder Sessions.
// ============================================================

// ------------------------------------------------------------
// HTML-Escaping — IMMER für Nutzertext (Übungsnamen, Notizen …)
// ------------------------------------------------------------
export function esc(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ------------------------------------------------------------
// Datum hübsch: "Mi, 01.07."
// ------------------------------------------------------------
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export function formatDatum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WD[dt.getDay()]}, ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
}

// ------------------------------------------------------------
// Bottom-Sheet (Slide-up, Blur-Backdrop, Drag-to-close)
// Ein Sheet für die ganze App — Inhalt wird reingereicht.
// ------------------------------------------------------------
let sheetEl = null, backdropEl = null, dragStartY = null, dragDelta = 0;

function stelleSheetBereit() {
  if (sheetEl) return;
  backdropEl = document.createElement('div');
  backdropEl.className = 'sheet-backdrop';
  backdropEl.addEventListener('click', () => sheet.schliesse());

  sheetEl = document.createElement('div');
  sheetEl.className = 'sheet';
  sheetEl.innerHTML = '<div class="sheet-griff"><span></span></div><div class="sheet-inhalt"></div>';

  // Drag-to-close am Griff
  const griff = sheetEl.querySelector('.sheet-griff');
  griff.addEventListener('pointerdown', e => {
    dragStartY = e.clientY; dragDelta = 0;
    sheetEl.style.transition = 'none';
    griff.setPointerCapture(e.pointerId);
  });
  griff.addEventListener('pointermove', e => {
    if (dragStartY == null) return;
    dragDelta = Math.max(0, e.clientY - dragStartY);
    sheetEl.style.transform = `translateY(${dragDelta}px)`;
  });
  const ende = () => {
    if (dragStartY == null) return;
    sheetEl.style.transition = '';
    if (dragDelta > 90) sheet.schliesse();
    else sheetEl.style.transform = '';
    dragStartY = null;
  };
  griff.addEventListener('pointerup', ende);
  griff.addEventListener('pointercancel', ende);

  document.body.append(backdropEl, sheetEl);
}

export const sheet = {
  oeffne(html) {
    stelleSheetBereit();
    sheetEl.querySelector('.sheet-inhalt').innerHTML = html;
    sheetEl.style.transform = '';
    requestAnimationFrame(() => {
      backdropEl.classList.add('offen');
      sheetEl.classList.add('offen');
    });
    document.body.classList.add('sheet-auf'); // Navi ausblenden
  },
  /** Inhalt austauschen, ohne das Sheet zu schließen (z.B. nach Chip-Tap). */
  aktualisiere(html) {
    if (this.istOffen()) sheetEl.querySelector('.sheet-inhalt').innerHTML = html;
  },
  schliesse() {
    if (!sheetEl) return;
    backdropEl.classList.remove('offen');
    sheetEl.classList.remove('offen');
    sheetEl.style.transform = '';
    document.body.classList.remove('sheet-auf');
  },
  istOffen() {
    return !!sheetEl && sheetEl.classList.contains('offen');
  },
};

// ------------------------------------------------------------
// Bestätigungs-Dialog (schöner Ersatz für confirm()).
// Nutzung:  if (await bestaetige({ titel, text, jaText, gefahr })) { … }
// Gibt true bei Bestätigung, false bei Abbruch.
// ------------------------------------------------------------
let dialogEl = null, dialogBackdrop = null, dialogAufloesen = null;

function stelleDialogBereit() {
  if (dialogEl) return;
  dialogBackdrop = document.createElement('div');
  dialogBackdrop.className = 'dialog-backdrop';
  dialogBackdrop.addEventListener('click', () => schliesseDialog(false));

  dialogEl = document.createElement('div');
  dialogEl.className = 'dialog';
  document.body.append(dialogBackdrop, dialogEl);

  dialogEl.addEventListener('click', (e) => {
    // Schalter umschalten (nicht schließen)
    const sw = e.target.closest('.dlg-schalter');
    if (sw) { sw.classList.toggle('an'); return; }
    const btn = e.target.closest('[data-dlg]');
    if (!btn) return;
    const jaGeklickt = btn.dataset.dlg === 'ja';
    const schalterEl = dialogEl.querySelector('.dlg-schalter');
    const schalterAn = schalterEl ? schalterEl.classList.contains('an') : null;
    schliesseDialog(jaGeklickt, schalterAn);
  });
}

function schliesseDialog(ergebnis, schalterAn = null) {
  if (!dialogEl) return;
  dialogBackdrop.classList.remove('offen');
  dialogEl.classList.remove('offen');
  const auf = dialogAufloesen; dialogAufloesen = null;
  // Ohne Schalter: schlichtes true/false (Kompatibilität mit bestehenden Aufrufen).
  // Mit Schalter: { ok, schalter } als Objekt.
  if (auf) auf(schalterAn === null ? ergebnis : { ok: ergebnis, schalter: schalterAn });
}

export function bestaetige({ titel, text = '', jaText = 'OK', neinText = 'Abbrechen', gefahr = false, schalter = null } = {}) {
  stelleDialogBereit();
  dialogEl.innerHTML = `
    <h3>${esc(titel)}</h3>
    ${text ? `<p class="dialog-text">${esc(text)}</p>` : ''}
    ${schalter ? `<button class="dlg-schalter ${schalter.an ? 'an' : ''}" type="button">
      <span class="dlg-schalter-text">${esc(schalter.label)}</span>
      <span class="dlg-schalter-knopf"></span>
    </button>` : ''}
    <div class="dialog-knoepfe">
      ${neinText ? `<button class="knopf" data-dlg="nein">${esc(neinText)}</button>` : ''}
      <button class="knopf ${gefahr ? 'gefahr-voll' : 'primaer'}" data-dlg="ja">${esc(jaText)}</button>
    </div>`;
  requestAnimationFrame(() => {
    dialogBackdrop.classList.add('offen');
    dialogEl.classList.add('offen');
  });
  return new Promise(res => { dialogAufloesen = res; });
}

/** Kurzer Info-Dialog (nur OK). */
export function hinweis(titel, text = '') {
  return bestaetige({ titel, text, jaText: 'OK', neinText: '' }).then(() => {});
}
