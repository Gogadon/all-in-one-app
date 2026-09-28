// tests/koerper.test.js — Körperwerte: eigene Liste, kein Training.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuteIso } from '../js/core/model.js';

const {
  KOERPER_WERTE, istKoerperWert, standardWerte, formatKoerperWert,
  messungen, messungAmTag, verlauf, letzterWert, veraenderung,
  neueMessung, setzeMessung, entferneMessung, istLeer,
} = await import('../js/core/koerper.js');
const { leererZustand, migriere } = await import('../js/core/storage.js');
const { wochenUebersicht } = await import('../js/dashboard.js');

function leer() { return leererZustand(); }

/** Zustand mit ein paar Messungen (bewusst unsortiert eingefügt). */
function mitVerlauf() {
  const s = leer();
  setzeMessung(s, '2026-07-20', { gewicht: 96.3, kfa: 23.9 });
  setzeMessung(s, '2026-07-06', { gewicht: 97.0 });
  setzeMessung(s, '2026-07-27', { gewicht: 95.1, kfa: 23.5 });
  return s;
}

// ============================================================
// Grundform & Register
// ============================================================

test('Körper: frischer Zustand hat die Liste, alte Stände bekommen sie nachgetragen', () => {
  assert.deepEqual(leer().koerper, []);
  const alt = { schema: 2, bibliothek: [], sessions: [] };
  assert.deepEqual(migriere(alt).koerper, []);
});

test('Körper: Register kennt Gewicht und KFA als Standard, weitere optional', () => {
  assert.ok(istKoerperWert('gewicht'));
  assert.ok(istKoerperWert('muskelmasse'));
  assert.ok(!istKoerperWert('bizeps'));
  assert.deepEqual(standardWerte(), ['gewicht', 'kfa']);
  // Die Werte einer Gym-Waage sind vorbereitet
  for (const t of ['muskelmasse', 'wasser', 'knochenmasse', 'viszeralfett', 'bmi']) {
    assert.ok(KOERPER_WERTE[t], t + ' fehlt im Register');
  }
});

test('Körper: jeder Wert hat einen Beispiel-Platzhalter, nicht die Schrittweite', () => {
  for (const [typ, def] of Object.entries(KOERPER_WERTE)) {
    assert.ok(def.platzhalter, `${typ} hat keinen Platzhalter`);
    // Der Platzhalter soll ein plausibler Beispielwert sein — die Schrittweite
    // („0,1") als grauer Text ist nutzlos und sieht aus wie ein echter Wert.
    const alsZahl = Number(String(def.platzhalter).replace(',', '.'));
    assert.notEqual(alsZahl, def.schritt, `${typ}: Platzhalter ist die Schrittweite`);
    assert.ok(alsZahl > 1, `${typ}: Platzhalter ${def.platzhalter} wirkt nicht wie ein echter Wert`);
  }
});

test('Körper: Formatierung mit deutscher Schreibweise und Einheit', () => {
  assert.equal(formatKoerperWert('gewicht', 95.1), '95,1 kg');
  assert.equal(formatKoerperWert('kfa', 23.5), '23,5 %');
  assert.equal(formatKoerperWert('bmi', 27.4), '27,4');     // ohne Einheit
  assert.equal(formatKoerperWert('gewicht', null), '–');
  assert.throws(() => formatKoerperWert('bizeps', 1), /Unbekannter Körperwert/);
});

// ============================================================
// Schreiben: eine Messung pro Tag
// ============================================================

test('Körper: Messung anlegen und am Tag wiederfinden', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  assert.equal(s.koerper.length, 1);
  assert.equal(messungAmTag(s, '2026-07-27').werte.gewicht, 95.1);
  assert.equal(messungAmTag(s, '2026-07-26'), null);
});

test('Körper: zweiter Eintrag am selben Tag ergänzt, statt zu doppeln', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  setzeMessung(s, '2026-07-27', { kfa: 23.5 });          // Waage im Gym nachgetragen
  assert.equal(s.koerper.length, 1);
  const m = messungAmTag(s, '2026-07-27');
  assert.equal(m.werte.gewicht, 95.1);                    // bleibt erhalten
  assert.equal(m.werte.kfa, 23.5);
});

