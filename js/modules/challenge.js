// ============================================================
// challenge.js — das Challenge-Modul (Auswertungsschicht).
//
// Anders als Kraft/Rad erzeugt dieses Modul KAUM eigene Daten:
// Es definiert ZIELE und liest die Sessions der anderen Module aus.
// Ein Ziel = { was, zielwert, zeitraum } → Fortschrittsbalken.
//
// „was" ist eine zählbare Größe (Rad-km, Kraft-Volumen, Anzahl…).
// „zeitraum" = woche | monat | jahr | gesamt | bis:<ISO-Datum>.
// Der Fortschritt wird live aus state.sessions berechnet.
// ============================================================

import { formatZahl } from '../core/metrics.js';
import { heuteIso, wochenStart, monatsStart, jahresStart } from '../core/model.js';
import { sessionVolumenErledigt } from './kraft.js';
import { bestaetige, hinweis } from '../ui/components.js';

export const MODUL = 'challenge';

// Die zählbaren Größen. jede: { label, einheit, wert(session) → Zahl }
// wert() gibt den Beitrag EINER Session zurück (0, wenn nicht relevant).
export const GROESSEN = {
  rad_km: {
    label: 'Rad-Kilometer', einheit: 'km', modul: 'rad',
    wert: s => s.modul === 'rad' ? ((tourMw(s).distanz ?? 0) / 1000) : 0,
  },
  rad_hm: {
    label: 'Rad-Höhenmeter', einheit: 'hm', modul: 'rad',
    wert: s => s.modul === 'rad' ? (tourMw(s).hoehenmeter ?? 0) : 0,
  },
  rad_touren: {
    label: 'Anzahl Touren', einheit: 'Touren', modul: 'rad',
    wert: s => (s.modul === 'rad' && s.abgeschlossen) ? 1 : 0,
  },
  kraft_volumen: {
    label: 'Kraft-Volumen', einheit: 'kg', modul: 'kraft',
    wert: s => (s.modul ?? 'kraft') === 'kraft' ? sessionVolumenErledigt(s) : 0,
  },
  kraft_einheiten: {
    label: 'Kraft-Einheiten', einheit: 'Einheiten', modul: 'kraft',
    wert: s => ((s.modul ?? 'kraft') === 'kraft' && s.abgeschlossen) ? 1 : 0,
  },
};

function tourMw(s) {
  return s.segmente?.[0]?.eintraege?.[0]?.messwerte ?? {};
}

// ============================================================
// 1) REINE LOGIK (Node-testbar)
// ============================================================

/** Start-ISO eines Zeitraums (oder null für „gesamt"/„bis:"). */
export function zeitraumStart(zeitraum, heute = heuteIso()) {
  if (zeitraum === 'woche') return wochenStart(heute);
  if (zeitraum === 'monat') return monatsStart(heute);
  if (zeitraum === 'jahr') return jahresStart(heute);
  return null; // gesamt / bis:<datum> haben keine untere Grenze
}

/** Menschenlesbarer Zeitraum-Text. */
export function zeitraumText(zeitraum) {
  if (zeitraum === 'woche') return 'diese Woche';
  if (zeitraum === 'monat') return 'diesen Monat';
  if (zeitraum === 'jahr') return 'dieses Jahr';
  if (zeitraum === 'gesamt') return 'insgesamt';
  if (zeitraum?.startsWith('bis:')) return 'bis ' + zeitraum.slice(4);
  return '';
}

/**
 * Fortschritt eines Ziels: summiert die Beiträge aller passenden Sessions
 * im Zeitraum. Gibt { ist, ziel, prozent, fertig, resttage? }.
 */
export function fortschritt(state, ziel, heute = heuteIso()) {
  const groesse = GROESSEN[ziel.was];
  if (!groesse) return { ist: 0, ziel: ziel.zielwert, prozent: 0, fertig: false };

  const ab = zeitraumStart(ziel.zeitraum, heute);
  const bis = ziel.zeitraum?.startsWith('bis:') ? ziel.zeitraum.slice(4) : null;

  let ist = 0;
  for (const s of state.sessions) {
    if (s.uebersprungen) continue;
    if (ab && s.datum < ab) continue;
    if (bis && s.datum > bis) continue;
    ist += groesse.wert(s);
  }

  const prozent = ziel.zielwert > 0 ? Math.min(100, (ist / ziel.zielwert) * 100) : 0;
  const res = { ist, ziel: ziel.zielwert, prozent, fertig: ist >= ziel.zielwert };

  // Resttage bei Ziel mit Enddatum
  if (bis) {
    const d1 = new Date(heute), d2 = new Date(bis);
    res.resttage = Math.max(0, Math.round((d2 - d1) / 86400000));
    res.abgelaufen = heute > bis;
  }
  return res;
}

// ============================================================
// 2) MODUL-FABRIK
// ============================================================

