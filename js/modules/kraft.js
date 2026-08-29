// ============================================================
// kraft.js — das Kraft-Modul.
//
// Diese Datei ist die Fabrik: sie hält den Oberflächen-Zustand, setzt die
// Ansichten zusammen und beantwortet die Aktionen. Alles andere liegt
// daneben in kraft/:
//
//   kraft/logik.js               die Rechenregeln (Progression, PRs, Verlauf)
//   kraft/eingabe-html.js        DER eine Renderer für Eingabefelder
//   kraft/heute-ansicht.js       Heute-Tab
//   kraft/plan-ansicht.js        Plan-Tab + Bottom-Sheets
//   kraft/fortschritt-ansicht.js Fortschritt-Bereich
//
// Der Oberflächen-Zustand (welche Karte offen ist, welcher Picker läuft)
// wohnt hier und wird an die Ansichten durchgereicht. Sets wandern als
// Referenz mit; was neu ZUGEWIESEN wird, steht im Objekt `ui`.
//
// Nach außen bleibt die Datei die eine Adresse für alles Kraft-bezogene:
// die Logik wird weiter von hier re-exportiert, damit app.js, die Ansichten
// und die Tests nichts über die interne Aufteilung wissen müssen.
// ============================================================

import { MESSWERTE, formatZahl, parseZahl, parseDauer } from '../core/metrics.js';
import {
  heuteIso, neueSession, neuesSegment, neuerEintrag, addSegment, addEintrag, hatFlag,
  findeAktivitaet, loeseSegmentAuf,
} from '../core/model.js';
import {
  addAktivitaet, addAlternative, entferneAlternative, vorschlagMesswerte,
  benenneUm, setzeMesswerte, entferneAktivitaet, archiviere,
} from '../core/library.js';
import {
  planFuer, addEinheit, benenneEinheitUm, loescheEinheit,
  findeEinheit, addAktivitaetZuEinheit, entferneAktivitaetAusEinheit,
  verschiebeAktivitaetInEinheit, zyklusEinheiten, addZuZyklus, entferneAusZyklus,
  verschiebeImZyklus, setzeAnker, naechsteEinheit, sessionAusEinheit,
  setzeRuhetag,
} from '../core/plan.js';
import { teileKarte } from '../ui/share.js';
import { bestaetige, hinweis } from '../ui/components.js';

import {
  MODUL, PROG_DEFAULTS, identVon, prefillEintrag, nurVorschlaege, beruehrt,
  kannKraftSessionStarten, sessionVolumenErledigt, sessionHighlights,
  fmtSatz, segmentZusammenfassungWerte,
} from './kraft/logik.js';
import { distanzZuMeter } from './kraft/eingabe-html.js';
import { erstelleHeuteAnsicht } from './kraft/heute-ansicht.js';
import { erstellePlanAnsicht } from './kraft/plan-ansicht.js';
import { erstelleFortschrittAnsicht } from './kraft/fortschritt-ansicht.js';

// Öffentliche Oberfläche: unverändert, egal wie es innen aufgeteilt ist.
export * from './kraft/logik.js';
export * from './kraft/eingabe-html.js';