test('Körper: vorhandenen Wert überschreiben und einzeln löschen', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1, kfa: 23.5 });
  setzeMessung(s, '2026-07-27', { gewicht: 94.8 });       // korrigiert
  assert.equal(messungAmTag(s, '2026-07-27').werte.gewicht, 94.8);
  setzeMessung(s, '2026-07-27', { kfa: null });            // Tippfehler wieder raus
  assert.equal(messungAmTag(s, '2026-07-27').werte.kfa, undefined);
  assert.equal(messungAmTag(s, '2026-07-27').werte.gewicht, 94.8);
});

test('Körper: unbekannte Werte werden abgelehnt', () => {
  const s = leer();
  assert.throws(() => setzeMessung(s, '2026-07-27', { bizeps: 42 }), /Unbekannte Körperwerte/);
  assert.throws(() => neueMessung({ werte: { bizeps: 42 } }), /Unbekannte Körperwerte/);
});

test('Körper: Messung löschen', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  assert.equal(entferneMessung(s, '2026-07-27'), true);
  assert.deepEqual(s.koerper, []);
  assert.equal(entferneMessung(s, '2026-07-27'), false);
});

test('Körper: leere Messung ist als solche erkennbar', () => {
  assert.ok(istLeer(neueMessung({ datum: '2026-07-27' })));
  assert.ok(!istLeer(neueMessung({ datum: '2026-07-27', werte: { gewicht: 95 } })));
});

// ============================================================
// Lesen: Verlauf, letzter Wert, Veränderung
// ============================================================

test('Körper: Liste kommt neueste zuerst, Verlauf älteste zuerst', () => {
  const s = mitVerlauf();
  assert.deepEqual(messungen(s).map(m => m.datum), ['2026-07-27', '2026-07-20', '2026-07-06']);
  assert.deepEqual(verlauf(s, 'gewicht').map(p => p.datum), ['2026-07-06', '2026-07-20', '2026-07-27']);
});

test('Körper: Verlauf enthält nur Messungen mit diesem Wert', () => {
  const s = mitVerlauf();   // KFA fehlt am 06.07.
  assert.deepEqual(verlauf(s, 'kfa').map(p => p.datum), ['2026-07-20', '2026-07-27']);
  assert.deepEqual(verlauf(s, 'muskelmasse'), []);
});

test('Körper: letzter Wert ist der jüngste, nicht der zuletzt eingetragene', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  setzeMessung(s, '2026-07-06', { gewicht: 97.0 });   // älterer Tag NACH dem neueren erfasst
  assert.deepEqual(letzterWert(s, 'gewicht'), { datum: '2026-07-27', wert: 95.1 });
  assert.equal(letzterWert(s, 'kfa'), null);
});

test('Körper: Veränderung vergleicht mit der vorherigen Messung', () => {
  const s = mitVerlauf();
  const v = veraenderung(s, 'gewicht');
  assert.equal(v.jetzt, 95.1);
  assert.equal(v.vorher, 96.3);
  assert.ok(Math.abs(v.diff - (-1.2)) < 1e-9);
  assert.equal(v.seit, '2026-07-20');
});

test('Körper: ohne Vergleichswert gibt es keine Veränderung', () => {
  const s = leer();
  setzeMessung(s, '2026-07-27', { gewicht: 95.1 });
  assert.equal(veraenderung(s, 'gewicht'), null);
});

// ============================================================
// Darf die Trainings-Zahlen NICHT anfassen
// ============================================================

test('Körper: Messungen erzeugen keine Sessions und keine Aktivitäten', () => {
  const s = leer();
  setzeMessung(s, '2026-07-06', { gewicht: 97.0 });
  setzeMessung(s, '2026-07-08', { gewicht: 96.5 });
  assert.equal(s.sessions.length, 0);
  const u = wochenUebersicht(s, '2026-07-08');
  assert.equal(u.aktivitaeten, 0);
  assert.equal(u.aktiveTage, 0);
});

