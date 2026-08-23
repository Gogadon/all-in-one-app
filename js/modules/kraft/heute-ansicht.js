// ============================================================
// modules/kraft/heute-ansicht.js — der Heute-Tab.
//
// Startbildschirm (noch keine Einheit begonnen) und die laufende Einheit mit
// ihren Übungskarten, Sätzen und Eingabefeldern.
//
// Bekommt alles, was es braucht, als Kontext übergeben — den Zugriff auf den
// Zustand (S), die Sets des Oberflächen-Zustands und die paar Helfer der
// Fabrik. Die Sets werden als Referenz durchgereicht: Aktionen und Ansicht
// arbeiten auf denselben Objekten, ohne dass eine Kopie synchron gehalten
// werden müsste.
// ============================================================

import { formatZahl } from '../../core/metrics.js';
import { neuerEintrag, hatFlag, findeAktivitaet, loeseSegmentAuf } from '../../core/model.js';
import { findeEinheit, naechsteEinheit } from '../../core/plan.js';
import {
  MODUL, identVon, verlaufLetzte, eintragPR, berechneVorschlag,
  segmentZusammenfassungKraft, segmentZusammenfassungWerte,
  sessionVolumenErledigt, fmtSatz,
} from './logik.js';
import { eintragInputsHtml, escT } from './eingabe-html.js';

