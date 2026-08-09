// ============================================================
// tests/helpers/umgebung.js — Browser-Attrappe für Render-Tests.
//
// Die Module erzeugen HTML als String; nur Randfunktionen (Sheets,
// Dialoge) fassen wirklich das DOM an. Diese Attrappe reicht, damit
// sie im Test nicht crashen — ein echter Browser ist für die Frage
// „steht der richtige Name im HTML?" nicht nötig.
// ============================================================

/** localStorage + minimales `document` global bereitstellen. */
export function installiereBrowserAttrappe() {
  globalThis.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.get(k) ?? null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  };
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.document = {
    createElement: () => ({
      className: '', innerHTML: '', style: {}, dataset: {},
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      addEventListener() {}, querySelector() { return null; }, append() {}, appendChild() {},
    }),
    getElementById: () => null,
    body: { append() {}, appendChild() {}, classList: { add() {}, remove() {}, contains() { return false; } } },
  };
}

/**
 * Modul-Kontext wie in app.js, aber beobachtbar.
 * `esc`/`formatDatum` sind bewusst die ECHTEN aus ui/components.js:
 * ein Test mit halbierter Escaping-Funktion prüft nicht das, was der
 * Nutzer sieht.
 */
export function testKontext(state, { esc, formatDatum }) {
  const protokoll = { renders: 0, saves: 0, sheet: '', tab: null };
  return {
    ctx: {
      get state() { return state; },
      save: async () => { protokoll.saves++; },
      render: () => { protokoll.renders++; },
      sheet: {
        oeffne(h) { protokoll.sheet = h; },
        schliesse() { protokoll.sheet = ''; },
        aktualisiere(h) { protokoll.sheet = h; },
      },
      esc, formatDatum,
      tabWechsel: (t) => { protokoll.tab = t; },
    },
    protokoll,
  };
}
