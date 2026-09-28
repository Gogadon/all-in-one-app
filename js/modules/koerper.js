// ============================================================
// koerper.js (Modul) — der Körper-Tab: Werte eintragen und den Verlauf sehen.
//
// Dünne Schicht über core/koerper.js: Hier passiert nur Darstellung und
// Eingabe, gerechnet wird im Kern. Anders als Kraft/Rad/… gibt es keine
// Sessions — eine Messung ist ein Zustand, kein Training.
//
// Das Eingabeformular steht fest auf der Seite (kein Bottom-Sheet): Man kommt
// von der Waage und will sofort tippen, ohne vorher etwas aufzuklappen.
// ============================================================

import {
  KOERPER_WERTE, standardWerte, formatKoerperWert,
  messungen, messungAmTag, verlauf, letzterWert, veraenderung,
  setzeMessung, entferneMessung,
  KOERPER_ZEITRAEUME, koerperZeitraum, setzeKoerperZeitraum, zeitraumAb, veraenderungAb,
} from '../core/koerper.js';
import { parseZahl, formatZahl, formatZahlEingabe } from '../core/metrics.js';
import { heuteIso } from '../core/model.js';
import { sparkline } from '../ui/charts.js';
import { bestaetige, hinweis } from '../ui/components.js';

export const MODUL = 'koerper';
const AKZENT = 'var(--koerper)';