test('Körper: ein abgewähltes Feld wird wirklich gelöscht', async () => {
  const { installiereBrowserAttrappe, testKontext } = await import('./helpers/umgebung.js');
  installiereBrowserAttrappe();
  const { esc, formatDatum } = await import('../js/ui/components.js');
  const { erstelleKoerperModul } = await import('../js/modules/koerper.js');
  const { setzeMessung, messungAmTag } = await import('../js/core/koerper.js');
  const HEUTE = heuteIso();   // wie die App: Ortszeit, nicht UTC

  const state = leererZustand();
  setzeMessung(state, HEUTE, { gewicht: 95.5, muskelmasse: 40 });
  const { ctx } = testKontext(state, { esc, formatDatum });
  const k = erstelleKoerperModul(ctx);

  // Feld abwählen und speichern — der alte Wert blieb vorher einfach stehen,
  // weil ein weggelassenes Feld für setzeMessung kein Löschauftrag ist.
  k.actions['koerper.feldWeg']({ typ: 'muskelmasse' });
  await k.actions['koerper.speichern']();
  assert.deepEqual(messungAmTag(state, HEUTE).werte, { gewicht: 95.5 });

  // Der verbliebene Wert bleibt unangetastet, und Wiedereintragen geht.
  k.actions['koerper.feldPlus']?.({ typ: 'muskelmasse' });
  k.actions['koerper.wert']({ typ: 'muskelmasse' }, { value: '41' });
  await k.actions['koerper.speichern']();
  assert.deepEqual(messungAmTag(state, HEUTE).werte, { gewicht: 95.5, muskelmasse: 41 });
});

// ============================================================
// Zeitraum der Kennzahl-Karten (7 Tage / 30 Tage / 1 Jahr / Gesamt / Eigene)
// ============================================================

/** ISO-Tag `n` Tage vor `heute` — gleiche UTC-Rechnung wie der Kern. */
function tageVor(n, heute = heuteIso()) {
  const [j, m, t] = heute.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t - n)).toISOString().slice(0, 10);
}

test('Zeitraum: Grenze zählt mit — die Messung von vor genau 7 Tagen gehört dazu', async () => {
  const { zeitraumAb, koerperZeitraum, setzeKoerperZeitraum } = await import('../js/core/koerper.js');
  const s = leer();
  const HEUTE = '2026-09-26';
  setzeKoerperZeitraum(s, '7');
  assert.equal(zeitraumAb(koerperZeitraum(s), HEUTE), '2026-09-19');

  // Wer sich wöchentlich wiegt, hat so zwei Punkte statt einem.
  setzeMessung(s, '2026-09-18', { gewicht: 96.0 });   // 8 Tage: draußen
  setzeMessung(s, '2026-09-19', { gewicht: 95.4 });   // 7 Tage: drin
  setzeMessung(s, '2026-09-26', { gewicht: 94.9 });   // heute: drin
  const ab = zeitraumAb(koerperZeitraum(s), HEUTE);
  assert.deepEqual(verlauf(s, 'gewicht', { ab }).map(p => p.datum), ['2026-09-19', '2026-09-26']);
  assert.equal(verlauf(s, 'gewicht').length, 3, 'ohne ab: alles wie bisher');
});

test('Zeitraum: 30 Tage und 1 Jahr sind rollend, keine Kalendermonate', async () => {
  const { zeitraumAb, koerperZeitraum, setzeKoerperZeitraum } = await import('../js/core/koerper.js');
  const s = leer();
  setzeKoerperZeitraum(s, '30');
  // Am 2. Oktober sind es trotzdem 30 Tage zurück — nicht „seit dem 1.".
  assert.equal(zeitraumAb(koerperZeitraum(s), '2026-10-02'), '2026-09-02');
  setzeKoerperZeitraum(s, '365');
  assert.equal(zeitraumAb(koerperZeitraum(s), '2026-09-26'), '2025-09-26');
  // Über den Jahreswechsel und den Schalttag hinweg.
  setzeKoerperZeitraum(s, '30');
  assert.equal(zeitraumAb(koerperZeitraum(s), '2028-03-15'), '2028-02-14');
  assert.equal(zeitraumAb(koerperZeitraum(s), '2027-01-10'), '2026-12-11');
  // Gesamt schneidet nichts ab.
  setzeKoerperZeitraum(s, 'gesamt');
  assert.equal(zeitraumAb(koerperZeitraum(s), '2026-09-26'), null);
});

