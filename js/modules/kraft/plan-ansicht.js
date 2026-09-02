// ============================================================
// modules/kraft/plan-ansicht.js — der Plan-Tab und die Bottom-Sheets.
//
// Zyklus (der Ablauf), die Einheiten-Bibliothek, und die Sheets zum Wählen,
// Anlegen, Umbenennen und Einstellen von Übungen. Die Sheets stehen hier,
// weil sie zum Planen gehören — der Heute-Tab öffnet sie zwar auch, aber
// gebaut werden sie aus denselben Bausteinen wie der Plan.
// ============================================================

import { MESSWERTE } from '../../core/metrics.js';
import { findeAktivitaet } from '../../core/model.js';
import {
  aktivitaetenNachKategorie, sucheAktivitaet, referenzenVonAktivitaet,
} from '../../core/library.js';
import {
  planFuer, einheitenBibliothek, zyklusEinheiten, aktuelleEinheit, einheitIstRuhetag,
} from '../../core/plan.js';
import { MODUL, PROG_DEFAULTS } from './logik.js';
import { scheibenSatz } from '../../core/scheiben.js';
import { formatZahl } from '../../core/metrics.js';

export function erstellePlanAnsicht(k) {
  const { S, esc, planOffen, ui, heutigeSession } = k;


  function planHtml() {
    const plan = planFuer(S(), MODUL);
    const zyklus = zyklusEinheiten(S(), MODUL);
    const bib = einheitenBibliothek(S(), MODUL);
    // Aktuelle Position dynamisch berechnen (spiegelt in plan.position).
    aktuelleEinheit(S(), MODUL);
    const pos = plan?.position ?? 0;

    // Ist die heutige Einheit schon abgeschlossen?
    const heuteSession = heutigeSession();
    const heuteErledigt = heuteSession?.abgeschlossen === true;

    let html = `<div class="tab-kopf anim"><span class="eyebrow"><span class="pip"></span>Kraft</span><h1>Plan</h1></div>`;

    // ---- ZYKLUS (Ablauf) ----
    html += `<p class="sheet-abschnitt zwischen">Zyklus · Ablauf</p>`;
    if (!zyklus.length) {
      html += `<div class="karte leer anim"><p>Noch kein Ablauf. Leg unten Einheiten an und füg sie hier zum Zyklus hinzu — dieselbe Einheit darf mehrfach vorkommen.</p></div>`;
    } else {
      html += `<div class="karte zyklus-karte anim">` + zyklus.map((e, i) => `
        <div class="zyklus-zeile ${i === pos ? 'aktuell' : ''}">
          <span class="tag-nr">${i + 1}</span>
          <span class="name">${esc(e.name)}${e.typ === 'rest' ? ' <span class="rest-badge">Rest</span>' : ''}${i === pos ? (heuteErledigt ? ' <span class="dim">· heute ✓</span>' : ' <span class="dim">· heute</span>') : ''}</span>
          <span class="werkzeuge">
            <button data-action="k.zyklusSchieb" data-i="${i}" data-r="-1"><span class="pfeil-ico"></span></button>
            <button data-action="k.zyklusSchieb" data-i="${i}" data-r="1"><span class="pfeil-ico runter"></span></button>
            <button data-action="k.zyklusWeg" data-i="${i}">✕</button>
          </span>
        </div>`).join('') + `</div>`;
      // Hinweis: heute erledigt → nächster Tag startet morgen (Zeiger springt nicht vor)
      if (heuteErledigt) {
        html += `<p class="dim klein-text plan-hinweis">Heute erledigt ✓ — der nächste Zyklustag startet morgen.</p>`;
      }
      html += `<div class="knopf-zeile"><button class="knopf" data-action="k.zyklusPlus">+ Einheit in den Zyklus</button>
        <button class="knopf geist" data-action="k.heuteWaehlen">Heute korrigieren</button></div>`;
    }

    // ---- EINHEITEN-BIBLIOTHEK ----
    html += `<p class="sheet-abschnitt zwischen">Einheiten · Bibliothek</p>`;
    html += `<p class="dim klein-text bib-hinweis">Jede Einheit gibt es einmal. Änderst du hier ihre Übungen, wirkt das an allen Stellen im Zyklus — und in jedem anderen Plan, der sie nutzt.</p>`;
    if (!bib.length) {
      html += `<div class="karte leer anim"><p>Noch keine Einheiten — z.B. „Rücken · Bizeps" oder „Active Rest".</p></div>`;
    } else {
      html += bib.map(e => bibEinheitHtml(e)).join('');
    }
    html += `<button class="knopf primaer voll" data-action="k.einheitPlus">+ Einheit anlegen</button>`;
    return html;
  }

  function bibEinheitHtml(einheit) {
    const auf = planOffen.has(einheit.id);
    const imZyklus = (planFuer(S(), MODUL)?.zyklus ?? []).filter(id => id === einheit.id).length;
    let html = `<div class="karte plan-einheit anim">
      <div class="seg-kopf">
        <button class="seg-titel" data-action="k.planAuf" data-einheit="${einheit.id}">
          <strong>${esc(einheit.name)}${einheit.typ === 'rest' ? ' <span class="rest-badge">Rest</span>' : ''}</strong>
          <small class="dim">${einheit.segmente.length} Übungen${imZyklus ? ` · ${imZyklus}× im Zyklus` : ' · nicht im Zyklus'}</small>
        </button>
        <span class="werkzeuge">
          <button data-action="k.einheitName" data-einheit="${einheit.id}">✎</button>
          <button data-action="k.einheitWeg" data-einheit="${einheit.id}">✕</button>
        </span>
      </div>`;
    if (auf) {
      html += `<div class="seg-inhalt">`;
      html += einheit.segmente.map((v, i) => {
        const akt = findeAktivitaet(S(), v.aktivitaetId);
        if (!akt) return '';
        return `<div class="plan-zeile">
          <span class="punkt ${akt.kategorie}"></span>
          <span class="name">${esc(akt.name)}</span>
          <span class="werkzeuge">
            <button data-action="k.einstellungen" data-akt="${akt.id}">⚙️</button>
            <button data-action="k.planUebungSchieb" data-einheit="${einheit.id}" data-i="${i}" data-r="-1"><span class="pfeil-ico"></span></button>
            <button data-action="k.planUebungSchieb" data-einheit="${einheit.id}" data-i="${i}" data-r="1"><span class="pfeil-ico runter"></span></button>
            <button data-action="k.planUebungWeg" data-einheit="${einheit.id}" data-akt="${akt.id}">✕</button>
          </span>
        </div>`;
      }).join('');
      html += `<div class="knopf-zeile">
        <button class="knopf klein" data-action="k.planUebungPlus" data-einheit="${einheit.id}">+ Übung</button>
        <button class="knopf klein geist" data-action="k.zyklusPlusDirekt" data-einheit="${einheit.id}">In Zyklus einfügen</button>
      </div>`;
      html += ruhetagSchalterHtml(einheit);
      html += `</div>`;
    }
    return html + `</div>`;
  }

  /**
   * Schalter „Als Rest Day markieren".
   * Zeigt zusätzlich an, wenn eine Einheit auch OHNE Markierung schon als
   * Ruhetag behandelt wird (nur Cardio = Active Rest) — sonst wundert man sich,
   * warum der Zyklus weiterrückt, obwohl der Schalter aus ist.
   */
  function ruhetagSchalterHtml(einheit) {
    const an = einheit.typ === 'rest';
    const autoRuhe = !an && einheitIstRuhetag(S(), einheit);
    return `<div class="ruhetag-schalter ${an ? 'an' : ''}">
      <button class="schalter ${an ? 'an' : ''}" role="switch" aria-checked="${an}"
        data-action="k.ruhetag" data-einheit="${einheit.id}" data-an="${an ? '0' : '1'}">
        <span class="schalter-knauf"></span>
      </button>
      <div class="rs-text">
        <strong>Als Rest Day markieren</strong>
        <small class="dim">${an
          ? 'Wird beim Tageswechsel automatisch weitergeschaltet.'
          : autoRuhe
            ? 'Zählt schon jetzt als Ruhetag, weil nur Cardio drin ist.'
            : 'Ruhetage schalten beim Tageswechsel automatisch weiter.'}</small>
      </div>
    </div>`;
  }

  function heuteWaehlenHtml() {
    const zyklus = zyklusEinheiten(S(), MODUL);
    const pos = planFuer(S(), MODUL)?.position ?? 0;
    return `<h3>Welcher Tag ist heute dran?</h3>
      <p class="dim klein-text">Setzt den Zyklus auf diese Stelle — ab dort läuft er normal weiter.</p>
      <div class="picker-liste">${zyklus.map((e, i) =>
        `<button class="picker-zeile ${i === pos ? 'aktiv' : ''}" data-action="k.heuteSetzen" data-i="${i}">
          <span class="tag-nr">${i + 1}</span> ${esc(e.name)}${i === pos ? ' <span class="dim">· aktuell</span>' : ''}
        </button>`).join('')}
      </div>`;
  }

  /** Sheet: neue Einheit anlegen (konsistent zum Übungen-Sheet). */
  function einheitNeuHtml(suche = '') {
    const bib = einheitenBibliothek(S(), MODUL);
    const q = suche.trim().toLowerCase();
    const doppelt = q && bib.some(e => e.name.toLowerCase() === q);
    return `<h3>Neue Einheit</h3>
      <p class="dim klein-text">Name der Einheit — z.B. „Rücken · Bizeps" oder „Active Rest".</p>
      <input class="suche" type="text" placeholder="Name eingeben…" value="${esc(suche)}" data-change="k.einheitNeuSuche" autofocus>
      ${doppelt ? '<p class="dim klein-text">Gibt es schon — trotzdem anlegbar, wird eine zweite mit gleichem Namen.</p>' : ''}
      <button class="knopf primaer ${suche.trim() ? '' : 'aus'}" data-action="k.einheitNeuAnlegen">Anlegen</button>`;
  }

  /** Generisches Umbenennen-Sheet (statt prompt). typ steuert, was gespeichert wird. */
  function umbenennenHtml() {
    const { titel, wert, hinweis } = ui.umbenennen;
    return `<h3>${esc(titel)}</h3>
      ${hinweis ? `<p class="dim klein-text">${esc(hinweis)}</p>` : ''}
      <input class="suche" type="text" placeholder="Name eingeben…" value="${esc(wert)}" data-change="k.umbennSuche" autofocus>
      <button class="knopf primaer ${wert.trim() ? '' : 'aus'}" data-action="k.umbennOk">Speichern</button>`;
  }

  /** Sheet: Einheit aus Bibliothek in den Zyklus wählen (oder neue anlegen). */
  function zyklusPickerHtml(suche = '') {
    const bib = einheitenBibliothek(S(), MODUL);
    const q = suche.trim().toLowerCase();
    const treffer = q ? bib.filter(e => e.name.toLowerCase().includes(q)) : bib;
    return `<h3>Einheit in den Zyklus</h3>
      <input class="suche" type="text" placeholder="Suchen oder neu benennen…" value="${esc(suche)}" data-change="k.zyklusSuche">
      <div class="picker-liste">${treffer.map(e =>
        `<button class="picker-zeile" data-action="k.zyklusWaehle" data-einheit="${e.id}"><span class="punkt kraft"></span>${esc(e.name)}</button>`).join('') || '<p class="dim">Keine Treffer.</p>'}
      </div>
      ${suche.trim() ? `<button class="knopf primaer" data-action="k.zyklusNeu">„${esc(suche.trim())}" neu anlegen & einfügen</button>` : ''}`;
  }



  function pickerHtml() {
    const q = ui.picker.suche;
    let treffer = q ? sucheAktivitaet(S(), q)
      : [...aktivitaetenNachKategorie(S(), 'kraft'), ...aktivitaetenNachKategorie(S(), 'sonstiges')];
    // Beim Alternative-Wählen: die Basis-Übung selbst und bereits verknüpfte
    // Alternativen aus der Liste nehmen (Selbstverweis/Doppelte vermeiden).
    if (ui.picker.ziel === 'alternative') {
      const basis = findeAktivitaet(S(), ui.picker.aktId);
      const schonVerlinkt = new Set(basis?.alternativen ?? []);
      treffer = treffer.filter(a => a.id !== ui.picker.aktId && !schonVerlinkt.has(a.id));
    }
    const titel = ui.picker.ziel === 'alternative' ? 'Alternative wählen' : 'Übung wählen';
    return `<h3>${titel}</h3>
      <input class="suche" type="text" placeholder="Suchen oder neu benennen…" value="${esc(q)}" data-change="k.suche">
      <div class="picker-liste">${treffer.filter(a => !a.archiviert).map(a =>
        `<button class="picker-zeile" data-action="k.waehle" data-akt="${a.id}"><span class="punkt ${a.kategorie}"></span>${esc(a.name)}</button>`).join('') || '<p class="dim">Keine Treffer.</p>'}
      </div>
      ${q.trim() ? `<div class="knopf-zeile">
        <button class="knopf primaer" data-action="k.neu" data-kat="kraft">„${esc(q.trim())}" als Kraftübung anlegen</button>
        <button class="knopf" data-action="k.neu" data-kat="sonstiges">…als Cardio anlegen</button>
      </div>` : ''}`;
  }

  function einstellungenHtml(aktId, altId) {
    const akt = findeAktivitaet(S(), aktId);
    if (!akt) return '';
    // Ziel ist die Übung selbst oder die Alternative (echte Übung).
    const ziel = altId ? findeAktivitaet(S(), altId) : akt;
    if (!ziel) return '';
    const prog = ziel.einstellungen?.prog ?? { art: 'off' };
    const chip = (art, label) =>
      `<button class="chip ${prog.art === art || (!prog.art && art === 'off') ? 'aktiv' : ''}" data-action="k.progArt" data-akt="${aktId}" ${altId ? `data-alt="${altId}"` : ''} data-art="${art}">${label}</button>`;
    const param = (name, label, wert) =>
      `<label class="feld breit"><input type="text" inputmode="decimal" value="${wert}" data-change="k.progParam" data-akt="${aktId}" ${altId ? `data-alt="${altId}"` : ''} data-param="${name}"><span>${label}</span></label>`;

    let html = `<h3>${esc(ziel.name)}</h3>`;

    // Umbenennen (nur Hauptübung; Alternative behält ihren eigenen Bearbeiten-Weg)
    if (!altId) {
      html += `<p class="sheet-abschnitt">Name</p>
        <div class="param-zeile">
          <label class="feld breit" style="flex:1">
            <input type="text" value="${esc(akt.name)}" data-change="k.aktName" data-akt="${aktId}">
          </label>
        </div>`;

      // Geräte-Notiz: session-übergreifend, immer sichtbar im Heute-Tab.
      // Für Techno-Gym & Co.: Sitzhöhe, Polster-Position, Pin-Einstellung…
      html += `<p class="sheet-abschnitt">Geräte-Notiz</p>
        <textarea class="notiz-feld" rows="2"
          placeholder="z.B. Sitz Stufe 4 · Polster 2. Loch · Pin auf 60"
          data-change="k.geraeteNotiz" data-akt="${aktId}">${esc(akt.notiz ?? '')}</textarea>
        <p class="dim klein-text">Bleibt dauerhaft an dieser Übung und erscheint beim Training.</p>`;

      // Messwerte an/abwählen — bei Kraft steuern die Flags (Einarmig) die Wdh-Form,
      // daher hier für Kraft nur die Cardio-Zusatzwerte anbieten.
      const auswahl = akt.kategorie === 'kraft'
        ? []
        : ['dauer', 'puls_avg', 'puls_max', 'distanz', 'hoehenmeter', 'kalorien'];
      const aktiv = akt.messwerte ?? [];
      if (auswahl.length) {
        html += `<p class="sheet-abschnitt">Messwerte beim Loggen</p>
          <div class="chip-zeile">${auswahl.map(typ => {
            const an = aktiv.includes(typ);
            return `<button class="chip ${an ? 'aktiv' : ''}" data-action="k.mwToggle" data-akt="${aktId}" data-typ="${typ}">${esc(MESSWERTE[typ].label)}</button>`;
          }).join('')}</div>`;
      }

      // Übungstyp (nur Kraft): einarmig / assistiert
      if (akt.kategorie === 'kraft') {
        const ein = !!ziel.einstellungen?.einarmig;
        const ass = !!ziel.einstellungen?.assist;
        html += `<p class="sheet-abschnitt">Übungstyp</p>
          <div class="chip-zeile">
            <button class="chip ${ein ? 'aktiv' : ''}" data-action="k.flagEinarmig" data-akt="${aktId}">Einarmig · L/R</button>
            <button class="chip ${ass ? 'aktiv' : ''}" data-action="k.flagAssist" data-akt="${aktId}">Assistiert · −/+</button>
          </div>
          ${ein ? '<p class="dim klein-text">Wdh werden für links und rechts getrennt erfasst. Gesteigert wird erst, wenn beide Seiten das Ziel schaffen.</p>' : ''}
          ${ass ? '<p class="dim klein-text">Gewicht als Hilfe (−) oder Zusatzgewicht (+). Weniger Hilfe = Fortschritt.</p>' : ''}`;
      }
    }

    if (akt.kategorie === 'kraft') {
      // Stangengewicht: hängt am Gerät, nicht am Nutzer — deshalb pro Übung
      // (bzw. pro Alternative, die Multipresse hat eine andere Stange als die
      // freie Langhantel). Leer = keine Scheiben-Anzeige.
      const stange = ziel.einstellungen?.stange;
      html += `<p class="sheet-abschnitt">Stange</p>
        <div class="param-zeile">
          <label class="feld breit"><input type="text" inputmode="decimal" value="${stange > 0 ? formatZahl(stange) : ''}" placeholder="z.B. 20" data-change="k.stange" data-akt="${aktId}" ${altId ? `data-alt="${altId}"` : ''}><span>kg Stange</span></label>
        </div>
        <p class="dim klein-text">${stange > 0
          ? `Beim Training steht unter den Sätzen, welche Scheiben pro Seite drauf müssen.`
          : `Leer lassen bei Maschinen und Kabelzug. Mit Gewicht zeigt die App beim Training die Scheiben pro Seite.`}</p>`;
      if (stange > 0) {
        html += `<div class="param-zeile">
            <label class="feld breit" style="flex:1"><input type="text" inputmode="decimal" value="${scheibenSatz(S()).map(n => formatZahl(n)).join(' · ')}" data-change="k.scheibenSatz"><span>Scheiben im Studio (für alle Übungen)</span></label>
          </div>`;
      }

      html += `<p class="sheet-abschnitt">Progression</p>
        <div class="chip-zeile">${chip('off', 'Aus')}${chip('double', 'Doppel-Prog.')}${chip('strength', 'Kraft')}${chip('technik', 'Technik/Reha')}</div>`;
      if (prog.art === 'double') {
        const p = { ...PROG_DEFAULTS.double, ...prog };
        html += `<div class="param-zeile">${param('saetze', 'Sätze', p.saetze)}${param('wdhMin', 'Wdh min', p.wdhMin)}${param('wdhMax', 'Wdh max', p.wdhMax)}${param('schritt', '+kg', p.schritt)}</div>`;
      }
      if (prog.art === 'strength') {
        const p = { ...PROG_DEFAULTS.strength, ...prog };
        html += `<div class="param-zeile">${param('saetze', 'Sätze', p.saetze)}${param('wdh', 'Wdh', p.wdh)}${param('schritt', '+kg', p.schritt)}</div>`;
      }
    }

    if (!altId) {
      html += `<p class="sheet-abschnitt">Alternativen</p>`;
      const altListe = (akt.alternativen ?? [])
        .map(id => findeAktivitaet(S(), id)).filter(Boolean);
      html += altListe.map(a => `<div class="plan-zeile">
        <span class="name">${esc(a.name)}</span>
        <span class="werkzeuge">
          <button data-action="k.altName" data-akt="${aktId}" data-alt="${a.id}">✎</button>
          <button data-action="k.einstellungen" data-akt="${aktId}" data-alt="${a.id}">⚙️</button>
          <button data-action="k.altWeg" data-akt="${aktId}" data-alt="${a.id}">✕</button>
        </span>
      </div>`).join('') || '<p class="dim">Noch keine.</p>';
      html += `<div class="knopf-zeile">
        <button class="knopf klein" data-action="k.altWaehlen" data-akt="${aktId}">+ aus Bibliothek</button>
        <button class="knopf klein geist" data-action="k.altPlus" data-akt="${aktId}">+ neu anlegen</button>
      </div>`;

      // Übung löschen / archivieren
      const ref = referenzenVonAktivitaet(S(), aktId);
      html += `<p class="sheet-abschnitt">Übung entfernen</p>`;
      if (ref.sessions > 0) {
        html += `<p class="dim klein-text">Steckt in ${ref.sessions} Session(s). Löschen würde den Verlauf zerstören — stattdessen archivieren: verschwindet aus Auswahllisten, Verlauf bleibt.</p>
          <button class="knopf" data-action="k.aktArchiv" data-akt="${aktId}">Archivieren</button>`;
      } else if (ref.einheiten > 0) {
        // Noch nie trainiert, steckt aber im Plan: Löschen würde dort einen
        // Verweis ins Leere hinterlassen. Vorher aus der Einheit nehmen.
        html += `<p class="dim klein-text">Steckt in ${ref.einheiten} Plan-Einheit(en), aber in keiner Session. Nimm sie erst dort heraus — sonst zeigt der Plan auf eine Übung, die es nicht mehr gibt.</p>
          <button class="knopf" data-action="k.aktArchiv" data-akt="${aktId}">Archivieren</button>`;
      } else {
        html += `<p class="dim klein-text">Weder in einer Session noch in einem Plan — kann gefahrlos gelöscht werden.</p>
          <button class="knopf gefahr" data-action="k.aktWeg" data-akt="${aktId}">Übung löschen</button>`;
      }
    }
    return html;
  }

  return { planHtml, heuteWaehlenHtml, einheitNeuHtml, umbenennenHtml, zyklusPickerHtml, pickerHtml, einstellungenHtml };
}
