# Nagelstudio

Eine Web-App zum Gestalten, Sammeln und Anprobieren von Nageldesigns.
Alles läuft im Browser, alle Entwürfe bleiben auf dem Gerät. Ablauf und
Anmutung der Anprobe orientieren sich an der App naild.

## Stand

**Fertig — Stufe 1: Zeichenstudio**

* Ein Entwurf ist ein Satz aus fünf Nägeln. Die Übersicht zeigt alle fünf,
  jeder lässt sich einzeln bemalen; ein fertiger Nagel kann auf alle
  übertragen werden
* Jeder Nagel hat eine deckende Grundfarbe unter den Ebenen — unbemalte
  Stellen bleiben so, wie sie beim Malen aussehen, auch später auf der Hand
* Zeichnen mit Apple Pencil inklusive Druckstärke; der Finger schiebt und zoomt das Bild
* Werkzeuge: Pinsel, Liner, Glitzer, Stempel, Radierer, Ebene füllen, Ebene leeren
* Zehn Vorlagen (French, Halbmond, Verlauf, Diagonal, Spitze, Punkte, Streifen,
  Glitzerfall, Marmor, Rand) mit einstellbarer Stärke und zweiter Farbe; sie
  legen sich auf die aktive Ebene und bleiben frei weiter bemalbar
* Stempel: Herz, Stern, Blüte, Punkt, Schleife
* Farbe und Größe liegen über allen Reitern und sind immer erreichbar
* Ebenen mit Sichtbarkeit, Reihenfolge und Deckkraft
* Acht Nagelformen (Rund, Oval, Squoval, Eckig, Mandel, Sarg, Ballerina,
  Stiletto) und davon getrennt die Länge, stufenlos von Kurz bis XL. Die
  Formen werden für jede Länge neu berechnet: Eine kurze Mandel ist fast
  oval, eine kurze Sargform hat eine breite Kante, lang laufen beide
  deutlich zusammen. Formauswahl und Längenvorschau zeigen den Nagel auf
  einem gezeichneten Finger. Form und Länge gelten wahlweise für alle fünf
  Nägel
* Muster sind lebendig: Ein French bleibt an der Spitze, wenn man Form oder
  Länge ändert, weil die Musterebene neu gezeichnet wird statt als Pixel
  festzustehen. Glitzer und Marmor behalten dabei ihr Aussehen
* Rückgängig und Wiederholen (24 Schritte)
* Notiz je Entwurf (Kundin, verwendete Lacke, Anlass), Schlagworte und
  Favoriten; die Galerie durchsucht Name, Notiz und Schlagworte
* Automatisches Speichern in der Geräte-Datenbank (IndexedDB)
* Austausch per Datei — auf dem iPad/iPhone über das Teilen-Menü, also auch per AirDrop
* Läuft offline, lässt sich auf den Home-Bildschirm legen

**Fertig — Stufe 2: Anprobe**