test('Zeitraum: Gesamt ist voreingestellt, Unsinn im Speicher fällt darauf zurück', async () => {
  const { koerperZeitraum } = await import('../js/core/koerper.js');
  const s = leer();
  assert.equal(koerperZeitraum(s).art, 'gesamt', 'ohne Zutun: alles wie vorher');
  assert.equal(koerperZeitraum(s).tage, null);
  for (const kaputt of ['30', { art: 'quatsch' }, { art: 7 }, null, 42]) {
    s.einstellungen.koerperZeitraum = kaputt;
    assert.equal(koerperZeitraum(s).art, 'gesamt', JSON.stringify(kaputt));
  }
  assert.equal(koerperZeitraum({}).art, 'gesamt', 'auch ohne einstellungen');
});

test('Zeitraum: „Eigene" merkt sich die Zahl und lässt Unsinn nicht durch', async () => {
  const { koerperZeitraum, setzeKoerperZeitraum, EIGENE_TAGE_STANDARD } = await import('../js/core/koerper.js');
  const s = leer();
  setzeKoerperZeitraum(s, 'eigene');
  assert.equal(koerperZeitraum(s).tage, EIGENE_TAGE_STANDARD, 'Voreinstellung');

  setzeKoerperZeitraum(s, 'eigene', 45);
  assert.deepEqual([koerperZeitraum(s).tage, koerperZeitraum(s).label], [45, '45 Tage']);
  // Kurz auf 30 Tage und zurück: die 45 sind noch da.
  setzeKoerperZeitraum(s, '30');
  assert.equal(koerperZeitraum(s).tage, 30);
  setzeKoerperZeitraum(s, 'eigene');
  assert.equal(koerperZeitraum(s).tage, 45);

  // Leer, 0, negativ, absurd, keine Zahl → die 45 bleiben stehen.
  for (const unsinn of [null, 0, -5, 99999, NaN, '45']) {
    setzeKoerperZeitraum(s, 'eigene', unsinn);
    assert.equal(koerperZeitraum(s).tage, 45, String(unsinn));
  }
  setzeKoerperZeitraum(s, 'eigene', 12.6);
  assert.equal(koerperZeitraum(s).tage, 13, 'ganze Tage');
  // Eine unbekannte Art ändert gar nichts.
  setzeKoerperZeitraum(s, 'quatsch');
  assert.equal(koerperZeitraum(s).art, 'eigene');
});

test('Zeitraum: Veränderung ist erster gegen letzten Wert DARIN', async () => {
  const { veraenderungAb } = await import('../js/core/koerper.js');
  const s = leer();
  setzeMessung(s, '2026-08-01', { gewicht: 99.0 });   // vor dem Zeitraum
  setzeMessung(s, '2026-09-01', { gewicht: 96.1, kfa: 24.0 });
  setzeMessung(s, '2026-09-15', { gewicht: 95.5 });
  setzeMessung(s, '2026-09-25', { gewicht: 94.9 });

  const v = veraenderungAb(s, 'gewicht', '2026-08-27');
  assert.equal(v.anzahl, 3);
  assert.equal(Math.round(v.diff * 10) / 10, -1.2, '94,9 − 96,1, nicht 94,9 − 95,5');
  assert.equal(v.seit, '2026-09-01');

  assert.deepEqual(veraenderungAb(s, 'kfa', '2026-08-27'), { anzahl: 1, diff: null, seit: '2026-09-01' });
  assert.deepEqual(veraenderungAb(s, 'gewicht', '2026-09-26'), { anzahl: 0, diff: null, seit: null });
});

