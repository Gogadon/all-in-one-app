// ============================================================
// plan.js — Plan/Zyklus, optionaler Überbau PRO MODUL
//
// ZWEI Ebenen, klar getrennt (wie die Übungs-Bibliothek):
//
// state.plaene.kraft = {
//   einheiten: [ Einheit … ],   ← BIBLIOTHEK: jede Einheit existiert 1×
//   zyklus:    [ einheitId … ], ← ABLAUF: Verweise, Mehrfachnennung erlaubt
//   position:  0,               ← LEGACY/CACHE: abgeleiteter Spiegelwert.
//                                  NICHT die Quelle der Wahrheit! Die aktuelle
//                                  Zyklus-Position wird aus `anker` + Verlauf
//                                  berechnet (siehe berechnePositionHeute).
//                                  position wird nur als Cache mitgeführt,
//                                  damit ältere UI-Teile einen Wert haben.
//   anker: { iso, index },      ← QUELLE DER WAHRHEIT für die Position.
// }
//
// Einheit (Rezept):
//   { id, name, kategorie, segmente: [{ aktivitaetId }] }
//
// Weil Übungen UND Historie an der Einheit hängen (nicht an der
// Zyklus-Position), teilen sich alle Vorkommen derselben Einheit
// automatisch alles: „Rücken · Bizeps" an Position 1 und 5 ist
// dieselbe Einheit. Einheiten sind über Pläne hinweg wiederverwendbar.
//
// Das Session-Modell merkt vom Plan nichts: ausPlan verweist nur
// zur Info auf die Einheit.
// ============================================================

import { KATEGORIEN, neueId, neueSession, neuesSegment, findeAktivitaet, heuteIso, naechsterTag } from './model.js';

// ------------------------------------------------------------
// Plan holen / anlegen
// ------------------------------------------------------------

/** Plan eines Moduls — null, wenn keiner existiert (spontan ist der Standard). */
export function planFuer(state, modul) {
  return state.plaene?.[modul] ?? null;
}

/** Plan holen oder frisch anlegen. */
export function erstellePlan(state, modul) {
  state.plaene ??= {};
  state.plaene[modul] ??= { einheiten: [], zyklus: [], position: 0 };
  const p = state.plaene[modul];
  p.einheiten ??= []; p.zyklus ??= []; p.position ??= 0;
  return p;
}

/** Ganzen Plan eines Moduls entfernen (Sessions bleiben unberührt). */
export function entfernePlan(state, modul) {
  if (state.plaene) delete state.plaene[modul];
}

// ============================================================
// EINHEITEN-BIBLIOTHEK
// ============================================================

/** Einheit anlegen (nur Bibliothek — landet NICHT automatisch im Zyklus). */
export function addEinheit(state, modul, { name, kategorie = modul }) {
  if (!name || !name.trim()) throw new Error('Einheit braucht einen Namen.');
  if (!KATEGORIEN.includes(kategorie)) throw new Error(`Unbekannte Kategorie: ${kategorie}`);
  const plan = erstellePlan(state, modul);
  const einheit = { id: neueId(), name: name.trim(), kategorie, segmente: [] };
  plan.einheiten.push(einheit);
  return einheit;
}

/** Alle Einheiten der Bibliothek. */
export function einheitenBibliothek(state, modul) {
  return planFuer(state, modul)?.einheiten ?? [];
}

/** Einheit per ID (aus der Bibliothek). */
export function findeEinheit(state, modul, einheitId) {
  return planFuer(state, modul)?.einheiten.find(e => e.id === einheitId) ?? null;
}

/**
 * Einheit ausdrücklich als Ruhetag markieren (oder die Markierung entfernen).
 * Setzt `typ: 'rest'` — die Marke, die istRuhetag/einheitIstRuhetag ZUERST
 * prüfen. Damit rückt der Zyklus an diesem Tag automatisch weiter, ohne dass
 * man etwas abhaken muss, und man sieht im Plan auf einen Blick, was ein
 * Ruhetag ist (statt es aus „nur Cardio" erraten zu müssen).
 */
export function setzeRuhetag(state, modul, einheitId, an = true) {
  const e = mussEinheit(state, modul, einheitId);
  if (an) e.typ = 'rest'; else delete e.typ;
  return e;
}