export function erstelleKraftModul(ctx) {
  // ctx: { state, save(), render(), sheet, esc, formatDatum, tabWechsel? }
  const { sheet, esc, formatDatum } = ctx;
  const tabWechsel = ctx.tabWechsel ?? (() => {});

  // UI-Zustand (nicht persistiert)
  const offen = new Set();          // erledigte Karten, die manuell AUFgeklappt wurden
  const zu = new Set();             // offene Karten, die manuell ZUgeklappt wurden
  const verlaufOffen = new Set();   // aufgeklappte Verläufe
  const altOffen = new Set();       // offene Alternativen-Umschalter
  const planOffen = new Set();      // aufgeklappte Plan-Einheiten
  // Veränderlicher Oberflächen-Zustand, den auch die Ansichten lesen. Sets
  // wandern von allein mit (Referenz); diese beiden werden neu ZUGEWIESEN und
  // brauchen deshalb ein gemeinsames Objekt.
  const ui = {
    picker: null,           // { ziel:'session'|'einheit', einheitId?, suche:'' }
    progMetrik: 'gewicht',  // Fortschritt: 'gewicht' | 'avg' | 'volumen'
    umbenennen: null,       // { typ:'einheit'|'altName'|'altNeu', id?, altId?, wert }
  };
  const progExpand = new Set();     // Übungs-IDs mit vollständig ausgeklappter Verlaufsliste
  const progGruppeAuf = new Set();  // manuell aufgeklappte Einheiten-Gruppen im Fortschritt
  const progGruppeZu = new Set();   // manuell zugeklappte (übersteuert die heute-Automatik)

  const S = () => ctx.state;
  // Heutige Kraft-Sessions; eine noch OFFENE hat Vorrang (die bearbeitet man
  // gerade), sonst die zuletzt angelegte. Pro Tag ist ohnehin nur eine
  // erlaubt (siehe kannKraftSessionStarten) — die Liste bleibt trotzdem
  // tolerant, damit Altbestände mit mehreren Einträgen lesbar bleiben.
  const heutigeSessions = () =>
    S().sessions.filter(s => s.datum === heuteIso() && s.modul === MODUL && !s.uebersprungen);
  const heutigeSession = () => {
    const alle = heutigeSessions();
    return alle.find(s => !s.abgeschlossen) ?? alle.at(-1) ?? null;
  };

  function effektiveEinstellungen(seg) {
    const { aktivitaet, alternative } = loeseSegmentAuf(S(), seg);
    return (seg.altOf ? alternative?.einstellungen : aktivitaet?.einstellungen) ?? {};
  }

  // Die Ansichten bekommen denselben Zustand, auf dem auch die Aktionen
  // arbeiten — die Sets als Referenz, das Veränderliche im Objekt `ui`.
  const ansichtKontext = {
    S, esc, formatDatum, sheet, ui,
    offen, zu, verlaufOffen, altOffen, planOffen,
    progExpand, progGruppeAuf, progGruppeZu,
    heutigeSession, effektiveEinstellungen,
  };
  const { heuteHtml, aktualisiereVolumenAnzeige } = erstelleHeuteAnsicht(ansichtKontext);
  const {
    planHtml, heuteWaehlenHtml, einheitNeuHtml, umbenennenHtml,
    zyklusPickerHtml, pickerHtml, einstellungenHtml,
  } = erstellePlanAnsicht(ansichtKontext);
  const { fortschrittHtml } = erstelleFortschrittAnsicht(ansichtKontext);

  /** Segment der laufenden Einheit — die Aktionen sprechen über IDs. */
  const segFinden = id => heutigeSession()?.segmente.find(s => s.id === id) ?? null;

  async function speichernUndZeigen() { await ctx.save(); ctx.render(); }

  /**
   * Macht ein frisches Segment startklar, damit sofort Felder da sind:
   *  - Kraft: ein erster Satz, mit Gewicht+Wdh aus der letzten Session
   *    vorbefüllt (oder leer beim allerersten Mal).
   *  - Cardio/Sonstiges: ein leerer Eintrag → Eingabefelder sofort sichtbar.
   * Passiert nur, wenn das Segment noch gar keine Einträge hat.
   */
  function bereiteSegmentVor(session, seg) {
    if (seg.eintraege.length) return;
    const { aktivitaet } = loeseSegmentAuf(S(), seg);
    if (!aktivitaet) return;
    if (aktivitaet.kategorie === 'kraft') {
      const pf = prefillEintrag(S(), identVon(seg), session.datum);
      addEintrag(seg, pf ?? neuerEintrag({}));
    } else {
      addEintrag(seg, neuerEintrag({}));
    }
  }

  const actions = {
    async 'k.start'(d) {
      if (!kannKraftSessionStarten(S(), heuteIso())) {
        await hinweis('Heute läuft schon eine Einheit',
          'Pro Tag gibt es eine Kraft-Einheit. Ergänze die bestehende — oder korrigiere über „Heute korrigieren", welche heute dran ist.');
        return;
      }
      const s = sessionAusEinheit(S(), MODUL, d.einheit);
      s.modul = MODUL;
      S().sessions.push(s);
      s.segmente.forEach(seg => { offen.add(seg.id); bereiteSegmentVor(s, seg); });
      await speichernUndZeigen();
    },
    async 'k.ueberspringen'() {
      const naechste = naechsteEinheit(S(), MODUL);
      const name = naechste?.name ?? 'Einheit';
      const antwort = await bestaetige({
        titel: 'Tag überspringen?',
        text: `„${name}" wird übersprungen und der Zyklus rückt eine Position weiter.`,
        jaText: 'Überspringen',
        schalter: { label: 'Im Verlauf vermerken', an: false },
      });
      if (!antwort.ok) return;
      // Neue Logik: Überspringen legt IMMER eine uebersprungen-Session für heute
      // an. Die dynamische Positionsberechnung rückt dadurch weiter (auch für
      // heute). Der Schalter steuert nur, ob der Tag im Verlauf sichtbar wird.
      const s = neueSession(); s.modul = MODUL;
      s.uebersprungen = true;
      s.ausPlan = naechste?.id ?? null;
      s.uebersprungenName = name;
      s.imVerlauf = antwort.schalter === true;   // Sichtbarkeit im Verlauf
      S().sessions.push(s);
      await speichernUndZeigen();
    },
    async 'k.frei'() {
      if (!kannKraftSessionStarten(S(), heuteIso())) {
        await hinweis('Heute läuft schon eine Einheit',
          'Pro Tag gibt es eine Kraft-Einheit. Ergänze die bestehende — oder korrigiere über „Heute korrigieren", welche heute dran ist.');
        return;
      }
      const s = neueSession(); s.modul = MODUL;
      S().sessions.push(s);
      await speichernUndZeigen();
    },
    async 'k.sessionNotiz'(d, el) {
      const s = heutigeSession(); if (!s) return;
      s.notiz = el.value;
      await ctx.save();   // kein Re-Render → Cursor/Fokus im Textfeld bleibt
    },
    async 'k.teilen'(d) {
      // Session finden: aus Heute oder per Datum aus dem Verlauf
      const s = d.datum
        ? S().sessions.find(x => x.id === d.sid)
        : heutigeSession();
      if (!s) return;
      const einheit = s.ausPlan ? findeEinheit(S(), MODUL, s.ausPlan) : null;
      const zeilen = [];
      for (const seg of s.segmente) {
        if (seg.erledigt !== true) continue;
        const { aktivitaet, anzeigeName } = loeseSegmentAuf(S(), seg);
        if (!aktivitaet) continue;
        const detail = aktivitaet.kategorie === 'kraft'
          ? seg.eintraege.map(fmtSatz).join(', ')
          : segmentZusammenfassungWerte(aktivitaet, seg);
        zeilen.push({ name: anzeigeName, detail });
      }
      const highlightRoh = sessionHighlights(S(), s);
      const hl = highlightRoh.map(h => ({
        name: h.name, text: h.text, pr: h.art.startsWith('pr'),
      }));

      // Tagesrückblick: gebündelte Kennzahlen der Session.
      const prAnzahl = highlightRoh.filter(h => h.art.startsWith('pr')).length;
      const verbessert = highlightRoh.filter(h => !h.art.startsWith('pr')).length;
      let cardioMin = 0, kraftSaetze = 0;
      for (const seg of s.segmente) {
        if (seg.erledigt !== true) continue;
        const { aktivitaet } = loeseSegmentAuf(S(), seg);
        if (!aktivitaet) continue;
        if (aktivitaet.cardio || aktivitaet.kategorie !== 'kraft') {
          for (const e of seg.eintraege) {
            const sek = e.messwerte?.dauer ?? 0;
            cardioMin += Math.round(sek / 60);
          }
        } else {
          kraftSaetze += seg.eintraege.length;
        }
      }
      const rueckblick = [];
      if (prAnzahl > 0) rueckblick.push({ icon: '🏆', text: `${prAnzahl} neue${prAnzahl === 1 ? 's' : ''} Top-Gewicht${prAnzahl === 1 ? '' : 'e'}` });
      if (verbessert > 0) rueckblick.push({ icon: '💪', text: `${verbessert} Übung${verbessert === 1 ? '' : 'en'} verbessert` });
      if (kraftSaetze > 0) rueckblick.push({ icon: '🏋️', text: `${kraftSaetze} Sätze` });
      if (cardioMin > 0) rueckblick.push({ icon: '🔥', text: `${cardioMin} Min Cardio` });

      // Hero-Wert der Karte: normalerweise das Trainingsvolumen. An reinen
      // Cardio-/Ruhetagen (kein gehobenes Gewicht) wäre „0 kg" irreführend —
      // dann zeigen wir stattdessen die Gesamt-Cardiozeit.
      const vol = sessionVolumenErledigt(s);
      let heroLabel = 'TRAININGSVOLUMEN';
      let heroText = `${formatZahl(vol, 0)} kg`;
      if (vol <= 0 && cardioMin > 0) {
        heroLabel = 'CARDIO';
        heroText = cardioMin >= 60
          ? `${Math.floor(cardioMin / 60)}:${String(cardioMin % 60).padStart(2, '0')} h`
          : `${cardioMin} min`;
      }

      const daten = {
        modul: MODUL,
        eyebrow: 'KRAFT · TRAINING',
        titel: einheit ? einheit.name : 'Training',
        datum: formatDatum(s.datum),
        volumenText: heroText,
        volumenLabel: heroLabel,
        zeilen,
        highlights: hl,
        rueckblick,
        notiz: (s.notiz ?? '').trim() || null,
      };
      try {
        const res = await teileKarte(daten, `all-in-one-${s.datum}.png`);
        if (res === 'heruntergeladen') await hinweis('Bild gespeichert ✓');
      } catch (err) {
        await hinweis('Teilen nicht möglich', err.message);
      }
    },
    async 'k.abschliessen'() {
      const s = heutigeSession(); if (!s) return;
      s.abgeschlossen = true;
      // Neue Zyklus-Logik: Abschließen markiert den Tag nur als erledigt.
      // Der Zeiger wird NICHT mehr sofort gerückt — die Position wird
      // dynamisch berechnet und springt erst zum nächsten Kalendertag.
      // So zeigen Heute- und Plan-Tab am selben Tag immer denselben Tag.
      await speichernUndZeigen();
    },
    async 'k.wiederOeffnen'() {
      const s = heutigeSession(); if (!s) return;
      s.abgeschlossen = false;
      await speichernUndZeigen();
    },

    'k.progMetrik'(d) { ui.progMetrik = d.m; ctx.render(); },
    'k.progExpand'(d) { progExpand.has(d.akt) ? progExpand.delete(d.akt) : progExpand.add(d.akt); ctx.render(); },
    'k.progGruppe'(d) {
      const eid = d.eid;
      const heute = naechsteEinheit(S(), MODUL);
      const istHeute = eid === heute?.id;
      // aktuellen Offen-Zustand ermitteln und kippen
      const offen = istHeute ? !progGruppeZu.has(eid) : progGruppeAuf.has(eid);
      if (offen) {  // → zuklappen
        if (istHeute) progGruppeZu.add(eid); else progGruppeAuf.delete(eid);
      } else {      // → aufklappen
        if (istHeute) progGruppeZu.delete(eid); else progGruppeAuf.add(eid);
      }
      ctx.render();
    },

    'k.auf'(d) {
      const seg = segFinden(d.seg); if (!seg) { ctx.render(); return; }
      if (seg.erledigt) {                         // erledigt: offen-Set steuert das Aufklappen
        offen.has(d.seg) ? offen.delete(d.seg) : offen.add(d.seg);
      } else {                                    // nicht erledigt: zu-Set steuert das Zuklappen
        zu.has(d.seg) ? zu.delete(d.seg) : zu.add(d.seg);
      }
      ctx.render();
    },
    'k.verlauf'(d) { verlaufOffen.has(d.seg) ? verlaufOffen.delete(d.seg) : verlaufOffen.add(d.seg); ctx.render(); },
    'k.altListe'(d) { altOffen.has(d.seg) ? altOffen.delete(d.seg) : altOffen.add(d.seg); ctx.render(); },

    async 'k.check'(d) {
      const seg = segFinden(d.seg); if (!seg) return;
      if (!seg.erledigt) {
        // Beim Abhaken: falls noch leer, ersten Satz aus letzter Session übernehmen
        const { aktivitaet } = loeseSegmentAuf(S(), seg);
        if (aktivitaet?.kategorie === 'kraft' && !seg.eintraege.length) {
          const pf = prefillEintrag(S(), identVon(seg));
          if (pf) addEintrag(seg, pf);
        }
        seg.erledigt = true;
        offen.delete(seg.id); zu.delete(seg.id);   // abgehakt → zu (Übersteuerungen zurücksetzen)
      } else {
        seg.erledigt = false;
        offen.delete(seg.id); zu.delete(seg.id);   // wieder offen → Übersteuerungen zurücksetzen
      }
      await speichernUndZeigen();
    },

    async 'k.satzPlus'(d) {
      const seg = segFinden(d.seg); if (!seg) return;
      const letzter = seg.eintraege.at(-1);
      const mw = {};
      if (letzter && !hatFlag(letzter, 'aufwaermsatz')) Object.assign(mw, letzter.messwerte);
      addEintrag(seg, neuerEintrag(mw));
      offen.add(seg.id);
      await speichernUndZeigen();
    },
    async 'k.satzWeg'(d) {
      const seg = segFinden(d.seg); if (!seg) return;
      seg.eintraege = seg.eintraege.filter(e => e.id !== d.eintrag);
      await speichernUndZeigen();
    },
    /**
     * Art des Satzes weiterschalten: normal → Aufwärmsatz → nicht sauber →
     * normal. Ein Knopf statt zwei, weil sich die drei Zustände gegenseitig
     * ausschließen.
     *
     * „Nicht sauber" heißt: Der Satz bleibt mit seinen Zahlen stehen und
     * zählt voll fürs Volumen — die Arbeit war ja da. Er taugt nur nicht als
     * Beleg dafür, dass die Zielwiederholungen erreicht sind, also hält die
     * Progression das Gewicht.
     */
    async 'k.satzArt'(d) {
      const seg = segFinden(d.seg);
      const e = seg?.eintraege.find(x => x.id === d.eintrag); if (!e) return;
      const ohne = (e.flags ?? []).filter(f => f !== 'aufwaermsatz' && f !== 'unsauber');
      if (hatFlag(e, 'aufwaermsatz')) e.flags = [...ohne, 'unsauber'];
      else if (hatFlag(e, 'unsauber')) e.flags = ohne;
      else e.flags = [...ohne, 'aufwaermsatz'];
      beruehrt(e);
      await speichernUndZeigen();
    },
    async 'k.wert'(d, el) {
      const seg = segFinden(d.seg);
      const e = seg?.eintraege.find(x => x.id === d.eintrag); if (!e) return;
      const def = MESSWERTE[d.typ];
      const { aktivitaet } = loeseSegmentAuf(S(), seg);
      let wert;
      if (def.anzeige === 'zeit') wert = parseDauer(el.value);
      else if (def.anzeige === 'distanz') wert = distanzZuMeter(el.value, aktivitaet?.kategorie);
      else wert = parseZahl(el.value);
      if (wert == null) { delete e.messwerte[d.typ]; }
      else {
        if (d.typ === 'gewicht' && effektiveEinstellungen(seg).assist) {
          const plus = e.messwerte.gewicht != null ? e.messwerte.gewicht >= 0 : (e._plus ?? false);
          wert = plus ? Math.abs(wert) : -Math.abs(wert);
          delete e._plus;
        }
        e.messwerte[d.typ] = wert;
      }
      beruehrt(e);
      // WICHTIG: nur speichern, NICHT neu rendern. Sonst wird das Eingabefeld neu
      // erzeugt, der Tastatur-Fokus geht verloren und der „Weiter"-Button springt
      // ins Leere. Volumen/PR/Progression aktualisieren sich beim nächsten Render
      // (Feld verlassen → Karte auf/zu, Abschließen, Tab-Wechsel). Nur die
      // Volumen-Anzeige oben frischen wir direkt und schonend auf.
      await ctx.save();
      aktualisiereVolumenAnzeige();
    },
    async 'k.vorzeichen'(d) {
      const seg = segFinden(d.seg);
      const e = seg?.eintraege.find(x => x.id === d.eintrag); if (!e) return;
      const kg = e.messwerte.gewicht;
      if (typeof kg === 'number' && kg !== 0) {
        e.messwerte.gewicht = -kg;               // Wert da → einfach spiegeln
        delete e._plus;
      } else {
        e._plus = !(e._plus ?? false);           // noch kein Wert → Absicht merken
      }
      beruehrt(e);
      await speichernUndZeigen();
    },
    async 'k.altWahl'(d) {
      const seg = segFinden(d.seg); if (!seg) return;
      const session = heutigeSession();
      const vorher = identVon(seg);
      seg.altOf = d.alt || null;
      // Andere Übung → andere Historie. Steht da nur noch der Vorschlag der
      // alten Übung, wäre er jetzt schlicht falsch: er würde Gewichte zeigen,
      // die zu dieser Übung nie gehoben wurden. Also durch den Vorschlag der
      // neuen Übung ersetzen — und leer lassen, wenn es dazu keine Historie
      // gibt. Getippte Werte bleiben immer stehen, in beide Richtungen.
      if (session && identVon(seg) !== vorher && nurVorschlaege(seg)) {
        const { aktivitaet } = loeseSegmentAuf(S(), seg);
        if (aktivitaet?.kategorie === 'kraft') {
          seg.eintraege = [prefillEintrag(S(), identVon(seg), session.datum) ?? neuerEintrag({})];
        }
      }
      altOffen.delete(d.seg);
      await speichernUndZeigen();
    },

    // ---- Picker ----
    'k.uebungPlus'() { ui.picker = { ziel: 'session', suche: '' }; sheet.oeffne(pickerHtml()); },
    'k.planUebungPlus'(d) { ui.picker = { ziel: 'einheit', einheitId: d.einheit, suche: '' }; sheet.oeffne(pickerHtml()); },
    'k.altWaehlen'(d) { ui.picker = { ziel: 'alternative', aktId: d.akt, suche: '' }; sheet.oeffne(pickerHtml()); },
    'k.suche'(d, el) { ui.picker.suche = el.value; sheet.aktualisiere(pickerHtml()); },
    async 'k.waehle'(d) {
      if (!ui.picker) return;
      if (ui.picker.ziel === 'einheit') {
        addAktivitaetZuEinheit(S(), MODUL, ui.picker.einheitId, d.akt);
        planOffen.add(ui.picker.einheitId);
      } else if (ui.picker.ziel === 'alternative') {
        // Bestehende Übung als Alternative verknüpfen (reiner Verweis).
        const zielAkt = ui.picker.aktId;
        try {
          addAlternative(S(), zielAkt, d.akt);
        } catch (err) {
          await hinweis('Nicht möglich', err.message);
          ui.picker = null; sheet.schliesse(); return;
        }
        ui.picker = null; sheet.schliesse();
        await ctx.save();
        sheet.oeffne(einstellungenHtml(zielAkt, null));   // zurück ins Übungs-Sheet
        ctx.render();
        return;
      } else {
        const s = heutigeSession(); if (!s) return;
        const seg = addSegment(s, neuesSegment(d.akt));
        offen.add(seg.id);
        bereiteSegmentVor(s, seg);   // sofort Felder da (Kraft vorbefüllt, Cardio leer)
      }
      ui.picker = null; sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'k.neu'(d) {
      if (!ui.picker?.suche.trim()) return;
      const zielVorPicker = ui.picker.ziel === 'alternative' ? ui.picker.aktId : null;
      const akt = addAktivitaet(S(), {
        name: ui.picker.suche, kategorie: d.kat, messwerte: vorschlagMesswerte(d.kat),
      });
      await actions['k.waehle']({ akt: akt.id });
      // Falls die neue Übung als Alternative gedacht war, ist sie via k.waehle
      // schon verknüpft. zielVorPicker nur zur Klarheit dokumentiert.
      void zielVorPicker;
    },

    // ---- Plan: Bibliothek ----
    'k.planAuf'(d) { planOffen.has(d.einheit) ? planOffen.delete(d.einheit) : planOffen.add(d.einheit); ctx.render(); },
    'k.einheitPlus'() { ui.picker = { ziel: 'einheit-neu', suche: '' }; sheet.oeffne(einheitNeuHtml('')); },
    'k.einheitNeuSuche'(d, el) { sheet.aktualisiere(einheitNeuHtml(el.value)); },
    async 'k.einheitNeuAnlegen'(d, el) {
      const feld = document.querySelector('[data-change="k.einheitNeuSuche"]');
      const name = (feld?.value ?? '').trim();
      if (!name) return;
      const e = addEinheit(S(), MODUL, { name });
      planOffen.add(e.id);
      sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'k.ruhetag'(d) {
      setzeRuhetag(S(), MODUL, d.einheit, d.an === '1');
      await speichernUndZeigen();
    },
    'k.einheitName'(d) {
      const e = findeEinheit(S(), MODUL, d.einheit);
      ui.umbenennen = { typ: 'einheit', id: d.einheit, titel: 'Einheit ui.umbenennen', wert: e?.name ?? '' };
      sheet.oeffne(umbenennenHtml());
    },
    'k.umbennSuche'(d, el) { if (ui.umbenennen) { ui.umbenennen.wert = el.value; sheet.aktualisiere(umbenennenHtml()); } },
    async 'k.umbennOk'() {
      if (!ui.umbenennen) return;
      const name = ui.umbenennen.wert.trim();
      if (!name) return;
      if (ui.umbenennen.typ === 'einheit') {
        benenneEinheitUm(S(), MODUL, ui.umbenennen.id, name);
      } else if (ui.umbenennen.typ === 'altName') {
        // Alternative ist eine echte Übung → direkt ui.umbenennen.
        const alt = findeAktivitaet(S(), ui.umbenennen.altId);
        if (alt) alt.name = name;
      } else if (ui.umbenennen.typ === 'altNeu') {
        // Neue Alternative als echte Übung anlegen und verweisen.
        const basis = findeAktivitaet(S(), ui.umbenennen.id);
        const neu = addAktivitaet(S(), {
          name, kategorie: basis?.kategorie ?? 'kraft',
          messwerte: [...(basis?.messwerte ?? [])],
        });
        if (basis?.cardio) neu.cardio = true;
        (basis.alternativen ??= []).push(neu.id);
      }
      const reopenAkt = (ui.umbenennen.typ === 'altName' || ui.umbenennen.typ === 'altNeu') ? ui.umbenennen.id : null;
      ui.umbenennen = null;
      sheet.schliesse();
      await ctx.save();
      if (reopenAkt) sheet.oeffne(einstellungenHtml(reopenAkt, null)); // zurück ins Übungs-Sheet
      ctx.render();
    },
    async 'k.einheitWeg'(d) {
      const e = findeEinheit(S(), MODUL, d.einheit);
      const imZyklus = (planFuer(S(), MODUL)?.zyklus ?? []).filter(id => id === d.einheit).length;
      const text = imZyklus
        ? `„${e?.name}" verschwindet ${imZyklus}× aus dem Zyklus. Deine Sessions bleiben erhalten.`
        : `„${e?.name}" wird gelöscht.`;
      if (!await bestaetige({ titel: 'Einheit löschen?', text, jaText: 'Löschen', gefahr: true })) return;
      loescheEinheit(S(), MODUL, d.einheit);
      await speichernUndZeigen();
    },
    async 'k.planUebungSchieb'(d) { verschiebeAktivitaetInEinheit(S(), MODUL, d.einheit, +d.i, +d.r); await speichernUndZeigen(); },
    async 'k.planUebungWeg'(d) { entferneAktivitaetAusEinheit(S(), MODUL, d.einheit, d.akt); await speichernUndZeigen(); },

    // ---- Plan: Zyklus (Ablauf) ----
    async 'k.zyklusSchieb'(d) { verschiebeImZyklus(S(), MODUL, +d.i, +d.r); await speichernUndZeigen(); },
    async 'k.zyklusWeg'(d) { entferneAusZyklus(S(), MODUL, +d.i); await speichernUndZeigen(); },
    async 'k.zyklusPlusDirekt'(d) { addZuZyklus(S(), MODUL, d.einheit); await speichernUndZeigen(); },
    'k.zyklusPlus'() { ui.picker = { ziel: 'zyklus', suche: '' }; sheet.oeffne(zyklusPickerHtml()); },
    'k.zyklusSuche'(d, el) { ui.picker.suche = el.value; sheet.aktualisiere(zyklusPickerHtml(el.value)); },
    async 'k.zyklusWaehle'(d) {
      addZuZyklus(S(), MODUL, d.einheit);
      ui.picker = null; sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'k.zyklusNeu'() {
      const name = ui.picker?.suche.trim();
      if (!name) return;
      const e = addEinheit(S(), MODUL, { name });
      addZuZyklus(S(), MODUL, e.id);
      planOffen.add(e.id);
      ui.picker = null; sheet.schliesse();
      await speichernUndZeigen();
    },

    // ---- Heute korrigieren (Zyklus-Zeiger per Stelle setzen) ----
    'k.heuteWaehlen'() { sheet.oeffne(heuteWaehlenHtml()); },
    async 'k.heuteSetzen'(d) {
      const zielEinheit = zyklusEinheiten(S(), MODUL)[+d.i] ?? null;
      // Bestehende heutige Session behandeln, damit die neu gewählte Einheit
      // im Heute-Tab auch wirklich erscheint (nicht die alte „klebt").
      const s = heutigeSession();
      if (s) {
        const leer = !s.abgeschlossen && s.segmente.every(seg => !seg.erledigt && seg.eintraege.length === 0);
        const gleicheEinheit = zielEinheit && s.ausPlan === zielEinheit.id;
        if (leer) {
          S().sessions = S().sessions.filter(x => x !== s);   // leere immer verwerfen
        } else if (!gleicheEinheit) {
          // Session mit Daten/abgeschlossen, aber ANDERE Einheit → nachfragen
          const ok = await bestaetige({
            titel: 'Andere Einheit heute?',
            text: 'Für heute liegt schon eine andere Einheit vor. Verwerfen und stattdessen die gewählte starten? Bei Abbrechen bleibt alles, wie es ist.',
            jaText: 'Verwerfen', gefahr: true,
          });
          // Abbrechen heißt: NICHTS passiert. Vorher wurde der Anker trotzdem
          // gesetzt — der Zyklus verschob sich also unsichtbar, obwohl man
          // abgebrochen hatte.
          if (!ok) return;
          S().sessions = S().sessions.filter(x => x !== s);
        }
      }
      setzeAnker(S(), MODUL, +d.i);
      sheet.schliesse();
      tabWechsel('heute');
      await speichernUndZeigen();
    },

    // ---- Einstellungen-Sheet ----
    'k.einstellungen'(d) { sheet.oeffne(einstellungenHtml(d.akt, d.alt || null)); },
    async 'k.aktName'(d, el) {
      const name = el.value.trim();
      if (!name) return;
      benenneUm(S(), d.akt, name);
      await ctx.save(); ctx.render(); // Sheet-Titel nicht neu bauen (Fokus im Feld halten)
    },
    async 'k.geraeteNotiz'(d, el) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      const t = el.value.trim();
      if (t) akt.notiz = t; else delete akt.notiz;
      await ctx.save(); ctx.render();   // Heute-Tab zeigt die Notiz dann sofort
    },
    async 'k.mwToggle'(d) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      const hat = akt.messwerte.includes(d.typ);
      // Mindestens ein Messwert muss bleiben
      if (hat && akt.messwerte.length <= 1) { await hinweis('Mindestens ein Messwert muss aktiv bleiben.'); return; }
      const neu = hat ? akt.messwerte.filter(t => t !== d.typ) : [...akt.messwerte, d.typ];
      setzeMesswerte(S(), d.akt, neu);
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.aktArchiv'(d) {
      const akt = findeAktivitaet(S(), d.akt);
      if (!await bestaetige({ titel: 'Übung archivieren?',
        text: `„${akt?.name}" verschwindet aus Auswahllisten, dein Verlauf bleibt erhalten.`,
        jaText: 'Archivieren' })) return;
      archiviere(S(), d.akt);
      sheet.schliesse();
      await speichernUndZeigen();
    },
    async 'k.aktWeg'(d) {
      const akt = findeAktivitaet(S(), d.akt);
      if (!await bestaetige({ titel: 'Übung löschen?',
        text: `„${akt?.name}" wird endgültig gelöscht.`, jaText: 'Löschen', gefahr: true })) return;
      try {
        entferneAktivitaet(S(), d.akt);
        sheet.schliesse();
        await speichernUndZeigen();
      } catch (err) {
        await hinweis('Nicht möglich', err.message);
      }
    },
    async 'k.flagEinarmig'(d) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      akt.einstellungen ??= {};
      if (akt.einstellungen.einarmig) delete akt.einstellungen.einarmig;
      else akt.einstellungen.einarmig = true;
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.flagAssist'(d) {
      const akt = findeAktivitaet(S(), d.akt); if (!akt) return;
      akt.einstellungen ??= {};
      if (akt.einstellungen.assist) delete akt.einstellungen.assist;
      else akt.einstellungen.assist = true;
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
    async 'k.progArt'(d) {
      // Ziel ist entweder die Übung selbst oder die Alternative (echte Übung).
      const ziel = d.alt ? findeAktivitaet(S(), d.alt) : findeAktivitaet(S(), d.akt);
      if (!ziel) return;
      ziel.einstellungen ??= {};
      if (d.art === 'off') delete ziel.einstellungen.prog;
      else {
        // Reihenfolge: Standardwerte der Art, darüber die bisherigen Werte
        // (nur wenn es dieselbe Art ist), und `art` zuletzt — damit keine
        // der beiden Spreizungen sie überschreibt.
        const bisher = ziel.einstellungen.prog?.art === d.art ? ziel.einstellungen.prog : {};
        ziel.einstellungen.prog = { ...PROG_DEFAULTS[d.art], ...bisher, art: d.art };
      }
      await ctx.save();
      sheet.aktualisiere(einstellungenHtml(d.akt, d.alt || null));
      ctx.render();
    },
    async 'k.progParam'(d, el) {
      const ziel = d.alt ? findeAktivitaet(S(), d.alt) : findeAktivitaet(S(), d.akt);
      const prog = ziel?.einstellungen?.prog; if (!prog) return;
      const n = parseZahl(el.value);
      if (n != null && n > 0) prog[d.param] = n;
      await ctx.save(); ctx.render();
    },
    'k.altPlus'(d) {
      ui.umbenennen = { typ: 'altNeu', id: d.akt, titel: 'Neue Alternative',
        hinweis: 'Name der Ersatzübung — z.B. „KH-Bankdrücken".', wert: '' };
      sheet.oeffne(umbenennenHtml());
    },
    'k.altName'(d) {
      // Alternative ist eine echte Übung → direkt finden.
      const alt = findeAktivitaet(S(), d.alt); if (!alt) return;
      ui.umbenennen = { typ: 'altName', id: d.akt, altId: d.alt, titel: 'Alternative ui.umbenennen', wert: alt.name };
      sheet.oeffne(umbenennenHtml());
    },
    async 'k.altWeg'(d) {
      if (!await bestaetige({ titel: 'Alternative löschen?', jaText: 'Löschen', gefahr: true })) return;
      try {
        entferneAlternative(S(), d.akt, d.alt);
        await ctx.save();
      } catch (err) {
        await hinweis('Nicht möglich', err.message); // steckt in Sessions → bleibt erhalten
      }
      sheet.aktualisiere(einstellungenHtml(d.akt, null));
      ctx.render();
    },
  };

  return { heuteHtml, planHtml, fortschrittHtml, actions };
}