export function erstelleHeuteAnsicht(k) {
  const { S, esc, formatDatum, offen, zu, verlaufOffen, altOffen,
    heutigeSession, effektiveEinstellungen } = k;


  function heuteHtml() {
    const s = heutigeSession();
    return s ? sessionHtml(s) : startHtml();
  }

  /** Aktualisiert nur die „kg bewegt"-Zahl im Heute-Tab, ohne Neu-Rendern.
   *  So bleibt beim Werte-Eintragen der Tastatur-Fokus im Eingabefeld. */
  function aktualisiereVolumenAnzeige() {
    const el = document.getElementById('volZahl');
    if (!el) return;
    const s = heutigeSession();
    if (!s) return;
    el.textContent = formatZahl(sessionVolumenErledigt(s), 0);
  }

  function startHtml() {
    const naechste = naechsteEinheit(S(), MODUL);
    if (!naechste) {
      return `<div class="karte leer anim">
        <h2>Noch kein Plan</h2>
        <p>Leg im Plan-Tab deine Einheiten an — oder starte einfach spontan.</p>
        <div class="knopf-zeile">
          <button class="knopf primaer" data-action="tab" data-tab="plan">Plan anlegen</button>
          <button class="knopf" data-action="k.frei">Freie Session</button>
        </div>
      </div>`;
    }
    return `<div class="hero anim">
      <span class="eyebrow"><span class="pip"></span>Nächste Einheit</span>
      <h1>${esc(naechste.name)}</h1>
      <p class="dim">${naechste.segmente.length} Übungen im Plan</p>
      <div class="knopf-zeile">
        <button class="knopf primaer gross" data-action="k.start" data-einheit="${naechste.id}">Jetzt starten</button>
        <button class="knopf" data-action="k.ueberspringen">Überspringen ›</button>
      </div>
      <button class="knopf geist" data-action="k.frei">Freie Session starten</button>
    </div>`;
  }

  function sessionHtml(s) {
    const einheit = s.ausPlan ? findeEinheit(S(), MODUL, s.ausPlan) : null;
    const titel = einheit ? einheit.name : 'Freie Session';
    const vol = sessionVolumenErledigt(s);
    const fertig = s.abgeschlossen === true;

    let html = `<div class="session-kopf anim">
      <div>
        <span class="eyebrow"><span class="pip"></span>${fertig ? 'Erledigt' : 'Heute'}</span>
        <h1>${esc(titel)}</h1>
        <p class="dim">${formatDatum(s.datum)}</p>
      </div>
      <div class="vol"><span class="num" id="volZahl">${formatZahl(vol, 0)}</span><span class="dim">kg bewegt</span></div>
    </div>`;

    html += s.segmente.map(seg => segmentKarteHtml(s, seg)).join('');

    if (!fertig) {
      html += `<button class="knopf geist voll" data-action="k.uebungPlus">+ Übung hinzufügen</button>`;
    }

    // Session-Notiz (Tagesnotiz): immer sichtbar. Bei abgeschlossen nur lesbar,
    // sofern etwas drin steht.
    const notiz = (s.notiz ?? '').trim();
    if (!fertig) {
      html += `<div class="karte notiz-karte">
        <label class="sheet-abschnitt" for="sessionNotiz">Notiz zum Tag</label>
        <textarea id="sessionNotiz" class="notiz-feld" rows="2"
          placeholder="z.B. Schulter links hat gezwickt, Kopf war nicht ganz da…"
          data-change="k.sessionNotiz">${esc(s.notiz ?? '')}</textarea>
      </div>`;
    } else if (notiz) {
      html += `<div class="karte notiz-karte ro">
        <span class="sheet-abschnitt">Notiz zum Tag</span>
        <p class="notiz-text">${esc(notiz)}</p>
      </div>`;
    }

    html += fertig
      ? `<div class="fertig-banner anim">
          <span>Einheit abgeschlossen ✓</span>
          <span class="banner-knoepfe">
            <button class="knopf klein" data-action="k.teilen">Teilen</button>
            <button class="knopf klein" data-action="k.wiederOeffnen">Wieder öffnen</button>
          </span>
        </div>`
      : `<button class="knopf primaer gross voll" data-action="k.abschliessen">Einheit abschließen ✓</button>`;
    return html;
  }

  function segmentKarteHtml(session, seg) {
    const { aktivitaet, anzeigeName } = loeseSegmentAuf(S(), seg);
    if (!aktivitaet) return '';
    const istKraft = aktivitaet.kategorie === 'kraft';
    const readonly = session.abgeschlossen === true;   // abgeschlossen → nur ansehen
    const check = seg.erledigt === true;
    // Offen-Regel: bei abgeschlossen sind erledigte zu (nur Zusammenfassung),
    // sonst wie gehabt. Manuelles Auf-/Zuklappen nur im offenen Zustand.
    const auf = readonly ? false : (check ? offen.has(seg.id) : !zu.has(seg.id));
    const zsf = istKraft ? segmentZusammenfassungKraft(seg) : segmentZusammenfassungWerte(aktivitaet, seg);
    const punktKlasse = aktivitaet.kategorie === 'kraft' ? 'kraft' : aktivitaet.kategorie;
    const geraeteNotiz = (aktivitaet.notiz ?? '').trim();

    // Kopf: bei readonly kein ⚙️, Titel nicht klickbar, Check nur Anzeige
    let html = `<div class="karte segment ${check ? 'erledigt' : ''} ${readonly ? 'ro' : ''} anim">
      <div class="seg-kopf">
        <${readonly ? 'span' : 'button'} class="check ${check ? 'an' : ''}" ${readonly ? '' : `data-action="k.check" data-seg="${seg.id}"`} aria-label="abhaken"></${readonly ? 'span' : 'button'}>
        <${readonly ? 'div' : 'button'} class="seg-titel" ${readonly ? '' : `data-action="k.auf" data-seg="${seg.id}"`}>
          <strong><span class="punkt ${punktKlasse}"></span>${esc(anzeigeName)}</strong>
          <small class="dim">${esc(zsf)}</small>
        </${readonly ? 'div' : 'button'}>
        ${readonly ? '' : `<button class="zahn" data-action="k.einstellungen" data-akt="${aktivitaet.id}" ${seg.altOf ? `data-alt="${seg.altOf}"` : ''}>⚙️</button>`}
      </div>`;

    // Geräte-Notiz: immer sichtbar (auch readonly), wenn vorhanden
    if (geraeteNotiz) {
      html += `<div class="geraete-notiz"><span class="gn-icon">🔧</span>${esc(geraeteNotiz)}</div>`;
    }

    if (auf) {
      html += `<div class="seg-inhalt">`;

      // Alternativen-Umschalter (Tagestausch, altOf)
      // alternativen sind jetzt IDs → zu echten Bibliotheks-Übungen auflösen.
      const altUebungen = (aktivitaet.alternativen ?? [])
        .map(id => findeAktivitaet(S(), id)).filter(Boolean);
      if (altUebungen.length) {
        html += `<button class="chip tausch" data-action="k.altListe" data-seg="${seg.id}">⇄ ${esc(anzeigeName)}</button>`;
        if (altOffen.has(seg.id)) {
          html += `<div class="chip-zeile">
            <button class="chip ${!seg.altOf ? 'aktiv' : ''}" data-action="k.altWahl" data-seg="${seg.id}" data-alt="">${esc(aktivitaet.name)}</button>
            ${altUebungen.map(a =>
              `<button class="chip ${seg.altOf === a.id ? 'aktiv' : ''}" data-action="k.altWahl" data-seg="${seg.id}" data-alt="${a.id}">${esc(a.name)}</button>`).join('')}
          </div>`;
        }
      }

      // Progressions-Vorschlag (nur Kraft)
      if (istKraft) {
        const prog = effektiveEinstellungen(seg).prog;
        const v = berechneVorschlag(S(), identVon(seg), prog, session.datum);
        if (v) html += `<div class="vorschlag ${v.art}">${esc(v.text)}</div>`;
      }

      // Zuletzt + Verlauf
      const verlauf = verlaufLetzte(S(), identVon(seg), 4, session.datum);
      if (verlauf.length) {
        const zeile = t => istKraft
          ? t.segment.eintraege.map(fmtSatz).join(' · ')
          : segmentZusammenfassungWerte(aktivitaet, t.segment);
        html += `<button class="zuletzt" data-action="k.verlauf" data-seg="${seg.id}">
          Zuletzt (${formatDatum(verlauf[0].datum)}): ${esc(zeile(verlauf[0]))} <span class="dim">Verlauf ${verlaufOffen.has(seg.id) ? '⌃' : '⌄'}</span>
        </button>`;
        if (verlaufOffen.has(seg.id)) {
          html += `<div class="verlauf-liste">${verlauf.map((t, i) =>
            `<div class="${i === 0 ? 'gruen' : ''}"><span class="dim">${formatDatum(t.datum)}</span> ${esc(zeile(t))}</div>`).join('')}</div>`;
        }
      }

      // Einträge
      if (istKraft) {
        html += seg.eintraege.map((e, i) => satzZeileHtml(session, seg, aktivitaet, e, i)).join('');
        html += `<button class="knopf klein" data-action="k.satzPlus" data-seg="${seg.id}">+ Satz</button>`;
      } else {
        let e = seg.eintraege[0];
        if (!e) { e = neuerEintrag({}); seg.eintraege.push(e); }
        html += `<div class="satz cardio">${eintragInputsHtml(aktivitaet, seg, e)}</div>`;
      }

      html += `</div>`;
    }
    return html + `</div>`;
  }

  /** Felder eines Kraftsatzes: Gewicht (mit +/− bei assistiert), dann Wdh bzw. L/R. */
  function kraftFelderHtml(aktivitaet, seg, e) {
    const einst = effektiveEinstellungen(seg);
    const assistiert = !!einst.assist;
    const einarmig = !!einst.einarmig;
    const kg = e.messwerte.gewicht;

    // Gewicht: bei assistiert steht davor ein +/−-Umschalter.
    // Intern ist Hilfe negativ; im Feld zeigen wir den Betrag, das Vorzeichen macht der Toggle.
    const kgBetrag = kg == null ? '' : formatZahl(Math.abs(kg));
    let html = '';
    if (assistiert) {
      const neg = kg != null ? kg < 0 : !(e._plus ?? false);   // Default: Hilfe (−)
      html += `<button class="vz ${neg ? 'minus' : 'plus'}" data-action="k.vorzeichen"
        data-seg="${seg.id}" data-eintrag="${e.id}" title="Hilfe (−) oder Zusatzgewicht (+)">${neg ? '−' : '+'}</button>`;
    }
    html += `<label class="feld">
      <input type="text" inputmode="decimal" value="${escT(kgBetrag)}" placeholder="kg"
        data-change="k.wert" data-seg="${seg.id}" data-eintrag="${e.id}" data-typ="gewicht">
      <span>kg</span></label>
      <span class="mal">×</span>`;

    if (einarmig) {
      const l = e.messwerte.wdh_l, r = e.messwerte.wdh_r;
      html += `<label class="feld schmal">
        <input type="text" inputmode="numeric" value="${l != null ? formatZahl(l, 0) : ''}" placeholder="L"
          data-change="k.wert" data-seg="${seg.id}" data-eintrag="${e.id}" data-typ="wdh_l">
        <span>L</span></label>
        <span class="mal">/</span>
        <label class="feld schmal">
        <input type="text" inputmode="numeric" value="${r != null ? formatZahl(r, 0) : ''}" placeholder="R"
          data-change="k.wert" data-seg="${seg.id}" data-eintrag="${e.id}" data-typ="wdh_r">
        <span>R</span></label>`;
    } else {
      const w = e.messwerte.wdh;
      html += `<label class="feld">
        <input type="text" inputmode="numeric" value="${w != null ? formatZahl(w, 0) : ''}" placeholder="Wdh"
          data-change="k.wert" data-seg="${seg.id}" data-eintrag="${e.id}" data-typ="wdh">
        <span>Wdh</span></label>`;
    }
    return html;
  }

  /**
   * Die Satz-Nummer ist zugleich der Umschalter für die Art des Satzes.
   * Ein Tipp weiter: Nummer → A (Aufwärmsatz) → ~ (nicht sauber) → Nummer.
   *
   * Bewusst EIN Knopf statt zwei: Die drei Zustände schließen sich
   * gegenseitig aus (ein Aufwärmsatz zählt nie fürs Ziel, „nicht sauber"
   * wäre dort bedeutungslos), und die Zeile ist auf einem Handy schon voll —
   * ein zweiter Knopf drängte das PR-Abzeichen aus dem Bild.
   * Die Bedeutung des ERSTEN Tipps bleibt, was sie immer war: Aufwärmsatz.
   */
  function satzArtKnopf(seg, eintrag, idx) {
    const warm = hatFlag(eintrag, 'aufwaermsatz');
    const unsauber = hatFlag(eintrag, 'unsauber');
    const zeichen = warm ? 'A' : unsauber ? '~' : idx + 1;
    const titel = warm ? 'Aufwärmsatz — tippen für „nicht sauber"'
      : unsauber ? 'Nicht sauber, zählt nicht fürs Ziel — tippen für normal'
      : 'Normaler Satz — tippen für Aufwärmsatz';
    return `<button class="satz-nr ${warm ? 'warm' : ''} ${unsauber ? 'unsauber' : ''}"
      data-action="k.satzArt" data-seg="${seg.id}" data-eintrag="${eintrag.id}"
      title="${titel}">${zeichen}</button>`;
  }

  function satzZeileHtml(session, seg, aktivitaet, eintrag, idx) {
    const warm = hatFlag(eintrag, 'aufwaermsatz');
    const unsauber = hatFlag(eintrag, 'unsauber');
    const pr = eintragPR(S(), identVon(seg), eintrag, session.datum);
    return `<div class="satz ${warm ? 'warm' : ''} ${unsauber ? 'unsauber' : ''}">
      ${satzArtKnopf(seg, eintrag, idx)}
      ${kraftFelderHtml(aktivitaet, seg, eintrag)}
      ${pr ? `<span class="pr">🎉${pr === 'wdh' ? ' Wdh' : ''}</span>` : ''}
      <button class="weg" data-action="k.satzWeg" data-seg="${seg.id}" data-eintrag="${eintrag.id}">✕</button>
    </div>`;
  }

  return { heuteHtml, aktualisiereVolumenAnzeige };
}