/** Einheit umbenennen (wirkt an allen Zyklus-Stellen — es ist dieselbe). */
export function benenneEinheitUm(state, modul, einheitId, neuerName) {
  const e = mussEinheit(state, modul, einheitId);
  if (!neuerName || !neuerName.trim()) throw new Error('Name darf nicht leer sein.');
  e.name = neuerName.trim();
  return e;
}

/**
 * Einheit aus der BIBLIOTHEK löschen — entfernt zugleich ALLE ihre
 * Vorkommen aus dem Zyklus. Position bleibt konsistent.
 */
export function loescheEinheit(state, modul, einheitId) {
  const plan = mussPlan(state, modul);
  const iB = plan.einheiten.findIndex(e => e.id === einheitId);
  if (iB === -1) throw new Error('Einheit nicht gefunden.');
  // Welche Stellen fallen weg? Dieselbe Indexrechnung wie beim Entfernen einer
  // einzelnen Stelle — auch hier hat die Suche über die Einheiten-ID bei
  // Mehrfach-Vorkommen die falsche Stelle getroffen.
  const entfernteStellen = plan.zyklus
    .map((id, i) => (id === einheitId ? i : -1)).filter(i => i >= 0);
  plan.einheiten.splice(iB, 1);
  plan.zyklus = plan.zyklus.filter(id => id !== einheitId);
  if (plan.zyklus.length === 0) {
    plan.position = 0;
    if (plan.anker) plan.anker.index = 0;
    return;
  }
  plan.position = nachEntfernen(plan.position, entfernteStellen, plan.zyklus.length);
  if (plan.anker) plan.anker.index = nachEntfernen(plan.anker.index, entfernteStellen, plan.zyklus.length);
}

// ------------------------------------------------------------
// Aktivitäten in einer Einheit (Vorlage-Segmente)
// ------------------------------------------------------------

export function addAktivitaetZuEinheit(state, modul, einheitId, aktivitaetId) {
  const e = mussEinheit(state, modul, einheitId);
  if (!findeAktivitaet(state, aktivitaetId)) throw new Error('Aktivität nicht gefunden.');
  e.segmente.push({ aktivitaetId });
}

export function entferneAktivitaetAusEinheit(state, modul, einheitId, aktivitaetId) {
  const e = mussEinheit(state, modul, einheitId);
  const i = e.segmente.findIndex(s => s.aktivitaetId === aktivitaetId);
  if (i === -1) throw new Error('Aktivität ist nicht in dieser Einheit.');
  e.segmente.splice(i, 1);
}

export function verschiebeAktivitaetInEinheit(state, modul, einheitId, index, richtung) {
  const e = mussEinheit(state, modul, einheitId);
  const j = index + Math.sign(richtung);
  if (index < 0 || index >= e.segmente.length || j < 0 || j >= e.segmente.length) return;
  [e.segmente[index], e.segmente[j]] = [e.segmente[j], e.segmente[index]];
}

// ============================================================
// ZYKLUS (Ablauf — Liste von Einheiten-IDs, Mehrfachnennung erlaubt)
// ============================================================

/** Die Einheiten des Zyklus in Reihenfolge (aufgelöst zu Objekten). */
export function zyklusEinheiten(state, modul) {
  const plan = planFuer(state, modul);
  if (!plan) return [];
  return plan.zyklus.map(id => plan.einheiten.find(e => e.id === id)).filter(Boolean);
}

/** Einheit ans Ende des Zyklus hängen (darf schon drin sein). */
export function addZuZyklus(state, modul, einheitId) {
  const plan = mussPlan(state, modul);
  if (!plan.einheiten.some(e => e.id === einheitId)) throw new Error('Einheit nicht in der Bibliothek.');
  plan.zyklus.push(einheitId);
}

/** Zyklus-Stelle (nach Index) entfernen. Position bleibt konsistent. */
export function entferneAusZyklus(state, modul, index) {
  const plan = mussPlan(state, modul);
  if (index < 0 || index >= plan.zyklus.length) return;
  plan.zyklus.splice(index, 1);
  if (plan.zyklus.length === 0) {
    plan.position = 0;
    if (plan.anker) plan.anker.index = 0;
    return;
  }
  plan.position = nachEntfernen(plan.position, [index], plan.zyklus.length);
  if (plan.anker) plan.anker.index = nachEntfernen(plan.anker.index, [index], plan.zyklus.length);
}

