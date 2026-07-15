# All-in-One

Fitness-Tracking-App für Kraft, Rad, Wandern, Schwimmen und selbstgesetzte Ziele.
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
| `js/modules/kraft.js` | Kraftmodul (das größte — Progression, PRs, Sätze) |
| `js/modules/rad.js` | Radmodul (freie Touren, kein Plan) |
| `js/modules/wandern.js` | Wandermodul (freie Touren; Schritte, Höhenmeter, Std:Min) |
| `js/modules/schwimmen.js` | Schwimmmodul (freie Einheiten; Bahnen als Primär-Einheit) |
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

### 4. Service Worker cacht nichts — mit Absicht

Er existiert nur, damit Chrome die App als installierbar erkennt. Jede Anfrage
geht direkt ans Netz, deshalb sind Deploys sofort sichtbar.

Falls je Offline-Caching dazukommt: **unbedingt** einen sichtbaren
„Update verfügbar"-Flow mitbauen. Sonst hält der alte Service Worker die alten
Dateien fest, und neue Versionen erscheinen erst nach Tagen.

### 5. Eingabefelder nicht bei jedem Tastendruck neu rendern

Wird ein Feld während der Eingabe neu erzeugt, verliert es den Fokus und der
„Weiter"-Knopf der Handy-Tastatur springt ins Leere. Deshalb speichert
`k.wert` nur und rendert *nicht* neu.

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

166 Tests, alle ohne Browser lauffähig. Sie decken die Rechenlogik ab:
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

Bei kaputten gespeicherten Daten legt die App eine Rettungskopie unter
`gogadon_allinone_v1_defekt` an und startet leer. Die Konsole sagt dann Bescheid.

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
