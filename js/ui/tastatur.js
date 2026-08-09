// ============================================================
// ui/tastatur.js — Verhalten rund um die Bildschirmtastatur.
//
// Auf dem Handy ist das der Unterschied zwischen „benutzbar" und „nervig":
// „Weiter" muss ins nächste Feld springen, und kein Feld darf hinter der
// Tastatur verschwinden. Alles hier hängt nur am DOM, nicht am Zustand der
// App — deshalb steht es für sich.
// ============================================================

/** Höhe des tatsächlich sichtbaren Bereichs (ohne aufgeklappte Tastatur). */
function sichtHoehe() {
  return window.visualViewport?.height ?? window.innerHeight;
}

/**
 * Liegt das Feld hinter der Tastatur bzw. außerhalb der Sicht?
 * Mit etwas Luft nach unten (24px), damit ein Feld, das gerade eben noch am
 * unteren Rand klebt, auch als „nicht gut sichtbar" gilt.
 */
function istVerdeckt(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > sichtHoehe() - 24 || r.top < 0;
}

/**
 * Feld mittig in den sichtbaren Bereich holen — und NACHFASSEN.
 * Mobile Browser korrigieren nach einem Fokuswechsel oft selbst nach und
 * überschreiben dabei ein laufendes sanftes Scrollen (dann bleibt das Feld
 * unter der Tastatur liegen). Deshalb: sanft zentrieren, kurz später prüfen
 * und notfalls hart nachziehen.
 */
function zeigeFeld(el) {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => {
    if (document.activeElement === el && istVerdeckt(el)) {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, 300);
}

/**
 * Tipp-Modus: solange ein Feld aktiv ist, bekommt der Inhaltsbereich unten
 * extra Scroll-Platz. Ohne den lässt sich ein Feld am Listenende NICHT mittig
 * scrollen (der Container ist schon am Anschlag) — es bliebe unter der
 * Tastatur liegen. Der Platz verschwindet wieder, sobald die Eingabe endet.
 */
function eingabeModus(an) {
  document.body.classList.toggle('eingabe-aktiv', an);
}

/**
 * Alles einhängen. `main` ist der Inhaltsbereich; Bottom-Sheets liegen
 * außerhalb davon und sind bewusst nicht dabei.
 */
export function installiereTastaturVerhalten(main) {
  // Sichtbare Eingabefelder des Inhaltsbereichs, in DOM-Reihenfolge.
  const eingabeFelder = () =>
    [...main.querySelectorAll('input[data-change]')].filter(el =>
      el.type !== 'file' && el.type !== 'hidden' && el.offsetParent !== null);

  const naechstesFeld = (el) => {
    const felder = eingabeFelder();
    const i = felder.indexOf(el);
    return (i >= 0 && i < felder.length - 1) ? felder[i + 1] : null;
  };

  document.addEventListener('focusin', e => {
    const el = e.target;
    if (el.tagName !== 'INPUT') return;
    // Komfort: beim Antippen eines Kraft-Wertfelds den Inhalt sofort markieren,
    // damit man direkt die neue Zahl tippt, statt erst die alte zu löschen.
    if (el.dataset.change === 'k.wert') {
      requestAnimationFrame(() => { try { el.select(); } catch {} });
    }
    // Tastatur-Aktionstaste passend beschriften: „Weiter" solange noch ein Feld
    // folgt, sonst „Fertig" (schließt die Tastatur).
    if (el.dataset.change) {
      el.setAttribute('enterkeyhint', naechstesFeld(el) ? 'next' : 'done');
      eingabeModus(true);
    }
  });

  // Eingabe beendet → Scroll-Platz wieder einklappen (erst prüfen, ob nicht
  // direkt ins nächste Feld gesprungen wurde).
  document.addEventListener('focusout', e => {
    if (e.target.tagName !== 'INPUT') return;
    setTimeout(() => {
      const a = document.activeElement;
      if (!(a && a.tagName === 'INPUT' && a.dataset.change)) eingabeModus(false);
    }, 0);
  });

  // Tastatur klappt auf/ändert die Höhe → verdecktes Feld nachführen. Läuft NUR
  // bei Größenänderungen des sichtbaren Bereichs, nicht beim Scrollen — danach
  // kann man also frei scrollen, ohne dass es zurückspringt.
  window.visualViewport?.addEventListener('resize', () => {
    const el = document.activeElement;
    if (el && el.tagName === 'INPUT' && el.dataset.change && istVerdeckt(el)) {
      zeigeFeld(el);
    }
  });

  // „Weiter"/Enter auf der Tastatur → nächstes Eingabefeld fokussieren und sanft
  // in die Bildmitte holen. Danach frei scrollbar (kein Re-Render → kein Snap
  // zurück). Am letzten Feld schließt „Fertig" die Tastatur.
  main.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (el.tagName !== 'INPUT' || !el.dataset.change) return;
    e.preventDefault();
    const next = naechstesFeld(el);
    if (next) {
      next.focus({ preventScroll: true });
      // Erst im nächsten Frame scrollen: der Extra-Platz unten muss im Layout
      // stehen, sonst ist beim letzten Feld wieder kein Platz zum Zentrieren.
      requestAnimationFrame(() => zeigeFeld(next));
    } else {
      el.blur();
    }
  });
}