export function erstelleChallengeModul(ctx) {
  const S = () => ctx.state;
  const esc = ctx.esc;

  // UI-Zustand
  let neuEntwurf = null;   // { was, zielwert, zeitraum, datum? } beim Anlegen

  async function speichernUndZeigen() { await ctx.save(); ctx.render(); }

  function heuteHtml() {
    const ziele = S().challenges ?? [];
    let html = `<div class="tab-kopf anim">
      <span class="eyebrow"><span class="pip challenge"></span>Challenge</span>
      <h1>Ziele</h1>
    </div>`;

    html += `<button class="knopf primaer gross voll" data-action="ch.neu">+ Neues Ziel</button>`;

    if (!ziele.length) {
      html += `<div class="karte leer anim"><p>Noch keine Ziele. Setz dir eins — z.B. „100 km Rad diesen Monat" — und die App zählt automatisch mit. 🎯</p></div>`;
      return html;
    }

    // Aktive Ziele mit Fortschrittsbalken
    html += ziele.map(z => zielKarteHtml(z)).join('');
    return html;
  }

  function zielKarteHtml(z) {
    const groesse = GROESSEN[z.was];
    if (!groesse) return '';
    const f = fortschritt(S(), z, heuteIso());
    const istText = formatZahl(f.ist, groesse.einheit === 'kg' || groesse.einheit === 'km' ? 0 : 0);
    const zielText = formatZahl(z.zielwert, 0);
    const proz = Math.round(f.prozent);

    let status = '';
    if (f.fertig) status = `<span class="ch-fertig">✓ geschafft</span>`;
    else if (f.abgelaufen) status = `<span class="ch-ablauf">abgelaufen</span>`;
    else if (f.resttage != null) status = `<span class="dim">noch ${f.resttage} Tage</span>`;

    return `<div class="karte ch-karte anim ${f.fertig ? 'fertig' : ''}">
      <div class="ch-kopf">
        <div>
          <strong>${esc(groesse.label)}</strong>
          <small class="dim">${esc(zeitraumText(z.zeitraum))}</small>
        </div>
        <button class="ch-weg" data-action="ch.weg" data-id="${z.id}" aria-label="Ziel löschen">✕</button>
      </div>
      <div class="ch-zahlen">
        <span class="ch-ist">${istText}</span>
        <span class="dim"> / ${zielText} ${esc(groesse.einheit)}</span>
        ${status}
      </div>
      <div class="ch-balken"><div class="ch-fuell" style="width:${proz}%"></div></div>
      <div class="ch-prozent dim">${proz}%</div>
    </div>`;
  }

  // ---- Ziel anlegen (Bottom-Sheet) ----

  function neuSheetHtml() {
    const d = neuEntwurf;
    const groessenChips = Object.entries(GROESSEN).map(([key, g]) =>
      `<button class="chip ${d.was === key ? 'aktiv' : ''}" data-action="ch.was" data-w="${key}">${esc(g.label)}</button>`
    ).join('');

    const zeitraeume = [
      ['woche', 'Diese Woche'], ['monat', 'Diesen Monat'],
      ['jahr', 'Dieses Jahr'], ['gesamt', 'Gesamt'], ['bis', 'Bis Datum'],
    ];
    const istBis = d.zeitraum?.startsWith('bis');
    const zeitChips = zeitraeume.map(([key, label]) => {
      const aktiv = key === 'bis' ? istBis : d.zeitraum === key;
      return `<button class="chip ${aktiv ? 'aktiv' : ''}" data-action="ch.zeit" data-z="${key}">${esc(label)}</button>`;
    }).join('');

    const g = GROESSEN[d.was];
    return `<h3>Neues Ziel</h3>
      <p class="sheet-abschnitt">Was?</p>
      <div class="chip-zeile">${groessenChips}</div>
      <p class="sheet-abschnitt">Zielwert${g ? ` (${esc(g.einheit)})` : ''}</p>
      <input class="ch-ziel-feld" type="text" inputmode="decimal" value="${d.zielwert ?? ''}"
        placeholder="z.B. 100" data-change="ch.zielwert">
      <p class="sheet-abschnitt">Zeitraum</p>
      <div class="chip-zeile">${zeitChips}</div>
      ${istBis ? `<input class="ch-ziel-feld" type="date" value="${esc(d.datum ?? '')}" data-change="ch.datum" style="margin-top:10px">` : ''}
      <button class="knopf primaer ${d.was && d.zielwert ? '' : 'aus'}" data-action="ch.anlegen" style="margin-top:16px">Ziel erstellen</button>`;
  }

  const actions = {
    'ch.neu'() {
      neuEntwurf = { was: 'rad_km', zielwert: '', zeitraum: 'monat', datum: '' };
      ctx.sheet.oeffne(neuSheetHtml());
    },
    'ch.was'(d) { neuEntwurf.was = d.w; ctx.sheet.aktualisiere(neuSheetHtml()); },
    'ch.zeit'(d) {
      if (d.z === 'bis') { neuEntwurf.zeitraum = 'bis'; }
      else neuEntwurf.zeitraum = d.z;
      ctx.sheet.aktualisiere(neuSheetHtml());
    },
    'ch.zielwert'(d, el) { neuEntwurf.zielwert = el.value; ctx.sheet.aktualisiere(neuSheetHtml()); },
    'ch.datum'(d, el) { neuEntwurf.datum = el.value; },
    async 'ch.anlegen'() {
      const d = neuEntwurf;
      const wert = parseFloat(String(d.zielwert).replace(',', '.'));
      if (!d.was || !Number.isFinite(wert) || wert <= 0) {
        await hinweis('Fehlt noch was', 'Wähle eine Größe und trag einen Zielwert ein.');
        return;
      }
      let zeitraum = d.zeitraum;
      if (zeitraum === 'bis') {
        if (!d.datum) { await hinweis('Datum fehlt', 'Wähle ein Enddatum für das Ziel.'); return; }
        zeitraum = 'bis:' + d.datum;
      }
      S().challenges = S().challenges ?? [];
      S().challenges.push({
        id: 'ziel_' + Date.now().toString(36),
        was: d.was, zielwert: wert, zeitraum,
        erstellt: heuteIso(),
      });
      neuEntwurf = null;
      ctx.sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'ch.weg'(d) {
      if (!await bestaetige({ titel: 'Ziel löschen?', jaText: 'Löschen', gefahr: true })) return;
      S().challenges = (S().challenges ?? []).filter(z => z.id !== d.id);
      await speichernUndZeigen();
    },
  };

  return { heuteHtml, actions };
}
