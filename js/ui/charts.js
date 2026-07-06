// ============================================================
// charts.js — winzige SVG-Diagramme, reines Vanilla (keine Lib).
// Alles gibt fertigen SVG-String zurück → passt in innerHTML.
// ============================================================

/** Zahl fürs SVG (Punkt statt Komma, gerundet). */
function n(x) { return Math.round(x * 100) / 100; }

/**
 * Sparkline (Linie mit Punkten) aus Werten.
 * werte: Array Zahlen (chronologisch). farbe: Hex. Optional letzterHervor.
 */
export function sparkline(werte, { farbe = '#CDFD34', breite = 300, hoehe = 64, pad = 8 } = {}) {
  const gute = werte.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (gute.length === 0) return leeresSvg(breite, hoehe);
  if (gute.length === 1) {
    // ein Punkt → Mittelpunkt
    const cx = breite / 2, cy = hoehe / 2;
    return `<svg viewBox="0 0 ${breite} ${hoehe}" class="spark" preserveAspectRatio="none">
      <circle cx="${cx}" cy="${cy}" r="3.5" fill="${farbe}"/></svg>`;
  }
  const min = Math.min(...gute), max = Math.max(...gute);
  const spanne = max - min || 1;
  const iw = breite - pad * 2, ih = hoehe - pad * 2;
  const punkte = gute.map((v, i) => {
    const x = pad + (i / (gute.length - 1)) * iw;
    const y = pad + ih - ((v - min) / spanne) * ih;
    return [n(x), n(y)];
  });
  const linie = punkte.map(p => p.join(',')).join(' ');
  // Fläche unter der Linie (dezent)
  const flaeche = `${pad},${n(hoehe - pad)} ${linie} ${n(breite - pad)},${n(hoehe - pad)}`;
  const letzter = punkte[punkte.length - 1];
  return `<svg viewBox="0 0 ${breite} ${hoehe}" class="spark" preserveAspectRatio="none">
    <polygon points="${flaeche}" fill="${farbe}" opacity="0.10"/>
    <polyline points="${linie}" fill="none" stroke="${farbe}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${letzter[0]}" cy="${letzter[1]}" r="3.5" fill="${farbe}"/>
  </svg>`;
}

/**
 * Balkendiagramm (z.B. Wochenvolumen). werte chronologisch, letzter hervorgehoben.
 * labels optional (unter den Balken).
 */
export function balken(werte, { farbe = '#CDFD34', breite = 300, hoehe = 90, labels = null, pad = 8 } = {}) {
  const gute = werte.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : 0));
  if (gute.length === 0 || gute.every(v => v === 0)) return leeresSvg(breite, hoehe);
  const max = Math.max(...gute) || 1;
  const labelPlatz = labels ? 16 : 0;
  const iw = breite - pad * 2, ih = hoehe - pad * 2 - labelPlatz;
  const bw = iw / gute.length;
  const balkenBreite = Math.min(bw * 0.6, 34);
  let svg = `<svg viewBox="0 0 ${breite} ${hoehe}" class="bars" preserveAspectRatio="none">`;
  gute.forEach((v, i) => {
    const h = (v / max) * ih;
    const x = pad + i * bw + (bw - balkenBreite) / 2;
    const y = pad + ih - h;
    const letzter = i === gute.length - 1;
    svg += `<rect x="${n(x)}" y="${n(y)}" width="${n(balkenBreite)}" height="${n(Math.max(h, 1))}"
      rx="3" fill="${farbe}" opacity="${letzter ? 1 : 0.35}"/>`;
    if (labels && labels[i] != null) {
      svg += `<text x="${n(x + balkenBreite / 2)}" y="${n(hoehe - 4)}" text-anchor="middle"
        font-size="9" fill="#868D88" font-family="sans-serif">${labels[i]}</text>`;
    }
  });
  return svg + '</svg>';
}

function leeresSvg(breite, hoehe) {
  return `<svg viewBox="0 0 ${breite} ${hoehe}" class="spark leer" preserveAspectRatio="none">
    <line x1="8" y1="${hoehe / 2}" x2="${breite - 8}" y2="${hoehe / 2}"
      stroke="#2A2E32" stroke-width="1.5" stroke-dasharray="3 4"/></svg>`;
}

/** Trend zwischen erstem und letztem Wert: {richtung, prozent, text}. */
export function trend(werte, { einheit = '', hoeherBesser = true } = {}) {
  const gute = werte.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (gute.length < 2) return { richtung: 'flat', prozent: 0, text: 'zu wenig Daten' };
  const erst = gute[0], letzt = gute[gute.length - 1];
  const diff = letzt - erst;
  const prozent = erst !== 0 ? Math.round((diff / Math.abs(erst)) * 100) : 0;
  let richtung = 'flat';
  if (diff > 0) richtung = hoeherBesser ? 'up' : 'down';
  else if (diff < 0) richtung = hoeherBesser ? 'down' : 'up';
  const pfeil = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  const vz = diff > 0 ? '+' : '';
  const text = diff === 0 ? 'unverändert'
    : `${vz}${n(diff)}${einheit ? ' ' + einheit : ''} ${pfeil}`;
  return { richtung, prozent, text, diff };
}
