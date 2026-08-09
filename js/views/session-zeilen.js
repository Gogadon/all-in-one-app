// ============================================================
// views/session-zeilen.js — die abgehakten Segmente einer Session als Zeilen.
//
// Genutzt vom Kraft-Verlauf UND vom Tages-Sheet. Beide hatten diese Zeile
// früher doppelt; in der einen Kopie steckte eine veraltete Auflösung der
// Alternativen (seit Schema 2 sind das IDs, keine Objekte), sodass dort statt
// der benutzten Alternative die Hauptübung stand. Ein gemeinsamer Helfer
// verhindert, dass die beiden Stellen wieder auseinanderlaufen.
// ============================================================

import { loeseSegmentAuf } from '../core/model.js';
import { esc } from '../ui/components.js';
import { segmentZusammenfassungKraft, segmentZusammenfassungWerte } from '../modules/kraft.js';

export function erledigteSegmentZeilen(state, session) {
  return (session.segmente ?? []).filter(seg => seg.erledigt === true).map(seg => {
    const { aktivitaet, anzeigeName } = loeseSegmentAuf(state, seg);
    if (!aktivitaet) return '';
    const zsf = aktivitaet.kategorie === 'kraft'
      ? segmentZusammenfassungKraft(seg)
      : segmentZusammenfassungWerte(aktivitaet, seg);
    return `<div class="verlauf-zeile"><span class="punkt ${aktivitaet.kategorie}"></span>${esc(anzeigeName)} <span class="dim">${esc(zsf)}</span></div>`;
  }).join('');
}
