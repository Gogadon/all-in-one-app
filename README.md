# All-in-One

Fitness-Tracking-App für Kraft, Rad, Wandern, Schwimmen, Körperwerte und
selbstgesetzte Ziele.
Vanilla JavaScript, keine Frameworks, kein Build-Schritt. Läuft als PWA.

Live: https://gogadon.github.io/all-in-one-app/

---

## Schnellstart

**Entwickeln:** Dateien bearbeiten, zu GitHub hochladen. Kein Build, kein Bundler.
GitHub Pages deployt automatisch (kann ein paar Minuten dauern).

**Testen:**
```
npm test
```
Führt alle Node-Tests aus. Sie laufen ohne Browser — die gesamte Logik ist
so gebaut, dass sie ohne DOM prüfbar ist.

**Lokal ansehen:** Einen beliebigen statischen Server im Projektordner starten,
z.B. `python3 -m http.server`. Direkt `index.html` öffnen geht *nicht*
(ES-Module brauchen HTTP).

---

## Grundidee der Architektur

**„Dicker Kern, dünne Module."**

Der Kern (`js/core/`) kennt kein einziges Sportmodul. Er stellt ein Datenmodell
bereit, das für *jede* Aktivität funktioniert. Die Module (`js/modules/`) sind
dünne Schichten darüber, die nur ihre Besonderheiten beisteuern.

### Das Datenmodell

```
Session  →  Segment  →  Eintrag  →  Messwerte
```

- **Session** = ein Trainingstag (oder eine Radtour)
- **Segment** = eine Übung/Aktivität innerhalb der Session
- **Eintrag** = ein Satz (Kraft) oder der eine Datensatz der Tour (Rad)
- **Messwerte** = die Zahlen: Gewicht, Wiederholungen, Distanz, Puls …

Eine Kraftübung mit 4 Sätzen = ein Segment mit 4 Einträgen.
Eine Radtour = ein Segment mit einem Eintrag.
Derselbe Code-Pfad für beides.

### Abhängigkeitsrichtung

Wichtige Regel: **Abhängigkeiten zeigen immer nach unten.**

```
app.js            ← kennt alle Module, wird von niemandem importiert
   ↓
modules/          ← kennen den Kern, nie app.js
   ↓
core/ + ui/       ← kennen keine Module
```

Ein Modul, das `app.js` importiert, erzeugt einen Zirkelbezug und macht die
Tests unmöglich (sie laden Module einzeln, ohne DOM).

---

## Was liegt wo

| Datei | Zweck |
|---|---|
| `js/app.js` | App-Shell: Tabs, Dashboard, Daten-Import/Export, Event-Verdrahtung |
| `js/core/model.js` | Datenmodell + **alle Datums-Helfer** |
| `js/core/metrics.js` | Messwert-Registry (welche Zahlen es gibt, wie sie formatiert werden) |
| `js/core/statistik.js` | Zeitraum-Aggregation (Woche/Monat/Jahr) für die Statistik-Ansicht |
| `js/core/plan.js` | Trainingszyklus, Einheiten, Positionsberechnung |
| `js/core/library.js` | Übungs-Bibliothek |
| `js/core/storage.js` | Speichern, Laden, Backup, Migration |
| `js/core/koerper.js` | Körperwerte-Register + Verlauf (Gewicht, KFA …) |
| `js/route.js` | Adresse ⇄ Ansicht (Hash-Routing, reine Logik) |
| `js/modules/kraft.js` | Kraftmodul (das größte — Progression, PRs, Sätze) |
| `js/modules/rad.js` | Radmodul (freie Touren, kein Plan) |
| `js/modules/wandern.js` | Wandermodul (freie Touren; Schritte, Höhenmeter, Std:Min) |
| `js/modules/schwimmen.js` | Schwimmmodul (freie Einheiten; Bahnen als Primär-Einheit) |
| `js/modules/koerper.js` | Körper-Tab (Werte eintragen, Verlauf) |
| `js/modules/challenge.js` | Ziele — liest die anderen Module aus, erzeugt kaum eigene Daten |
| `js/ui/` | Wiederverwendbare Bausteine: Dialoge, Bottom-Sheet, Charts, Teilen-Karte |
| `sw.js` | Service Worker — nur für Installierbarkeit, **cacht bewusst nichts** |

---

## Fallstricke (bitte lesen, bevor du etwas änderst)

