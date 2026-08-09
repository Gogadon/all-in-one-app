// ============================================================
// modules/kraft/fortschritt-ansicht.js — der Fortschritt-Bereich.
//
// Wochenvolumen als Balken, dazu pro Übung eine Kurve mit den letzten
// Bestwerten — gruppiert nach den Einheiten des Plans.
// ============================================================

import { formatZahl } from '../../core/metrics.js';
import { findeAktivitaet } from '../../core/model.js';
import { einheitenBibliothek, naechsteEinheit } from '../../core/plan.js';
import { sparkline, balken, trend } from '../../ui/charts.js';
import { MODUL, fortschrittsSerie, wochenVolumen } from './logik.js';

export function erstelleFortschrittAnsicht(k) {
  const { S, esc, formatDatum, offen, zu, progExpand, progGruppeAuf, progGruppeZu, ui, heutigeSession } = k;


  function fortschrittHtml() {
    let html = `<div class="tab-kopf anim"><span class="eyebrow"><span class="pip"></span>Kraft</span><h1>Fortschritt</h1></div>`;

    // Wochenvolumen (gesamt)
    const wv = wochenVolumen(S(), { wochen: 6 });
    if (wv.werte.length) {
      const t = trend(wv.werte, { einheit: 'kg', hoeherBesser: true });
      const labels = wv.wochen.map(w => 'KW' + w.slice(-2));
      html += `<div class="karte anim">
        <div class="prog-kopf">
          <div><small class="dim">Wochenvolumen</small>
            <div class="prog-jetzt">${formatZahl(wv.werte.at(-1), 0)} <small>kg</small></div></div>
          <span class="prog-trend ${t.richtung}">${esc(t.text)}</span>
        </div>
        ${balken(wv.werte, { farbe: '#CDFD34', labels, breite: 320, hoehe: 92 })}
      </div>`;
    }

    // Metrik-Umschalter (3 Metriken)
    html += `<div class="chip-zeile" style="margin:16px 2px 4px">
      <button class="chip ${ui.progMetrik === 'gewicht' ? 'aktiv' : ''}" data-action="k.ui.progMetrik" data-m="gewicht">Top-Gewicht</button>
      <button class="chip ${ui.progMetrik === 'avg' ? 'aktiv' : ''}" data-action="k.ui.progMetrik" data-m="avg">Ø-Gewicht</button>
      <button class="chip ${ui.progMetrik === 'volumen' ? 'aktiv' : ''}" data-action="k.ui.progMetrik" data-m="volumen">Volumen</button>
    </div>`;

    // Wert + Anzeigetext je nach gewählter Metrik
    const wertVon = p => ui.progMetrik === 'volumen' ? p.vol : ui.progMetrik === 'avg' ? p.avgKg : p.topKg;
    const textVon = p => {
      if (ui.progMetrik === 'volumen') return `${formatZahl(p.vol, 0)} kg`;
      if (ui.progMetrik === 'avg') return `${formatZahl(p.avgKg)} kg`;
      return `${formatZahl(p.topKg)} kg${p.wdhBeiTop != null ? ` × ${formatZahl(p.wdhBeiTop, 0)}` : ''}`;
    };

    // Eine Übungskarte bauen (oder '' wenn keine Historie).
    const karteFuer = akt => {
      const serie = fortschrittsSerie(S(), akt.id, { limit: 999 });
      if (serie.length === 0) return '';
      const assistiert = !!akt.einstellungen?.assist;
      const werte = serie.map(wertVon);
      const letzterP = serie.at(-1);
      const t = trend(werte, { einheit: 'kg', hoeherBesser: true });
      const mitRauf = serie.map((p, idx) => ({ ...p, rauf: idx > 0 && wertVon(p) > wertVon(serie[idx - 1]) }));
      const rueck = [...mitRauf].reverse();
      const offen = progExpand.has(akt.id);
      const sichtbar = offen ? rueck : rueck.slice(0, 5);
      const zeilen = sichtbar.map(p => `<div class="verlauf-zeile2">
          <span class="dim datum">${esc(formatDatum(p.datum))}</span>
          <span class="wert ${p.rauf ? 'rauf' : ''}">${esc(textVon(p))}${p.rauf ? ' ↑' : ''}</span>
          <span class="dim saetze">${esc(p.saetze.join(', '))}</span>
        </div>`).join('');
      const mehr = rueck.length > 5
        ? `<button class="knopf klein geist voll" data-action="k.progExpand" data-akt="${akt.id}">${offen ? 'Weniger anzeigen ⌃' : `Alle ${rueck.length} anzeigen ⌄`}</button>`
        : '';
      return `<div class="karte prog-karte anim">
        <div class="prog-kopf">
          <div><strong>${esc(akt.name)}</strong>${assistiert ? ' <span class="dim">· assistiert</span>' : ''}
            <div class="prog-jetzt">${esc(textVon(letzterP))}</div></div>
          <span class="prog-trend ${t.richtung}">${serie.length > 1 ? esc(t.text) : 'erste Session'}</span>
        </div>
        ${sparkline(werte, { farbe: '#CDFD34', breite: 320, hoehe: 60 })}
        <div class="verlauf-liste2">${zeilen}</div>
        ${mehr}
      </div>`;
    };

    // Nach Einheiten gruppieren: jede Übung erscheint unter ihrer ersten Einheit.
    // Gruppen sind aufklappbar; die HEUTE fällige Einheit ist standardmäßig offen.
    const einheiten = einheitenBibliothek(S(), MODUL);
    const heute = naechsteEinheit(S(), MODUL);
    const schonGezeigt = new Set();

    // Ist die Gruppe offen? Heute-Einheit offen, außer manuell zugeklappt;
    // andere zu, außer manuell aufgeklappt.
    const gruppeOffen = (eid) => eid === heute?.id
      ? !progGruppeZu.has(eid)
      : progGruppeAuf.has(eid);

    const gruppeHtml = (id, titel, kartenInner, anzahl) => {
      const offen = gruppeOffen(id);
      const heuteMark = id === heute?.id ? ' <span class="dim">· heute</span>' : '';
      return `<button class="prog-gruppe ${offen ? 'auf' : ''}" data-action="k.progGruppe" data-eid="${esc(id)}">
          <span class="gruppe-titel2">${esc(titel)}${heuteMark}</span>
          <span class="gruppe-meta">${anzahl} <span class="pfeil">${offen ? '⌃' : '⌄'}</span></span>
        </button>${offen ? `<div class="gruppe-inhalt">${kartenInner}</div>` : ''}`;
    };

    let gruppen = '';
    for (const einheit of einheiten) {
      let kartenInGruppe = '', n = 0;
      for (const vorlage of einheit.segmente) {
        const akt = findeAktivitaet(S(), vorlage.aktivitaetId);
        if (!akt || akt.kategorie !== 'kraft' || schonGezeigt.has(akt.id)) continue;
        const karte = karteFuer(akt);
        if (karte) { kartenInGruppe += karte; schonGezeigt.add(akt.id); n++; }
      }
      if (kartenInGruppe) gruppen += gruppeHtml(einheit.id, einheit.name, kartenInGruppe, n);
    }

    // Übungen ohne Einheit → „Weitere" (immer aufklappbar, nie automatisch offen)
    let weitere = '', wn = 0;
    for (const akt of S().bibliothek) {
      if (akt.kategorie !== 'kraft' || schonGezeigt.has(akt.id)) continue;
      const karte = karteFuer(akt);
      if (karte) { weitere += karte; schonGezeigt.add(akt.id); wn++; }
    }
    if (weitere) gruppen += gruppeHtml('__weitere__', 'Weitere', weitere, wn);

    html += gruppen || `<div class="karte leer anim"><p>Noch keine abgeschlossenen Kraft-Sessions. Sobald du Übungen abhakst, erscheint hier dein Verlauf.</p></div>`;
    return html;
  }


  return { fortschrittHtml };
}