export function erstelleKoerperModul(ctx) {
  const S = () => ctx.state;
  const esc = ctx.esc;

  // Entwurf der Eingabe (nicht persistiert). `felder` = welche Zeilen sichtbar
  // sind; Standard sind Gewicht + Körperfett, weitere kommen per Chip dazu.
  let entwurf = null;

  function frischerEntwurf() {
    const datum = heuteIso();
    const vorhanden = messungAmTag(S(), datum);
    // Schon heute gemessen? Dann die vorhandenen Werte zum Ergänzen anzeigen.
    const felder = [...new Set([...standardWerte(), ...Object.keys(vorhanden?.werte ?? {})])];
    return { datum, werte: { ...(vorhanden?.werte ?? {}) }, felder };
  }
  function entwurfHolen() {
    if (!entwurf) entwurf = frischerEntwurf();
    return entwurf;
  }

  async function speichernUndZeigen() { await ctx.save(); ctx.render(); }

  // ----------------------------------------------------------
  // Ansicht
  // ----------------------------------------------------------

  function heuteHtml() {
    const d = entwurfHolen();
    let html = `<div class="koerper" style="--akzent:${AKZENT}">
      <div class="tab-kopf anim">
        <span class="eyebrow"><span class="pip koerper"></span>Körper</span>
        <h1>Werte</h1>
      </div>`;

    html += kennzahlenHtml();
    html += eingabeHtml(d);
    html += verlaufListeHtml();

    return html + `</div>`;
  }

  /** Die Änderung als farbige Zahl: „−1,2 kg". */
  function trendZahl(def, diff) {
    // Färbung nach Richtung: „gut" hängt vom Wert ab (Gewicht runter,
    // Muskelmasse hoch). Ohne Richtung bleibt es neutral.
    const besser = def.richtung === 'hoch' ? diff > 0
      : def.richtung === 'runter' ? diff < 0 : null;
    const klasse = diff === 0 ? 'gleich' : besser === true ? 'gut' : besser === false ? 'schlecht' : '';
    const vor = diff > 0 ? '+' : '';
    return `<span class="kw-trend ${klasse}">${vor}${formatZahl(diff, def.dezimal ?? 1)}${def.einheit ? ' ' + def.einheit : ''}</span>`;
  }

  /** „in den letzten 30 Tagen" / „in 30 Tagen" — ohne „letzten 1 Jahr". */
  function zeitraumWorte(z) {
    if (z.tage === 365) return { lang: 'im letzten Jahr', kurz: 'in 1 Jahr' };
    if (z.tage === 1) return { lang: 'seit gestern', kurz: 'seit gestern' };
    return { lang: `in den letzten ${z.tage} Tagen`, kurz: `in ${z.tage} Tagen` };
  }

  /**
   * Umschalter über den Karten. Schaltet alle Karten gleichzeitig um —
   * und nur die Karten: Eingabe und Verlaufsliste bleiben, wie sie sind.
   */
  function zeitraumHtml(z) {
    const chips = KOERPER_ZEITRAEUME.map(({ art, label }) =>
      `<button class="chip ${z.art === art ? 'aktiv' : ''}" data-action="koerper.zeitraum" data-art="${art}" aria-pressed="${z.art === art}">${esc(label)}</button>`).join('');
    const eigene = z.art !== 'eigene' ? '' : `<label class="kw-eigene">
        <input type="number" inputmode="numeric" min="1" max="3650" step="1"
          value="${z.eigeneTage}" data-change="koerper.eigeneTage" data-einzeln aria-label="Tage zurück">
        <span class="dim">Tage zurück</span>
      </label>`;
    return `<div class="chip-zeile kw-zeitraum anim">${chips}</div>${eigene}`;
  }

  /** Große Zahlen oben: aktueller Stand je Standardwert + Trend. */
  function kennzahlenHtml() {
    const z = koerperZeitraum(S());
    const ab = zeitraumAb(z);

    const karten = standardWerte().map(typ => {
      // Die große Zahl ist IMMER der aktuelle Stand — auch wenn im gewählten
      // Zeitraum gar nicht gemessen wurde. Der Zeitraum schneidet nur Kurve
      // und Trend zu.
      const letzte = letzterWert(S(), typ);
      if (!letzte) return '';
      const punkte = verlauf(S(), typ, { ab }).map(p => p.wert);
      const def = KOERPER_WERTE[typ];

      let trend;
      if (ab == null) {
        // Gesamt: genau wie vor dem Umschalter — Vergleich zur Messung davor.
        const v = veraenderung(S(), typ);
        trend = v
          ? `${trendZahl(def, v.diff)}
          <span class="dim">seit ${esc(ctx.formatDatum(v.seit))}</span>`
          : '<span class="dim">erste Messung</span>';
      } else {
        // Zeitraum: erster gegen letzten Wert darin. Sonst stünde neben einer
        // Jahreskurve eine Zahl von vorgestern.
        const v = veraenderungAb(S(), typ, ab);
        const { lang, kurz } = zeitraumWorte(z);
        trend = v.anzahl === 0 ? `<span class="dim">Keine Messung ${lang}</span>`
          : v.diff == null ? `<span class="dim">Nur eine Messung ${lang}</span>`
          : `${trendZahl(def, v.diff)}
          <span class="dim">${kurz}</span>`;
      }

      return `<div class="karte kw-karte anim">
        <div class="kw-kopf">
          <span class="kw-label dim">${esc(def.label)}</span>
          <span class="kw-wert">${esc(formatKoerperWert(typ, letzte.wert))}</span>
          <div class="kw-zeile">${trend}</div>
        </div>
        ${punkte.length > 1 ? `<div class="kw-spark">${sparkline(punkte, { farbe: '#6FBFB0', breite: 300, hoehe: 54 })}</div>` : ''}
      </div>`;
    }).filter(Boolean).join('');

    if (!karten) {
      return `<div class="karte leer anim"><p>Noch keine Werte. Trag unten deine erste Messung ein — Gewicht reicht für den Anfang. ⚖️</p></div>`;
    }
    return zeitraumHtml(z) + karten;
  }

  /** Eingabeformular: Datum + Wertezeilen + Chips für weitere Werte. */
  function eingabeHtml(d) {
    const zeilen = d.felder.map(typ => {
      const def = KOERPER_WERTE[typ];
      const roh = d.werte[typ];
      const wert = roh == null ? '' : formatZahlEingabe(roh, def.dezimal ?? 1);
      const abwaehlbar = !def.standard;
      return `<div class="kw-feld">
        <label>${esc(def.label)}</label>
        <div class="kw-feld-eingabe">
          <input type="text" inputmode="decimal" value="${esc(wert)}"
            placeholder="${esc(def.platzhalter ?? '')}"
            data-change="koerper.wert" data-typ="${typ}">
          ${def.einheit ? `<span class="einheit">${esc(def.einheit)}</span>` : ''}
          ${abwaehlbar ? `<button class="feld-weg" data-action="koerper.feldWeg" data-typ="${typ}">✕</button>` : ''}
        </div>
      </div>`;
    }).join('');

    const rest = Object.keys(KOERPER_WERTE).filter(t => !d.felder.includes(t));
    const chips = rest.length
      ? `<p class="sheet-abschnitt zwischen">Mehr Werte</p>
         <div class="chip-zeile">${rest.map(t =>
           `<button class="chip" data-action="koerper.feldPlus" data-typ="${t}">+ ${esc(KOERPER_WERTE[t].label)}</button>`).join('')}</div>`
      : '';

    return `<p class="sheet-abschnitt zwischen">Messung eintragen</p>
      <div class="karte kw-eingabe">
        <div class="kw-feld">
          <label>Datum</label>
          <div class="kw-feld-eingabe">
            <input type="date" value="${esc(d.datum)}" data-change="koerper.datum">
          </div>
        </div>
        ${zeilen}
      </div>
      ${chips}
      <button class="knopf primaer gross voll" data-action="koerper.speichern">Messung speichern ✓</button>`;
  }

  /** Verlauf als Liste, neueste zuerst. */
  function verlaufListeHtml() {
    const alle = messungen(S());
    if (!alle.length) return '';
    return `<p class="sheet-abschnitt zwischen">Verlauf · ${alle.length} Messungen</p>`
      + alle.map(m => {
        const werte = Object.entries(m.werte)
          .filter(([typ]) => KOERPER_WERTE[typ])
          .map(([typ, wert]) => `<span class="kw-chip">${esc(KOERPER_WERTE[typ].label)}: <strong>${esc(formatKoerperWert(typ, wert))}</strong></span>`)
          .join('');
        return `<div class="karte kw-zeile-karte anim">
          <div>
            <strong>${esc(ctx.formatDatum(m.datum))}</strong>
            <div class="kw-chips">${werte || '<span class="dim">keine Werte</span>'}</div>
          </div>
          <button class="kw-weg" data-action="koerper.weg" data-datum="${esc(m.datum)}" aria-label="Messung löschen">✕</button>
        </div>`;
      }).join('');
  }

  // ----------------------------------------------------------
  // Aktionen
  // ----------------------------------------------------------

  const actions = {
    'koerper.datum'(d, el) {
      const dd = entwurfHolen();
      dd.datum = el.value || heuteIso();
      // Werte des gewählten Tages übernehmen, damit man ergänzt statt doppelt
      const vorhanden = messungAmTag(S(), dd.datum);
      dd.werte = { ...(vorhanden?.werte ?? {}) };
      dd.felder = [...new Set([...standardWerte(), ...Object.keys(dd.werte)])];
      ctx.render();
    },
    'koerper.wert'(d, el) {
      const dd = entwurfHolen();
      const n = parseZahl(el.value);
      if (n == null) delete dd.werte[d.typ]; else dd.werte[d.typ] = n;
      // kein Re-Render → Fokus und Tastatur bleiben (siehe Fallstrick 5)
    },
    async 'koerper.zeitraum'(d) {
      setzeKoerperZeitraum(S(), d.art);
      await speichernUndZeigen();   // gemerkt: wer immer auf 30 Tage schaut, tippt nicht jedes Mal
    },
    async 'koerper.eigeneTage'(d, el) {
      // Unbrauchbares (leer, 0, „abc") lässt die bisherige Zahl stehen;
      // das Neuzeichnen setzt das Feld dann sichtbar auf sie zurück.
      setzeKoerperZeitraum(S(), 'eigene', parseZahl(el.value));
      await speichernUndZeigen();
    },
    'koerper.feldPlus'(d) {
      const dd = entwurfHolen();
      if (!dd.felder.includes(d.typ)) dd.felder = [...dd.felder, d.typ];
      ctx.render();
    },
    'koerper.feldWeg'(d) {
      const dd = entwurfHolen();
      dd.felder = dd.felder.filter(t => t !== d.typ);
      delete dd.werte[d.typ];
      ctx.render();
    },
    async 'koerper.speichern'() {
      const dd = entwurfHolen();
      const gefuellt = Object.entries(dd.werte).filter(([, w]) => Number.isFinite(w));
      if (!gefuellt.length) {
        await hinweis('Nichts eingetragen', 'Trag mindestens einen Wert ein — Gewicht reicht.');
        return;
      }
      // Nur die sichtbaren Felder schreiben — UND die abgewählten ausdrücklich
      // auf null setzen. Ohne das zweite blieb der alte Wert einfach stehen:
      // setzeMessung() sieht nur, was man ihm gibt, und ein weggelassenes Feld
      // ist für sie kein Löschauftrag, sondern gar keine Aussage.
      const werte = {};
      for (const typ of dd.felder) werte[typ] = dd.werte[typ] ?? null;
      for (const typ of Object.keys(messungAmTag(S(), dd.datum)?.werte ?? {})) {
        if (!(typ in werte)) werte[typ] = null;
      }
      setzeMessung(S(), dd.datum, werte);
      entwurf = null;                 // Formular für den nächsten Tag frisch
      await speichernUndZeigen();
    },
    async 'koerper.weg'(d) {
      if (!await bestaetige({
        titel: 'Messung löschen?',
        text: `Die Werte vom ${ctx.formatDatum(d.datum)} werden entfernt.`,
        jaText: 'Löschen', gefahr: true })) return;
      entferneMessung(S(), d.datum);
      entwurf = null;
      await speichernUndZeigen();
    },
  };

  return { heuteHtml, actions };
}
