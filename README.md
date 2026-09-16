# Nagelstudio

Eine Web-App zum Zeichnen, Sammeln und (später) Anprobieren von Nageldesigns.
Alles läuft im Browser, alle Entwürfe bleiben auf dem Gerät.

## Stand

**Fertig — Stufe 1: Zeichenstudio**

* Zeichnen mit Apple Pencil inklusive Druckstärke; der Finger schiebt und zoomt das Bild
* Werkzeuge: Pinsel, Liner, Glitzer, Radierer, Ebene füllen, Ebene leeren
* Ebenen mit Sichtbarkeit, Reihenfolge und Deckkraft
* Acht Nagelformen (Oval, Rund, Squoval, Quadrat, Mandel, Sarg, Ballerina, Stiletto)
* Rückgängig und Wiederholen (24 Schritte)
* Automatisches Speichern in der Geräte-Datenbank (IndexedDB)
* Austausch per Datei — auf dem iPad/iPhone über das Teilen-Menü, also auch per AirDrop
* Läuft offline, lässt sich auf den Home-Bildschirm legen

**Geplant**

* Stufe 2: Foto einer Hand aufnehmen, Nägel automatisch erkennen, Design auflegen, mit dem Pencil nachjustieren
* Stufe 3: dasselbe live im Kamerabild
* Optional: automatischer Abgleich über eine Cloud statt AirDrop

## Ins Netz stellen

Die Kamera und die Home-Bildschirm-Installation brauchen HTTPS — direkt vom Gerät
geöffnete Dateien reichen dafür nicht. Am einfachsten über GitHub Pages:

1. Im Repository unter *Settings → Pages* als Quelle den Branch wählen und `/ (root)` als Ordner.
2. Nach ein paar Minuten liegt die App unter
   `https://<benutzername>.github.io/bruecke-app/nagelstudio/`.
3. Die Adresse auf dem iPad in Safari öffnen, dann *Teilen → Zum Home-Bildschirm*.
   Die App startet danach im Vollbild ohne Safari-Leisten.

Zum Ausprobieren am Rechner genügt ein lokaler Server im Repository-Ordner,
zum Beispiel `npx http-server -p 8080`, und dann
`http://localhost:8080/nagelstudio/`.

## Entwürfe zwischen iPad und iPhone austauschen

* **Sichern** in der Übersicht schreibt alle Entwürfe in eine `.json`-Datei und öffnet
  das Teilen-Menü. Von dort per AirDrop aufs andere Gerät.
* **Empfangen** liest so eine Datei wieder ein.
* Zusammengeführt wird über die Änderungszeit: Wo derselbe Entwurf auf beiden Geräten
  liegt, gewinnt die neuere Fassung. Was das andere Gerät noch nicht kennt, kommt dazu.
* Dieselbe Datei ist auch die Sicherungskopie. Safari räumt Website-Daten
  irgendwann auf — wer seine Entwürfe behalten will, sichert sie ab und zu weg.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `js/shapes.js` | Die Nagelformen als Pfade in einem normierten System (100 × 140) |
| `js/draw.js` | Zeichen-Engine: Ebenen, Werkzeuge, Druckstärke, Verlauf, Darstellung |
| `js/store.js` | IndexedDB, Datenmodell, Export, Import, Zusammenführen |
| `js/app.js` | Oberfläche: Galerie, Editor, Speichern |
| `sw.js` | Offline-Betrieb |

Jeder Entwurf trägt eine eindeutige ID und eine Änderungszeit, gelöschte Entwürfe
bleiben als Markierung erhalten. Ein späterer Cloud-Abgleich braucht deshalb keine
Umbauten am Datenmodell — `mergeDesigns()` in `store.js` ist bereits die vollständige
Zusammenführ-Logik, sie bekommt ihre Daten dann vom Server statt aus einer Datei.

Gezeichnet wird immer in die normierte Nagelform, nicht in ein beliebiges Bild.
Dadurch lässt sich dasselbe Design später auf jeden erkannten Nagel legen.
