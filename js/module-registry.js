// ============================================================
// module-registry.js — ein Modul, eine Stelle.
//
// Vorher lagen die Eigenschaften der Module in acht parallelen Tabellen in
// app.js verstreut (Label, Tabs, Icon, planbar?, Tour?, Session-Name …),
// dazu handgeschriebene Dashboard-Kacheln und Render-Ternaries. Ein neues
// Modul einzuhängen hieß, an rund zehn Stellen daran zu denken — und genau
// dieses Vergessen war der Grund, warum Schwimmen im Tages-Sheet als
// „Wanderung" auftauchte: die Tabelle kannte es einfach nicht.
//
// Hier steht jedes Modul EINMAL, mit allem, was die Hülle über es wissen
// muss. Die Hülle fragt die Registry, statt Module aufzuzählen.
//
// Was hier NICHT hingehört: alles, was ein Modul über sich selbst weiß
// (Messwerte, Texte, Logik). Das bleibt in den Modul-Configs. Die Registry
// beschreibt nur, wie ein Modul in der Navigation auftaucht.
// ============================================================

import { formatZahl } from './core/metrics.js';
import { naechsteEinheit } from './core/plan.js';
import { letzterWert as letzterKoerperWert, veraenderung as koerperVeraenderung,
  formatKoerperWert } from './core/koerper.js';

import { erstelleKraftModul, MODUL as KRAFT } from './modules/kraft.js';
import { erstelleRadModul, MODUL as RAD, tourStatistik,
  TITEL_EINZAHL as RAD_TITEL, NOMEN as RAD_NOMEN } from './modules/rad.js';
import { erstelleWanderModul, MODUL as WANDERN, wanderStatistik,
  TITEL_EINZAHL as WANDERN_TITEL, NOMEN as WANDERN_NOMEN } from './modules/wandern.js';
import { erstelleSchwimmModul, MODUL as SCHWIMMEN, schwimmStatistik,
  TITEL_EINZAHL as SCHWIMMEN_TITEL, NOMEN as SCHWIMMEN_NOMEN } from './modules/schwimmen.js';
import { erstelleKoerperModul, MODUL as KOERPER } from './modules/koerper.js';
import { erstelleChallengeModul, MODUL as CHALLENGE, fortschritt } from './modules/challenge.js';

export { KRAFT, RAD, WANDERN, SCHWIMMEN, KOERPER, CHALLENGE };

// ---- Icons (stroke, viewBox 0 0 24 24) ----
const ICON_KRAFT = '<svg viewBox="0 0 24 24"><path d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12"/></svg>';
const ICON_RAD = '<svg viewBox="0 0 24 24"><circle cx="6" cy="16.5" r="3.3"/><circle cx="18" cy="16.5" r="3.3"/><path d="M6 16.5l5-8 7 8M11 8.5h5"/></svg>';
const ICON_WANDERN = '<svg viewBox="0 0 24 24"><path d="M3 19h18M6 19l4-6 3 4M12.5 19l4-7 4.5 7"/></svg>';
const ICON_SCHWIMMEN = '<svg viewBox="0 0 24 24"><path d="M2 8c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2M2 14c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2"/></svg>';
const ICON_KOERPER = '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 9.5a3.5 3.5 0 0 1 7 0"/><path d="M12 9.5V13"/></svg>';
const ICON_CHALLENGE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></svg>';
// Tab-Icons, die vom Standard abweichen.
const ICON_ZIEL = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>';
const ICON_TOUREN = '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 17c4 0 4-10 8-10"/></svg>';
const ICON_STATISTIK = '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>';

const ALLE_TABS = ['dashboard', 'heute', 'plan', 'verlauf'];
const OHNE_PLAN = ['dashboard', 'heute', 'verlauf'];
const NUR_HEUTE = ['dashboard', 'heute'];

/** „1 Tour" statt „1 Touren" — die Wörter kommen aus der Modul-Config. */
function mengenwort(anzahl, nomen) {
  return anzahl === 1 ? nomen.einzahl : nomen.mehrzahl;
}

/**
 * Gemeinsame Züge der Touren-Module (Rad/Wandern/Schwimmen): spontanes
 * Loggen statt Plan, „Heute" ist eine Liste, „Verlauf" ist die Statistik.
 * Nur die Wörter unterscheiden sich — Schwimmen zählt Einheiten, nicht Touren.
 */
function tourModul({ id, label, icon, erstelle, sessionName, statistik, nomen, heuteLabel, status }) {
  return {
    id, label, icon, erstelle,
    tabs: OHNE_PLAN,
    planbar: true,
    tour: true,
    sessionName,
    nomen,                    // Einzahl/Mehrzahl, aus der Config des Moduls
    heuteLabel, heuteIcon: ICON_TOUREN,
    verlaufLabel: 'Statistik', verlaufIcon: ICON_STATISTIK,
    verlaufHtml: (instanz) => instanz.statistikHtml(),
    status: (state) => status(statistik(state), nomen),
  };
}

/**
 * Alle Module in Anzeige-Reihenfolge. Die Reihenfolge hier IST die
 * Reihenfolge der Kacheln auf dem Dashboard.
 */