/**
 * Wohin rutscht eine Zyklus-STELLE, wenn an `entfernt` eine Stelle wegfällt?
 *
 * Es geht um die Stelle, nicht um die Einheit, die dort steht. Vorher wurde die
 * Einheit gemerkt und ihre neue Stelle mit indexOf gesucht — das trifft bei
 * mehrfach vorkommenden Einheiten immer das ERSTE Vorkommen. Bei A→B→A→C und
 * dem Zeiger auf dem zweiten A sprang er nach dem Löschen von B aufs erste A,
 * also eine Einheit zurück.
 *
 * Reine Indexrechnung kennt dieses Problem nicht:
 *   davor gelöscht  → eine Stelle nach vorn rücken
 *   selbst gelöscht → die nachrückende Stelle übernehmen (Index bleibt)
 *   dahinter        → unverändert
 */
function nachEntfernen(stelle, entfernteStellen, laenge) {
  if (laenge === 0) return 0;
  const davor = entfernteStellen.filter(i => i < stelle).length;
  const neu = stelle - davor;
  return ((neu % laenge) + laenge) % laenge;
}

/** Zyklus-Stelle verschieben (richtung: -1 hoch / +1 runter). Zeiger folgt der Stelle. */
export function verschiebeImZyklus(state, modul, index, richtung) {
  const plan = mussPlan(state, modul);
  const j = index + Math.sign(richtung);
  if (index < 0 || index >= plan.zyklus.length || j < 0 || j >= plan.zyklus.length) return;
  const zeigerWar = plan.position;
  const ankerWar = plan.anker ? plan.anker.index : null;
  [plan.zyklus[index], plan.zyklus[j]] = [plan.zyklus[j], plan.zyklus[index]];
  if (zeigerWar === index) plan.position = j;
  else if (zeigerWar === j) plan.position = index;
  if (plan.anker) {                          // Anker folgt der verschobenen Stelle mit
    if (ankerWar === index) plan.anker.index = j;
    else if (ankerWar === j) plan.anker.index = index;
  }
}

/**
 * „Heute korrigieren": verankert den gewählten Zyklus-Index auf HEUTE.
 * Ab heute rechnet die dynamische Berechnung von diesem Anker weiter —
 * dadurch bleibt die manuelle Korrektur bestehen (im Gegensatz zu
 * setzePosition, das von der Berechnung wieder überschrieben würde).
 */
export function setzeAnker(state, modul, index, heute = heuteIso()) {
  const plan = mussPlan(state, modul);
  if (plan.zyklus.length === 0) return;
  const idx = ((index % plan.zyklus.length) + plan.zyklus.length) % plan.zyklus.length;
  // Übersprungene Tage rücken den Zyklus weiter — auch heutige, sofort.
  // Wer heute schon übersprungen hat und DANN „Heute korrigieren" benutzt,
  // meint aber die Stelle, die er sieht: die Skips sind in seiner Wahl bereits
  // enthalten. Ohne diese Merkung wurden sie ein zweites Mal addiert, und die
  // Auswahl landete eine Einheit daneben (bei drei Einheiten sogar wieder am
  // Anfang). Später hinzukommende Skips rücken weiterhin ganz normal.
  plan.anker = { iso: heute, index: idx, skipsVerrechnet: skipsAmTag(state, modul, heute) };
  plan.position = idx;
}

// ------------------------------------------------------------
// Zyklus: nächste Einheit, Plan → Session
// ------------------------------------------------------------

/** Die als Nächstes anstehende Einheit — null ohne Plan/Zyklus. */
export function naechsteEinheit(state, modul) {
  // Nutzt jetzt die dynamische Positionsberechnung (Anker + Verlauf).
  return aktuelleEinheit(state, modul);
}

/**
 * Brücke Plan → Log: frische Session mit vorbefüllten (leeren) Segmenten.
 * Hängt NICHT in state.sessions ein und schaltet NICHT weiter.
 */