* Live-Kamera mit Haltungsprüfung: Das Handskelett wird eingeblendet, die
  Kamera sagt, was zu tun ist („Näher ran", „Finger ausstrecken",
  „Ruhig halten") und löst bei „Perfekt ✓" nach einem 3-2-1 selbst aus
* Alternativ ein Foto aus der Mediathek
* Handerkennung im Browser (MediaPipe Hand Landmarker), Bibliothek und Modell
  liegen im Projekt — kein fremdes CDN, funktioniert offline
* Nagelflächen werden aus dem letzten Fingerglied geschätzt und anschließend
  im Foto nachgemessen: Die Fingerkontur verrät die tatsächliche Breite des
  Fingers, was die Gelenkpunkte nicht hergeben. Gemessen wird gegen eine
  Farbprobe aus dem Finger selbst, also unabhängig vom Hautton
* Designs werden aufgelegt, einzeln oder auf alle Nägel zugleich
* Beim Auflegen bekommt jeder Finger seinen eigenen Nagel aus dem Satz
* Zoomen und Schieben im Bild; jeder Nagel lässt sich ziehen, drehen, in Größe
  und Breite ändern und ausblenden — entweder mit Griffen oder mit Knöpfen,
  wahlweise für einen einzelnen Nagel oder für alle zugleich
* Fehlende Nägel lassen sich von Hand ergänzen
* Fotos werden vor der Erkennung aufgerichtet und verkleinert, damit die
  Drehung von Handyfotos (EXIF) nicht dazu führt, dass die Nägel danebensitzen
* Licht und Schatten der Hand scheinen durch das Design, dazu ein Glanz
  entlang der Nagelwölbung und ein Schatten auf dem Finger — ohne beides
  wirkt der Nagel wie aufgeklebt; beides lässt sich abschalten
* Ergebnisbildschirm mit Vorher/Nachher-Schieber
* „Länge & Form anpassen" direkt auf der Hand: dasselbe Design als kurze
  Mandel oder langer Sarg, ohne es neu zu gestalten
* Ergebnis teilen, oder beim Entwurf speichern — die Anproben erscheinen in
  der Übersicht des Entwurfs und lassen sich später wieder zeigen

**Geplant**

* Stufe 3: dasselbe live im Kamerabild
* Optional: automatischer Abgleich über eine Cloud statt AirDrop

**Grenzen der Erkennung**

Die Erkennung findet Fingergelenke, keine Nägel — die Nagelfläche wird daraus
abgeleitet und im Bild nachgemessen. Das sitzt gut, solange die Hand halbwegs
flach zur Kamera steht. Bei stark angewinkelten oder eingerollten Fingern wird
es ungenau, und ob man Handfläche oder Handrücken sieht, erkennt die App nicht
zuverlässig. Deshalb ist jeder Nagel von Hand nachziehbar und ausblendbar.

Nachgemessen wird bewusst nur die Größe, nicht die Lage: Versuche, den
Nagelrand im Bild zu finden und den Nagel danach zu verschieben, lagen in
Tests mal zu hoch, mal zu tief und waren damit schlechter als die Schätzung
aus den Gelenkpunkten. Die Fingerbreite dagegen lässt sich zuverlässig
messen.

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
| `js/handdetect.js` | Handerkennung und daraus abgeleitete Nagelflächen |
| `js/nailfit.js` | Nagelgröße im Foto nachmessen |
| `js/patterns.js` | Vorlagen und Stempel (mit festem Zufallsstartwert) |
| `js/nailrender.js` | Realistische Vorschau: Nagel auf einem gezeichneten Finger |
| `js/camera.js` | Live-Kamera mit Haltungsprüfung und Auto-Auslöser |
| `js/tryon.js` | Anprobe: Foto, Nägel justieren, Designs auflegen |
| `js/warp.js` | Ein Design auf eine Nagelfläche verzerren |
| `js/compose.js` | Ein gespeichertes Design zu einem Bild zusammensetzen |
| `sw.js` | Offline-Betrieb |
| `vendor/`, `models/` | Erkennungsbibliothek und Modell (rund 27 MB) |

Jeder Entwurf trägt eine eindeutige ID und eine Änderungszeit, gelöschte Entwürfe
bleiben als Markierung erhalten. Ein späterer Cloud-Abgleich braucht deshalb keine
Umbauten am Datenmodell — `mergeDesigns()` in `store.js` ist bereits die vollständige
Zusammenführ-Logik, sie bekommt ihre Daten dann vom Server statt aus einer Datei.

Gezeichnet wird immer in die normierte Nagelform, nicht in ein beliebiges Bild.
Dadurch lässt sich dasselbe Design auf jeden erkannten Nagel legen.

Bibliothek und Modell der Erkennung werden erst beim ersten Öffnen der Anprobe
geladen (rund 17 MB, mit Fortschrittsanzeige) und danach im Cache gehalten.
Der erste Start der App bleibt dadurch leicht. App-Code dagegen lädt der
Service Worker immer zuerst frisch aus dem Netz, damit nach einem Update
sofort die neue Fassung erscheint.

Das Raster einer Nagelform ist immer 100 × 140 Einheiten, die Nagelplatte
nimmt davon 68 % der Breite ein. Bei y = 70 liegt die Fingerkuppe, darüber
beginnt der freie Rand; die Länge (0 bis 1) bestimmt, wie weit er reicht.
Jede Form entsteht aus ihrer rechten Hälfte und wird gespiegelt. In der Anprobe wird dieses Raster an der Nagelhaut verankert —
dadurch stimmen die Längen von selbst, ohne dass die Erkennung etwas über
die gewünschte Form wissen müsste.
