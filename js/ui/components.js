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