test('Körper-Tab: der Umschalter schaltet beide Karten, nicht die Liste', async () => {
  const { installiereBrowserAttrappe, testKontext } = await import('./helpers/umgebung.js');
  installiereBrowserAttrappe();
  const { esc, formatDatum } = await import('../js/ui/components.js');
  const { erstelleKoerperModul } = await import('../js/modules/koerper.js');

  const state = leererZustand();
  setzeMessung(state, tageVor(200), { gewicht: 99.0, kfa: 26.0 });
  setzeMessung(state, tageVor(20), { gewicht: 96.1, kfa: 24.0 });
  setzeMessung(state, tageVor(3), { gewicht: 94.9, kfa: 23.1 });
  const { ctx, protokoll } = testKontext(state, { esc, formatDatum });
  const k = erstelleKoerperModul(ctx);
  const karten = (html) => html.split('kw-karte').slice(1).map(t => t.split('kw-spark')[0]);

  // Gesamt (Voreinstellung): Trend wie früher — gegen die Messung davor.
  let html = k.heuteHtml();
  assert.match(html, /data-art="gesamt"[^>]*aria-pressed="true"/);
  assert.match(karten(html)[0], /-1,2 kg/, 'Gewicht: 94,9 − 96,1');
  assert.match(karten(html)[0], /seit /);
  assert.equal((html.match(/kw-zeile-karte/g) ?? []).length, 3, 'Liste: alle drei');

  // 30 Tage: beide Karten gleichzeitig, Liste unberührt.
  await k.actions['koerper.zeitraum']({ art: '30' });
  assert.equal(protokoll.saves, 1, 'Auswahl wird gespeichert');
  html = k.heuteHtml();
  assert.match(karten(html)[0], /-1,2 kg/);
  assert.match(karten(html)[0], /in 30 Tagen/);
  assert.match(karten(html)[1], /-0,9 %/, 'Körperfett schaltet mit');
  assert.match(karten(html)[1], /in 30 Tagen/);
  assert.equal((html.match(/kw-zeile-karte/g) ?? []).length, 3, 'Liste bleibt vollständig');

  // 1 Jahr: die Messung von vor 200 Tagen ist jetzt der Anfang.
  await k.actions['koerper.zeitraum']({ art: '365' });
  html = k.heuteHtml();
  assert.match(karten(html)[0], /-4,1 kg/, '94,9 − 99,0');
  assert.match(karten(html)[0], /in 1 Jahr/);

  // 7 Tage: nur eine Messung — ehrlich sagen statt einen Trend zu erfinden.
  // Die große Zahl bleibt der aktuelle Wert.
  await k.actions['koerper.zeitraum']({ art: '7' });
  html = k.heuteHtml();
  assert.match(karten(html)[0], /Nur eine Messung in den letzten 7 Tagen/);
  assert.match(karten(html)[0], /94,9 kg/);

  // Eigene: das Feld erscheint, und 2 Tage zeigen „keine Messung".
  await k.actions['koerper.zeitraum']({ art: 'eigene' });
  assert.match(k.heuteHtml(), /data-change="koerper\.eigeneTage"/);
  await k.actions['koerper.eigeneTage']({}, { value: '2' });
  html = k.heuteHtml();
  assert.match(karten(html)[0], /Keine Messung in den letzten 2 Tagen/);
  assert.match(karten(html)[0], /94,9 kg/, 'große Zahl trotzdem da');
  assert.match(html, /value="2"/);
  // Unsinn eingetippt → die 2 bleiben.
  await k.actions['koerper.eigeneTage']({}, { value: 'abc' });
  assert.match(k.heuteHtml(), /value="2"/);
});

test('Körper-Tab: ohne Messungen kein Umschalter', async () => {
  const { installiereBrowserAttrappe, testKontext } = await import('./helpers/umgebung.js');
  installiereBrowserAttrappe();
  const { esc, formatDatum } = await import('../js/ui/components.js');
  const { erstelleKoerperModul } = await import('../js/modules/koerper.js');
  const { ctx } = testKontext(leererZustand(), { esc, formatDatum });
  const html = erstelleKoerperModul(ctx).heuteHtml();
  assert.doesNotMatch(html, /kw-zeitraum/, 'Zeitraum über nichts ergibt keinen Sinn');
  assert.match(html, /Noch keine Werte/);
});