### 1. `STORAGE_KEY` niemals ändern

In `js/core/storage.js`:
```js
export const STORAGE_KEY = 'gogadon_allinone_v1';
```
Unter diesem Schlüssel liegen die Trainingsdaten im localStorage des Geräts.
Eine Umbenennung macht alle gespeicherten Trainings unauffindbar. Der Name ist
historisch — die App heißt inzwischen anders, der Schlüssel bleibt.

### 2. Datumsrechnung: immer über die Helfer in `model.js`

Nie `new Date()` + `toISOString()` kombinieren. Das rechnet die lokale Zeit
nach UTC zurück und kippt an Tagesgrenzen um einen Tag. (Genau dieser Bug steckte
mal in der Wochenstatistik: Montags um 00:30 zeigte sie die falsche Woche.)

Stattdessen: `heuteIso()` liefert den lokalen Kalendertag als String, alle
weiteren Helfer (`wochenStart`, `monatsStart`, `tageZwischen` …) rechnen darauf
rein in UTC weiter.

### 3. Die Zyklus-Position wird berechnet, nicht gespeichert

Der Kraft-Zyklus hat einen **Anker** (`plan.anker = { iso, index }`). Beim
Öffnen läuft die App vom Anker bis heute durch und berechnet, wo du stehst:

- **Ruhetag** (Einheit mit `typ: 'rest'` oder nur Cardio) → rückt automatisch weiter
- **Krafttag erledigt** → rückt weiter (aber erst am *nächsten* Kalendertag)
- **Krafttag offen** → bleibt stehen, wartet auf dich
- **Übersprungen** → rückt sofort weiter, beliebig oft pro Tag

Deshalb zeigen Heute-Tab und Plan-Tab am selben Tag immer denselben Zyklustag.
Und ein importiertes Backup kann nie „veralten".

Wer `plan.position` direkt setzt, wird beim nächsten Rendern überschrieben.
Für „Heute korrigieren" gibt es `setzeAnker()`.

**Ruhetage** lassen sich im Plan ausdrücklich markieren (`einheit.typ = 'rest'`,
Schalter im Einheiten-Editor). Ohne Markierung wird geraten: eine Einheit, in
der ausschließlich Cardio steckt, gilt als „Active Rest". Die ausdrückliche
Marke gewinnt immer — deshalb prüft `istRuhetag()` sie zuerst.

### 3b. Ausfall-Tage (krank) sind kein Training

`state.ausfallTage` ist eine eigene Top-Level-Liste (`{ id, datum, typ, notiz,
erstelltAm }`), nach demselben Muster wie `state.termine`: nie aus Sessions
abgeleitet, erzeugt nie eine Session und fließt **nie** in Statistik oder
Wochenzahlen ein. `typ` ist von Anfang an dabei, damit `'urlaub'` oder
`'verletzung'` später ohne Schema-Änderung dazukommen können.

Ein Ausfall-Tag verdrängt nichts: Wer trotz Erkältung radeln war, sieht im
Kalender beides. Am Kraft-Zyklus ändert er bewusst nichts — ein offener
Krafttag wartet ohnehin, bis er erledigt oder übersprungen ist.

### 3c. Die Adresse spiegelt die Ansicht (Hash-Routing)

`#/dashboard` · `#/kraft/heute` · `#/rad/verlauf` · `#/daten` · `#/kalender`.
Ein Reload landet dadurch wieder dort, wo man war, und eine Ansicht lässt sich
als Lesezeichen ablegen.

**Hash statt echter Pfade, mit Absicht:** Die App liegt als statische Dateien
auf GitHub Pages. `/kraft/heute` würde beim Neuladen einen 404 erzeugen, weil
dort keine Datei liegt — ein Hash kommt nie beim Server an.

Gesetzt wird per `replaceState`: Der Zurück-Knopf verlässt die App wie bisher,
statt sich erst durch jeden Tab-Wechsel zurückzuarbeiten. Wer Tab-Wechsel in
der History haben will, tauscht das in `app.js` gegen `pushState`.

