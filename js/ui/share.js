// ============================================================
// share.js — eine Session als hübsche Bildkarte teilen.
// Reines Canvas (keine externe Lib). Web Share API mit
// Download-Fallback. Modul-unabhängig: bekommt fertige Daten.
// ============================================================

const FARBE = {
  bg: '#0C0D0E', karte: '#15171A', linie: 'rgba(255,255,255,0.10)',
  text: '#F2F5F3', dim: '#868D88', akzent: '#CDFD34',
};

/**
 * Zeichnet eine Session-Karte auf ein Canvas und gibt es zurück.
 * daten: {
 *   titel, datum, volumenText,
 *   zeilen: [{ name, detail }],            // Übungen mit Sätzen
 *   highlights: [{ name, text, pr }],      // optional
 *   notiz,                                 // optional
 * }
 */
export function zeichneKarte(daten) {
  const B = 3;                     // Skalierung für Schärfe (Retina)
  const breite = 500;
  const pad = 28;
  // Höhe dynamisch grob schätzen
  let h = 200 + daten.zeilen.length * 46
    + (daten.highlights?.length ? 30 + daten.highlights.length * 26 : 0)
    + (daten.rueckblick?.length ? 30 + daten.rueckblick.length * 26 : 0)
    + (daten.notiz ? 60 : 0) + 60;
  const hoehe = h;

  const c = document.createElement('canvas');
  c.width = breite * B; c.height = hoehe * B;
  const x = c.getContext('2d');
  x.scale(B, B);

  // Hintergrund
  x.fillStyle = FARBE.bg; x.fillRect(0, 0, breite, hoehe);
  // Karte
  rundRect(x, 12, 12, breite - 24, hoehe - 24, 22);
  x.fillStyle = FARBE.karte; x.fill();
  // Akzent-Schimmer oben rechts
  const grad = x.createRadialGradient(breite - 60, 10, 10, breite - 60, 10, 260);
  grad.addColorStop(0, 'rgba(205,253,52,0.16)'); grad.addColorStop(1, 'rgba(205,253,52,0)');
  x.fillStyle = grad; x.fillRect(12, 12, breite - 24, 180);

  let y = pad + 22;
  // Eyebrow links + Datum rechts auf einer Zeile (wie Gym-App)
  x.fillStyle = FARBE.akzent;
  x.font = '600 12px Sora, sans-serif';
  x.fillText('GOGADON · TRAINING', pad + 6, y);
  x.textAlign = 'right';
  x.fillStyle = FARBE.dim; x.font = '400 13px Sora, sans-serif';
  x.fillText(daten.datum, breite - pad - 6, y);
  x.textAlign = 'left';
  y += 32;
  // Titel — volle Breite, keine Kollision mehr
  x.fillStyle = FARBE.text;
  x.font = '800 30px "Bricolage Grotesque", sans-serif';
  x.fillText(daten.titel, pad + 4, y);
  y += 30;
  // Trainingsvolumen als eigene Zeile: Label + Wert nebeneinander
  x.fillStyle = FARBE.dim; x.font = '600 11px Sora, sans-serif';
  x.fillText('TRAININGSVOLUMEN', pad + 6, y);
  x.textAlign = 'right';
  x.fillStyle = FARBE.akzent; x.font = '800 24px "Bricolage Grotesque", sans-serif';
  x.fillText(daten.volumenText, breite - pad - 6, y + 2);
  x.textAlign = 'left';
  y += 24;

  // Trennlinie
  linie(x, pad, y, breite - pad, y); y += 24;

  // Übungen
  x.font = '400 15px Sora, sans-serif';
  for (const z of daten.zeilen) {
    x.fillStyle = FARBE.text; x.font = '600 15px Sora, sans-serif';
    x.fillText(kurz(z.name, 34), pad + 4, y);
    y += 20;
    x.fillStyle = FARBE.dim; x.font = '400 13px Sora, sans-serif';
    x.fillText(kurz(z.detail, 46), pad + 4, y);
    y += 26;
  }

  // Highlights
  if (daten.highlights?.length) {
    y += 6; linie(x, pad, y, breite - pad, y); y += 24;
    x.fillStyle = FARBE.akzent; x.font = '600 12px Sora, sans-serif';
    x.fillText('HIGHLIGHTS', pad + 4, y); y += 24;
    for (const hl of daten.highlights) {
      x.font = '15px Sora, sans-serif';
      x.fillStyle = FARBE.text;
      const icon = hl.pr ? '🎉 ' : '↑ ';
      x.fillText(kurz(icon + hl.name, 30), pad + 4, y);
      x.fillStyle = FARBE.akzent; x.textAlign = 'right';
      x.font = '600 14px Sora, sans-serif';
      x.fillText(hl.text, breite - pad - 6, y);
      x.textAlign = 'left';
      y += 26;
    }
  }

  // Tagesrückblick (gebündelte Kennzahlen)
  if (daten.rueckblick?.length) {
    y += 6; linie(x, pad, y, breite - pad, y); y += 24;
    x.fillStyle = FARBE.akzent; x.font = '600 12px Sora, sans-serif';
    x.fillText('TAGESRÜCKBLICK', pad + 4, y); y += 24;
    for (const r of daten.rueckblick) {
      x.fillStyle = FARBE.text; x.font = '15px Sora, sans-serif';
      x.fillText(kurz(`${r.icon}  ${r.text}`, 40), pad + 4, y);
      y += 26;
    }
  }

  // Notiz
  if (daten.notiz) {
    y += 6; linie(x, pad, y, breite - pad, y); y += 22;
    x.fillStyle = FARBE.dim; x.font = 'italic 13px Sora, sans-serif';
    for (const zeile of umbrechen(daten.notiz, 52).slice(0, 2)) {
      x.fillText(zeile, pad + 4, y); y += 20;
    }
  }

  return c;
}

/** Karte teilen (Web Share API) oder als PNG herunterladen. */
export async function teileKarte(daten, dateiname = 'training.png') {
  const canvas = zeichneKarte(daten);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Bild konnte nicht erzeugt werden.');
  const file = new File([blob], dateiname, { type: 'image/png' });

  // Erst Web Share (Handy: WhatsApp, Mail, …)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: daten.titel });
      return 'geteilt';
    } catch (err) {
      if (err.name === 'AbortError') return 'abgebrochen';
      // sonst: Fallback Download
    }
  }
  // Fallback: Download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = dateiname; a.click();
  URL.revokeObjectURL(url);
  return 'heruntergeladen';
}

// --- Helfer ---
function rundRect(x, px, py, w, h, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}
function linie(x, x1, y1, x2, y2) {
  x.strokeStyle = FARBE.linie; x.lineWidth = 1;
  x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
}
function kurz(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function umbrechen(s, n) {
  const worte = String(s).split(/\s+/); const zeilen = []; let z = '';
  for (const w of worte) {
    if ((z + ' ' + w).trim().length > n) { if (z) zeilen.push(z); z = w; }
    else z = (z + ' ' + w).trim();
  }
  if (z) zeilen.push(z);
  return zeilen;
}