export const MODULE = [
  {
    id: KRAFT,
    label: 'Kraft',
    icon: ICON_KRAFT,
    erstelle: erstelleKraftModul,
    tabs: ALLE_TABS,          // als einziges Modul mit Zyklus-Plan
    planbar: true,
    tour: false,
    sessionName: null,        // Kraft-Sessions tragen den Namen ihrer Einheit
    status: (state) => naechsteEinheit(state, KRAFT)?.name ?? 'Kein Plan',
  },
  tourModul({
    id: RAD, label: 'Rad', icon: ICON_RAD,
    erstelle: erstelleRadModul, sessionName: RAD_TITEL,
    statistik: tourStatistik, nomen: RAD_NOMEN, heuteLabel: 'Touren',
    status: (st, n) => st.anzahl > 0
      ? `${st.anzahl} ${mengenwort(st.anzahl, n)} · ${Math.round(st.distanz / 1000)} km`
      : `Noch keine ${n.einzahl}`,
  }),
  tourModul({
    id: WANDERN, label: 'Wandern', icon: ICON_WANDERN,
    erstelle: erstelleWanderModul, sessionName: WANDERN_TITEL,
    statistik: wanderStatistik, nomen: WANDERN_NOMEN, heuteLabel: 'Touren',
    status: (st, n) => st.anzahl > 0
      ? `${st.anzahl} ${mengenwort(st.anzahl, n)} · ${Math.round(st.distanz / 1000)} km`
      : `Noch keine ${n.einzahl}`,
  }),
  tourModul({
    id: SCHWIMMEN, label: 'Schwimmen', icon: ICON_SCHWIMMEN,
    erstelle: erstelleSchwimmModul, sessionName: SCHWIMMEN_TITEL,
    statistik: schwimmStatistik, nomen: SCHWIMMEN_NOMEN, heuteLabel: 'Einheiten',
    status: (st, n) => st.anzahl > 0
      ? `${st.anzahl} ${mengenwort(st.anzahl, n)} · ${st.bahnen} ${st.bahnen === 1 ? 'Bahn' : 'Bahnen'}`
      : `Noch keine ${n.einzahl}`,
  }),
  {
    id: KOERPER,
    label: 'Körper',
    icon: ICON_KOERPER,
    erstelle: erstelleKoerperModul,
    tabs: NUR_HEUTE,
    planbar: false,           // Körperwerte plant man nicht, man misst sie
    tour: false,
    sessionName: null,
    heuteLabel: 'Werte', heuteIcon: ICON_KOERPER,
    status: (state) => {
      const letzte = letzterKoerperWert(state, 'gewicht');
      if (!letzte) return 'Noch keine Messung';
      const text = formatKoerperWert('gewicht', letzte.wert);
      const v = koerperVeraenderung(state, 'gewicht');
      if (!v || v.diff === 0) return text;
      return `${text} · ${v.diff > 0 ? '+' : ''}${formatZahl(v.diff, 1)}`;
    },
  },
  {
    id: CHALLENGE,
    label: 'Challenge',
    icon: ICON_CHALLENGE,
    erstelle: erstelleChallengeModul,
    tabs: NUR_HEUTE,
    planbar: false,           // Auswertung, kein Tun — nichts zu planen
    tour: false,
    sessionName: null,
    heuteLabel: 'Ziele', heuteIcon: ICON_ZIEL,
    status: (state) => {
      const ziele = state.challenges ?? [];
      if (!ziele.length) return 'Keine Ziele';
      const offen = ziele.filter(z => !fortschritt(state, z).fertig).length;
      return offen > 0
        ? `${ziele.length} Ziele · ${offen} offen`
        : `${ziele.length} Ziele · alle geschafft ✓`;
    },
  },
];

const NACH_ID = new Map(MODULE.map(m => [m.id, m]));

/** Beschreibung eines Moduls — null, wenn die ID unbekannt ist. */
export function modulNach(id) {
  return NACH_ID.get(id) ?? null;
}

/** Module, die im Kalender geplant werden können (Körper/Challenge nicht). */
export const PLANBARE_MODULE = MODULE.filter(m => m.planbar).map(m => m.id);

/** Welche Tabs hat welches Modul? Fürs Routing und die Navigation. */
export const MODUL_TABS = Object.fromEntries(MODULE.map(m => [m.id, m.tabs]));

/** Anzeigename eines Moduls, z.B. für die Kalender-Chips. */
export const MODUL_LABEL = Object.fromEntries(MODULE.map(m => [m.id, m.label]));

/**
 * Name für eine Session, die keinen eigenen trägt — kommt aus der jeweiligen
 * Modul-Config, nicht aus einem zweiten Ort. Vorher stand hier ein Ternary
 * „Rad ? Radtour : Wanderung", wodurch JEDES weitere Tour-Modul als
 * „Wanderung" auftauchte.
 */
export function sessionNameFuer(modul) {
  return modulNach(modul)?.sessionName ?? null;
}

/**
 * Alle Module mit dem gemeinsamen Kontext bauen.
 * Gibt die Beschreibungen zurück, jeweils um `instanz` ergänzt.
 */
export function erstelleModule(ctx) {
  const gebaut = MODULE.map(m => ({ ...m, instanz: m.erstelle(ctx) }));
  const nachId = new Map(gebaut.map(m => [m.id, m]));
  return {
    liste: gebaut,
    /** Gebautes Modul samt Instanz — null bei unbekannter ID. */
    nach: (id) => nachId.get(id) ?? null,
    /** Alle Aktionen aller Module in einer Tabelle. */
    actions: Object.assign({}, ...gebaut.map(m => m.instanz.actions)),
  };
}