export function sessionAusEinheit(state, modul, einheitId, { datum } = {}) {
  const e = mussEinheit(state, modul, einheitId);
  const session = neueSession({ datum, ausPlan: e.id });
  for (const vorlage of e.segmente) {
    session.segmente.push(neuesSegment(vorlage.aktivitaetId));
  }
  return session;
}

// ------------------------------------------------------------
// intern
// ------------------------------------------------------------
function mussPlan(state, modul) {
  const plan = planFuer(state, modul);
  if (!plan) throw new Error(`Kein Plan für Modul '${modul}'.`);
  return plan;
}
function mussEinheit(state, modul, einheitId) {
  const e = findeEinheit(state, modul, einheitId);
  if (!e) throw new Error('Einheit nicht gefunden.');
  return e;
}


// ============================================================
// DYNAMISCHE ZYKLUS-POSITION (Teil 1)
//
// Statt einer festen `position` wird die Position aus einem ANKER
// (Datum + Zyklus-Index an dem Tag) und dem Trainingsverlauf berechnet.
// Läuft vom Anker bis heute und rückt pro vergangenem Kalendertag:
//   - Ruhetag:            immer weiter (auch ohne Aktion)
//   - Krafttag erledigt:  weiter
//   - Krafttag offen:     bleibt stehen (wartet)
//   - übersprungen:       weiter (egal ob Kraft/Ruhe)
// Heute selbst rückt NICHT — der Tag ist ja noch nicht vorbei.
// Dadurch zeigen Heute- und Plan-Tab am selben Tag immer dasselbe,
// und ein Import kann nie „veralten".
// ============================================================

/** Ist diese Einheit ein Ruhetag? (keine Kraftübungen enthalten) */
export function istRuhetag(einheit) {
  if (!einheit) return false;
  if (einheit.typ === 'rest') return true;
  const segs = einheit.segmente ?? [];
  if (segs.length === 0) return true;
  // Ruhetag, wenn keine der Aktivitäten eine Kraftübung ist. Da wir hier die
  // Aktivitätstypen nicht auflösen, gilt die Konvention: leere/als rest
  // markierte Einheiten sind Ruhetage. Feinere Erkennung macht der Aufrufer.
  return false;
}

/**
 * Tages-Status für die Positionsberechnung.
 * Gibt für einen ISO-Tag zurück: 'erledigt' | 'uebersprungen' | 'offen'.
 * Nutzt die Kraft-Sessions des Tages.
 */
export function tagesStatus(state, modul, iso) {
  const sessions = (state.sessions ?? []).filter(
    s => s.datum === iso && (s.modul ?? 'kraft') === modul);
  // Erledigt hat Vorrang: erst übersprungen, dann doch trainiert → erledigt.
  if (sessions.some(s => s.abgeschlossen && !s.uebersprungen)) return 'erledigt';
  if (sessions.some(s => s.uebersprungen)) return 'uebersprungen';
  return 'offen';
}

/**
 * Wie viele Einheiten wurden an diesem Tag übersprungen?
 * Jeder Skip rückt den Zyklus um eins vor — man darf so oft überspringen,
 * wie man will (keine Bevormunding). Der Kalendertag bleibt derselbe.
 */
export function skipsAmTag(state, modul, iso) {
  return (state.sessions ?? []).filter(
    s => s.datum === iso && (s.modul ?? 'kraft') === modul && s.uebersprungen).length;
}

/**
 * Berechnet die heutige Zyklus-Position dynamisch.
 * @param anker { iso, index }  — an `iso` galt Zyklus-Index `index`.
 * @param istRuhe (einheit)=>bool — erlaubt dem Aufrufer feinere Ruhetag-Erkennung.
 */