Unbekannte Routen fallen sauber zurück (fremdes Modul → Dashboard, unpassender
Tab → „heute"), damit ein altes Lesezeichen nie in einer leeren Ansicht endet.

### 3d. Körperwerte sind kein Training

`state.koerper` ist eine eigene Top-Level-Liste (`{ id, datum, werte, notiz,
erstelltAm }`) — wie `termine` und `ausfallTage`: erzeugt nie eine Session und
fließt **nie** in Statistik oder Wochenzahlen ein. Eine Messung ist ein
*Zustand* des Körpers, keine Aktivität.

Bewusst **nicht** in `metrics.js`: Dort meint `gewicht` das GEHOBENE Gewicht.
Ein zweites `gewicht` mit anderer Bedeutung im selben Register wäre genau die
Doppeldeutigkeit, die dieses Projekt vermeidet. Körperwerte haben deshalb ihr
eigenes kleines Register in `core/koerper.js` — neue Waage mit neuem Wert =
ein Eintrag dort, sonst nichts.

**Eine Messung pro Tag:** Ein zweiter Eintrag am selben Tag ergänzt den
vorhandenen (upsert), statt eine zweite Zeile zu erzeugen — so bleibt der
Verlauf eine Kurve statt einer Punktewolke.

### 4. Service Worker cacht nichts — mit Absicht

Er existiert, damit Chrome die App als installierbar erkennt, und er sorgt
dafür, dass Deploys sofort ankommen.

Wichtig zu verstehen: „kein Cache" hieß früher nur, dass der Service Worker
selbst keinen anlegt. Der **normale HTTP-Cache des Browsers** greift trotzdem —
GitHub Pages liefert statische Dateien mit Gültigkeitsdauer aus. In einer
installierten PWA gibt es kein „Hard Reload", deshalb konnte ein Deploy
minutenlang unsichtbar bleiben, obwohl im Code „Updates sind sofort da" stand.

Deshalb holt der `fetch`-Handler eigene Dateien mit `cache: 'reload'` (geht am
HTTP-Cache vorbei und frischt ihn auf); ohne Netz fällt er auf `force-cache`
zurück, damit die Seite nicht einfach kaputt ist. Registriert wird mit
`updateViaCache: 'none'`, sonst käme ausgerechnet `sw.js` selbst aus dem Cache.

Falls je echtes Offline-Caching dazukommt: **unbedingt** einen sichtbaren
„Update verfügbar"-Flow mitbauen. Sonst hält der alte Service Worker die alten
Dateien fest, und neue Versionen erscheinen erst nach Tagen.

### 5. Eingabefelder nicht bei jedem Tastendruck neu rendern

Wird ein Feld während der Eingabe neu erzeugt, verliert es den Fokus und der
„Weiter"-Knopf der Handy-Tastatur springt ins Leere. Deshalb speichert
`k.wert` nur und rendert *nicht* neu.

### 5b. Löschen prüft ALLE Referenzen, nicht nur Sessions

`referenzenVonAktivitaet(state, id)` beantwortet an einer Stelle, wo eine Übung
überall hängt: Sessions, Plan-Einheiten und Alternativ-Verweise.

Vorher fragte das Löschen nur die Sessions ab und meldete „noch nirgends
benutzt". Eine Übung, die in einer Plan-Einheit steckte, aber nie trainiert
wurde, ließ sich damit hart löschen — die Einheit zeigte danach auf eine ID,
die es nicht mehr gibt.

Sessions und Plan-Einheiten **blockieren** das Löschen (bei Plan-Einheiten
bewusst blockieren statt still herauslöschen, sonst ändert sich der Plan,
ohne dass es jemand merkt). Alternativ-Verweise blockieren **nicht** — die
räumt `entferneAktivitaet` selbst auf.

### 6. Alternativen sind echte Bibliotheks-Übungen (ID-Verweise)

Eine Übung trägt `alternativen: [uebungsId, …]` — reine Verweise auf andere
echte Übungen in der Bibliothek. Eine Alternative ist also KEIN eingebettetes
Objekt mehr (das war Schema 1), sondern eine vollwertige Übung mit eigener
Historie, Progression und Einstellungen.

- Umschalten im Heute-Tab setzt `segment.altOf = <uebungsId>`.
- `identVon(segment)` gibt `altOf ?? aktivitaetId` zurück — dadurch nutzt die
  Alternative automatisch ihre eigene Historie.
- Verweise sind **einseitig**: A→B heißt nicht automatisch B→A.
- `entferneAlternative` löscht nur den Verweis; die echte Übung bleibt.
- `wirdVerwendet` zählt eine Übung als benutzt, wenn sie als Haupt-Aktivität
  **oder** als Alternative (`altOf`) in einer Session steckt. Beides schützt
  vor dem Löschen — sonst würde eine alte Session ins Leere zeigen.
- `entferneAktivitaet` räumt beim Löschen einer Übung deren ID aus allen
  Alternativ-Listen, damit keine toten Verweise zurückbleiben.
- Die Migration von Schema 1→2 (in `storage.js`) wandelt alte eingebettete
  Alternativen in echte Übungen um und führt gleichnamige zusammen.

---

## Tests

221 Tests, alle ohne Browser lauffähig. Sie decken die Rechenlogik ab:
Progression, PR-Erkennung, Zyklus-Berechnung, Zeiträume, Datumsgrenzen,
Statistik-Aggregation und Challenge-Fortschritt.

```
npm test
```

Neue Logik gehört in eine reine Funktion, die man ohne DOM testen kann. Wenn
etwas nur im Browser prüfbar ist, ist es meist zu eng mit der Darstellung
verwoben.

---

## Backup & Migration

**Export:** Zahnrad im Dashboard → Daten → Backup exportieren.
Erzeugt `all-in-one-backup-JJJJ-MM-TT.json`.

**Import:** Gleiche Stelle. Der Import prüft den `app`-Namen im JSON *nicht*,
deshalb laden auch ältere Backups (mit dem früheren Namen) weiterhin.

Der Ablauf ist bewusst in dieser Reihenfolge: **prüfen → fragen → Rettungspunkt
→ ersetzen**. Gefragt wird erst nach dem Prüfen, damit niemand einen Import
bestätigt, der ohnehin an einer kaputten Datei scheitert; der erzwungene
Rettungspunkt („vor Import") hält den Stand von *unmittelbar davor* fest — der
Tages-Snapshot ist ja der von heute früh.

Bei kaputten gespeicherten Daten legt die App eine Rettungskopie unter
`gogadon_allinone_v1_defekt` an und startet leer. Die Konsole sagt dann Bescheid.

**Automatische Wiederherstellungspunkte:** Beim Öffnen legt die App höchstens
einen Snapshot pro Kalendertag an (die letzten 3 bleiben), alle zusammen unter
`gogadon_allinone_v1_snapshots`. Weil der Snapshot beim *Start* entsteht, ist es
der Stand **vor** den Änderungen des Tages — genau das, was man bei einem
Versehen zurückhaben will. Zurückholen unter Daten → Wiederherstellungspunkte.

Wichtig: Snapshots liegen im selben localStorage wie die Daten. Sie retten vor
versehentlichem Löschen **in** der App, aber nicht vor Handy-Wechsel, App-Neu-
installation oder gelöschten Browserdaten. Dagegen hilft nur der Datei-Export —
deshalb erinnert das Dashboard nach 30 Tagen ohne Export daran
(`state.einstellungen.letzterExport` hält das Datum fest).

Der Hinweis steht **oben** auf dem Dashboard, nicht unten: einen Hinweis, den
man erst erscrollen muss, sieht niemand. Bewusst **kein** Modal — er käme bei
jedem Start wieder, bis exportiert ist, und würde sich zum Wegklick-Reflex
abnutzen. Als Ventil gibt es „Später" (`erinnerungPause`, 7 Tage Ruhe); ein
echter Export löscht die Pause wieder.

---

## Design

Dunkler Hintergrund, eine Akzentfarbe pro Modul:

| | |
|---|---|
| Kraft | `#CDFD34` (Lime) |
| Rad | `#37D7F4` (Cyan) |
| Challenge | `#FF6B9D` (Rosé) |
| Wandern | `#FCB44B` (Amber) |
| Schwimmen | `#A78BFA` (Violett) |

Schriften: Bricolage Grotesque (Überschriften, Zahlen), Sora (Fließtext, UI).

Das App-Icon ist ein Hexagon mit einem Punkt in der Mitte: die sechs Kanten
deuten die Module an, der Punkt ist der Nutzer.

---

## Offene Ideen

- Module: Joggen/Laufen
- Dashboard als kompaktes Kachel-Raster, wenn mehr Module dazukommen
- Teilen vom Dashboard (Wochen-/Monatsstatistik)
- App-weiter Kalender: Personal Training, geplante Touren
- Challenge-Ausbau: Serien, Abzeichen („ohne Motor")
- GPX-Import fürs Rad (Strecke, Höhenmeter, Puls aus der Datei lesen)
