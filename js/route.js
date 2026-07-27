// ============================================================
// route.js — Adresse ⇄ Ansicht (reine Logik, kein DOM)
//
// Die Adresse spiegelt, wo man gerade ist:
//   #/dashboard · #/kraft/heute · #/rad/verlauf · #/daten · #/kalender
// Damit landet ein Reload wieder an derselben Stelle und man kann eine
// Ansicht als Lesezeichen ablegen.
//
// Bewusst HASH statt echter Pfade: Die App liegt als statische Dateien auf
// GitHub Pages. Ein Pfad wie /kraft/heute würde beim Neuladen einen 404
// erzeugen, weil dort keine Datei liegt — ein Hash kommt nie beim Server an.
//
// Diese Datei kennt weder `location` noch `history`: sie rechnet nur zwischen
// Zustand und Route hin und her. Das Setzen der Adresse macht app.js.
// ============================================================

/** Overlays, die als eigene Route auftauchen (liegen über den Tabs). */
export const ROUTE_UNTERSEITEN = Object.freeze(['daten', 'kalender']);

/**
 * Zustand → Route.
 * @param {{unterseite:?string, tab:string, modul:string}} zustand
 */
export function routeVonZustand({ unterseite, tab, modul }) {
  if (ROUTE_UNTERSEITEN.includes(unterseite)) return `#/${unterseite}`;
  if (tab === 'dashboard' || !tab) return '#/dashboard';
  return `#/${modul}/${tab}`;
}

/**
 * Route → Zustand. Alles Unbekannte fällt sauber zurück, damit eine vertippte
 * oder veraltete Adresse nie in einer leeren Ansicht endet.
 *
 * @param hash       z.B. '#/kraft/plan' (führendes #/ optional)
 * @param modulTabs  { modul: [erlaubte Tabs] } — entscheidet, was gültig ist
 * @returns {{unterseite:?string, modul:?string, tab:string}}
 *          modul = null heißt „unverändert lassen" (Dashboard/Unterseite).
 */
export function routeParsen(hash, modulTabs = {}) {
  const teile = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const [erstes, zweites] = teile;

  if (!erstes || erstes === 'dashboard') {
    return { unterseite: null, modul: null, tab: 'dashboard' };
  }
  if (ROUTE_UNTERSEITEN.includes(erstes)) {
    return { unterseite: erstes, modul: null, tab: 'dashboard' };
  }

  const tabs = modulTabs[erstes];
  if (!tabs) {
    // Unbekanntes Modul (Tippfehler, altes Lesezeichen) → heim aufs Dashboard.
    return { unterseite: null, modul: null, tab: 'dashboard' };
  }
  // Ein Tab, den dieses Modul nicht hat (z.B. #/rad/plan), landet auf „heute".
  const tab = (zweites && zweites !== 'dashboard' && tabs.includes(zweites)) ? zweites : 'heute';
  return { unterseite: null, modul: erstes, tab };
}