export function berechnePositionHeute(state, modul, anker, heute = heuteIso(), istRuhe = istRuhetag) {
  const plan = planFuer(state, modul);
  if (!plan || plan.zyklus.length === 0) return 0;
  const len = plan.zyklus.length;
  if (!anker) return plan.position % len;

  let pos = ((anker.index % len) + len) % len;
  let d = anker.iso;
  // von Anker bis (ausschließlich) heute
  while (d < heute) {
    const skips = skipsAmTag(state, modul, d);
    if (skips > 0) {
      // Jeder Skip rückt eine Einheit vor.
      pos = (pos + skips) % len;
      // Wurde an dem Tag nach den Skips doch noch trainiert? Dann rückt der
      // erledigte Tag zusätzlich (er ist ja mit dem Kalendertag abgeschlossen).
      if (tagesStatus(state, modul, d) === 'erledigt') pos = (pos + 1) % len;
    } else {
      const einheitId = plan.zyklus[pos % len];
      const einheit = plan.einheiten.find(e => e.id === einheitId);
      const status = tagesStatus(state, modul, d);
      if (istRuhe(einheit)) {
        pos = (pos + 1) % len;           // Ruhetag rückt immer
      } else if (status === 'erledigt') {
        pos = (pos + 1) % len;           // Krafttag nur wenn erledigt
      }
      // sonst: offener Krafttag → bleibt stehen
    }
    d = naechsterTag(d);
  }
  // Heute selbst: jeder Skip ist sofort „durch" und rückt weiter.
  // (Erledigt/offen wirken erst morgen — der Tag ist ja noch nicht vorbei.)
  // Skips, die beim Setzen des Ankers schon da waren, stecken bereits in
  // anker.index — die dürfen nicht doppelt zählen.
  const schonVerrechnet = anker.iso === heute ? (anker.skipsVerrechnet ?? 0) : 0;
  const offeneSkips = Math.max(0, skipsAmTag(state, modul, heute) - schonVerrechnet);
  pos = (pos + offeneSkips) % len;
  return pos;
}

/**
 * Robuster Ruhetag-Erkenner: löst die Aktivitäten der Einheit auf.
 * Ruhetag = keine Übungen ODER alle Übungen sind Cardio (Active Rest).
 */
export function einheitIstRuhetag(state, einheit) {
  if (!einheit) return false;
  if (einheit.typ === 'rest') return true;
  const segs = einheit.segmente ?? [];
  if (segs.length === 0) return false;   // leere Einheit ist kein sicherer Ruhetag
  const aktivitaeten = segs.map(s => findeAktivitaet(state, s.aktivitaetId)).filter(Boolean);
  if (aktivitaeten.length === 0) return false;
  return aktivitaeten.every(a => a.cardio === true);   // alle Übungen Cardio → Active Rest
}

/**
 * Anker holen oder initialisieren. Bis zur Migration (die einen echten
 * Anker aus dem Verlauf setzt) leiten wir ihn aus der aktuellen festen
 * position + heute ab — so bleibt das Verhalten für Bestandsdaten stabil.
 */
function holeAnker(plan, heute) {
  if (plan.anker && plan.anker.iso && Number.isInteger(plan.anker.index)) return plan.anker;
  plan.anker = { iso: heute, index: (plan.position ?? 0) % Math.max(1, plan.zyklus.length) };
  return plan.anker;
}

/**
 * Die HEUTE fällige Einheit — über die dynamische Position berechnet.
 * Ersetzt die alte feste-position-Logik von naechsteEinheit.
 *
 * ⚠️ SEITENEFFEKT: Diese Funktion liest nicht nur, sie schreibt auch
 * `plan.position` (als Spiegel) und legt via holeAnker() ggf. einen Anker an.
 * Sie ist damit KEINE reine Abfrage. Das ist bewusst so, damit ältere
 * UI-Teile, die noch `plan.position` lesen, einen aktuellen Wert sehen.
 * Wer nur die Position OHNE Seiteneffekt braucht, nimmt direkt
 * berechnePositionHeute(). Die Quelle der Wahrheit ist IMMER der Anker.
 */
export function aktuelleEinheit(state, modul, heute = heuteIso()) {
  const plan = planFuer(state, modul);
  if (!plan || plan.zyklus.length === 0) return null;
  const anker = holeAnker(plan, heute);
  const pos = berechnePositionHeute(state, modul, anker, heute,
    (e) => einheitIstRuhetag(state, e));
  plan.position = pos;   // Spiegel/Cache — NICHT die Quelle der Wahrheit (das ist der Anker)
  const id = plan.zyklus[pos % plan.zyklus.length];
  return plan.einheiten.find(e => e.id === id) ?? null;
}
