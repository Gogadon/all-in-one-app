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
app.js              ← die Hülle; wird von niemandem importiert
   ↓
module-registry.js  ← kennt alle Module, beschreibt sie EINMAL
   ↓
modules/ + views/   ← kennen den Kern, nie app.js
   ↓
core/ + ui/         ← kennen keine Module
```

Ein Modul, das `app.js` importiert, erzeugt einen Zirkelbezug und macht die
Tests unmöglich (sie laden Module einzeln, ohne DOM).

### Die Registry: ein Modul, eine Stelle

`js/module-registry.js` beschreibt jedes Modul genau einmal — Name, Icon,
Tabs, planbar?, Statuszeile fürs Dashboard, die Fabrik. Alles Weitere fällt
daraus ab: die Kacheln entstehen per `map`, die Navigation fragt `tabs`, das
Routing fragt dieselbe Tabelle.

Vorher lagen diese Angaben in acht parallelen Listen in `app.js`. Ein Modul
einzuhängen hieß, an rund zehn Stellen daran zu denken — und genau dieses
Vergessen war die Ursache eines Anzeigefehlers: Die Liste mit den
Session-Namen kannte Schwimmen nicht, also hieß jede Schwimmeinheit
„Wanderung".

**Ein neues Modul kommt in die Registry, sonst nirgendwo hin.** Was das Modul
über sich selbst weiß (Messwerte, Texte, Logik), bleibt in seiner eigenen
Config — die Registry beschreibt nur, wie es in der Navigation auftaucht.

### Ansichten bekommen ihren Zustand übergeben

Alles unter `js/views/` sind Funktionen mit Argumenten, keine Funktionen mit
Umgebung:

```js
tagSheetHtml(state, iso, { offen, krankBis })
```

Das ist der Unterschied zwischen prüfbar und nicht prüfbar. Solange diese
Ansichten in `app.js` steckten, ließen sie sich in Node gar nicht laden
(`app.js` fasst beim Start das DOM an) — und genau dort konnte ein
Anzeigefehler monatelang unbemerkt wohnen. Neue Ansichten deshalb bitte
genauso: Zustand rein, String raus.

---

## Was liegt wo

| Datei | Zweck |
|---|---|
| `js/app.js` | Die Hülle: Tabs, Dashboard, Import/Export, Event-Verdrahtung |
| `js/core/model.js` | Datenmodell + **alle Datums-Helfer** |
| `js/core/metrics.js` | Messwert-Registry (welche Zahlen es gibt, wie sie formatiert werden) |
| `js/core/statistik.js` | Zeitraum-Aggregation (Woche/Monat/Jahr) für die Statistik-Ansicht |
| `js/core/plan.js` | Trainingszyklus, Einheiten, Positionsberechnung |
| `js/core/library.js` | Übungs-Bibliothek |
| `js/core/storage.js` | Speichern, Laden, Backup, Migration |
| `js/core/koerper.js` | Körperwerte-Register + Verlauf (Gewicht, KFA …) |
| `js/module-registry.js` | **Alle Module, einmal beschrieben.** Erste Anlaufstelle für ein neues Modul |
| `js/route.js` | Adresse ⇄ Ansicht (Hash-Routing, reine Logik) |
| `js/views/kalender-ansicht.js` | Wochen-Streifen, Monatsraster, Tages-Sheet |
| `js/views/daten-ansicht.js` | Unterseite „Daten & Backup" |
| `js/views/session-zeilen.js` | Die Zeile, die Kraft-Verlauf **und** Tages-Sheet teilen |
| `js/ui/tastatur.js` | Bildschirmtastatur: „Weiter" ins nächste Feld, verdeckte Felder nachführen |
| `js/modules/kraft.js` | Kraft-Fabrik: Oberflächen-Zustand, Ansichten zusammensetzen, Aktionen |
| `js/modules/kraft/logik.js` | Die Rechenregeln: Progression, PRs, Verlauf, Prefill |
| `js/modules/kraft/eingabe-html.js` | DER eine Renderer für Eingabefelder |
| `js/modules/kraft/heute-ansicht.js` | Kraft: Heute-Tab |
| `js/modules/kraft/plan-ansicht.js` | Kraft: Plan-Tab + Bottom-Sheets |
| `js/modules/kraft/fortschritt-ansicht.js` | Kraft: Fortschritt (Charts) |
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

### 3a. Eine Kraft-Einheit pro Kalendertag

`kannKraftSessionStarten(state, datum)` ist die Regel, nicht der ausgeblendete
Knopf. Zwei volle Einheiten an einem Tag sind nichts, was der Körper leistet,
und der Zyklus rechnet ohnehin in Kalendertagen. Wer abends etwas nachträgt,
ergänzt die bestehende Einheit — sie bleibt den ganzen Tag bearbeitbar.

Übersprungene Tage blockieren nicht: „übersprungen" ist ja das Gegenteil einer
Einheit. Die Prüfung liegt bewusst im Kern, damit eine spätere UI-Änderung sie
nicht versehentlich aushebelt.

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

### 6a. Ein Vorschlag gehört zu der Historie, aus der er stammt

Beim Abhaken füllt `prefillEintrag` den ersten Satz mit den Werten der letzten
Session — und markiert ihn mit `quelle: 'prefill'`. Sobald der Nutzer etwas
tippt (oder Vorzeichen/Aufwärmsatz umschaltet), wird daraus `quelle:
'manuell'`.

Diese Markierung ist der ganze Trick beim Wechsel auf eine Alternative:

- Steht dort nur noch ein unberührter Vorschlag, wird er durch den Vorschlag
  der **neuen** Übung ersetzt — und bleibt **leer**, wenn es dazu keine
  Historie gibt. Sonst stünden dort Gewichte, die für diese Übung nie
  gehoben wurden, und die Alternative würde sich diese fremde Zahl beim
  nächsten Mal auch noch merken.
- Getippte Werte bleiben **immer** stehen, in beide Richtungen.

Wer `k.wert` & Co. anfasst: die `beruehrt()`-Zeile nicht wegoptimieren, sonst
ist der Marker wieder bedeutungslos.

---

## Ein neues Modul einhängen

1. **Modul schreiben.** Ist es eine Sportart, die man einfach loggt (wie Rad,
   Wandern, Schwimmen), reicht eine Config auf der Touren-Fabrik
   (`modules/touren/tour-modul.js`) — das sind rund 70 Zeilen. Exportieren:
   `MODUL`, `erstelleXModul`, `TITEL_EINZAHL`, `NOMEN` und die Statistik.
2. **In `js/module-registry.js` eintragen.** Genau ein Eintrag: Name, Icon,
   Tabs, planbar?, Statuszeile. Die Reihenfolge dort ist die Reihenfolge der
   Kacheln auf dem Dashboard.
3. **Kategorie ergänzen** in `KATEGORIEN` (`core/model.js`) und eine
   Akzentfarbe in `css/style.css` (`--<modul>`), plus `.modul-kachel.<modul>`.
4. **Fertig.** Navigation, Routing, Kalender-Punkte und Dashboard-Kachel
   entstehen aus der Registry.

Was du **nicht** tun musst: irgendwo eine Liste von Modulnamen erweitern. Wenn
du beim Einbauen doch eine findest, gehört sie in die Registry.

---

## Tests

266 Tests, alle ohne Browser lauffähig, ohne eine einzige Abhängigkeit:

```
npm test
```

Sie kommen in vier Sorten, und die Unterscheidung ist wichtig, weil jede
Sorte eine andere Art von Fehler fängt:

| Sorte | Datei(en) | fängt |
|---|---|---|
| **Logik** | `kraft.test.js`, `statistik.test.js`, `kalender.test.js` … | Rechenfehler: Progression, PRs, Zyklus, Zeiträume, Datumsgrenzen |
| **Ansichten** | `ansichten.test.js` | Was im HTML steht: Namen, Einheiten, die drei Gesichter eines Tages |
| **Render-Smoke** | `render-smoke.test.js` | Ob jedes Modul überhaupt sinnvoll rendert — inkl. Sweep auf `undefined`/`NaN` |
| **Aktions-Smoke** | `aktionen-smoke.test.js` | Fehlende Namen: ruft **jede** Aktion **jedes** Moduls einmal auf |

### Warum es die letzten beiden Sorten gibt

Beide sind aus echten Fehlern entstanden, die vorher niemand gesehen hat:

1. Im Kraft-Verlauf stand die Hauptübung statt der benutzten Alternative.
   `loeseSegmentAuf` war sauber getestet und lieferte die richtige Antwort —
   die Oberfläche hat sie nur nicht benutzt. Die Lücke lag nicht in der
   Logik, sondern **zwischen** Logik und HTML.
2. Beim Aufteilen von `kraft.js` fielen fünf Namen aus dem Import-Block.
   Alle Tests blieben grün, weil die betroffenen Aktionen (Teilen,
   Umbenennen) von keinem Test aufgerufen wurden. Aufgefallen ist es beim
   Benutzen: „segmentZusammenfassungWerte is not defined".

**Merksatz daraus:** Ein Test sieht nur Code, den er auch ausführt. Grün
heißt „was ich angefasst habe, war in Ordnung" — nicht „alles ist heil".

### Regeln für neue Tests

- Neue Logik gehört in eine reine Funktion, die man ohne DOM testen kann.
  Ist etwas nur im Browser prüfbar, ist es meist zu eng mit der Darstellung
  verwoben.
- Neue Ansichten bekommen ihren Zustand als Argument (siehe oben) — dann
  reicht `tests/helpers/umgebung.js` als Browser-Attrappe.
- Ein neuer, grüner Test beweist erst mal nichts. Kaputtmachen, was er prüfen
  soll, und schauen, ob er umfällt. Sonst prüft er womöglich nichts.

### Was die Tests NICHT abdecken

- Alles hinter einer Rückfrage (`bestaetige`/`hinweis`) — im Test klickt
  niemand die Antwort. Sauber lösen ließe sich das, indem die Dialoge über
  `ctx` hereingereicht werden, so wie `sheet` es schon wird.
- CSS und Layout. Dafür braucht es einen echten Browser.
- Namen, die es nirgends gibt, in Code den kein Test aufruft. Ein Linter mit
  `no-undef` findet diese Klasse vollständig und ohne Ausführen — bewusst
  nicht eingebaut, weil das die Null-Abhängigkeiten-Linie bräche.

---

## Backup & Migration

**Export:** Zahnrad im Dashboard → Daten → Backup exportieren.
Erzeugt `all-in-one-backup-JJJJ-MM-TT-HHMMSS.json` — mit Uhrzeit in Ortszeit,
damit zwei Exporte am selben Tag nebeneinander liegen und die alphabetische
Sortierung zugleich die chronologische ist.

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
- Dialoge (`bestaetige`/`hinweis`) über `ctx` hereinreichen statt direkt zu
  importieren — dann sind auch die Aktionen dahinter testbar
- Dashboard als kompaktes Kachel-Raster, wenn mehr Module dazukommen
- Teilen vom Dashboard (Wochen-/Monatsstatistik)
- App-weiter Kalender: Personal Training, geplante Touren
- Challenge-Ausbau: Serien, Abzeichen („ohne Motor")
- GPX-Import fürs Rad (Strecke, Höhenmeter, Puls aus der Datei lesen)
