# Australien PLZ-Karte

Web-App für Handy und Laptop: australische Postleitzahlen eingeben und die
zugehörigen Gebiete auf der Karte farbig nach Bundesstaat markieren.

| Staat | Farbe |
|---|---|
| NSW | Lila |
| Victoria | Orange |
| South Australia | Pink |
| Western Australia | Rot |
| Northern Territory | Blau |
| Queensland | Neongrün |
| ACT, Tasmanien | Türkis, Gelb (nicht vorgegeben, in den Einstellungen änderbar) |

## Funktionen

- **Karten:** Google Maps (Straße, Satellit, Hybrid) und Organic Maps
  (OpenStreetMap, dieselbe Datenbasis wie die Organic-Maps-App), umschaltbar
  oben rechts. Bis Zoomstufe 21 (Google) bzw. 19 (OSM).
- **G / OM:** öffnet den aktuellen Kartenausschnitt in Google Maps bzw. Organic Maps.
- **Postleitzahlen:** beliebig viele, einzeln (`2000 3000, 4000`) oder als
  Bereich (`2000-2099`, auch `0200-9999` für alle).
  Bei Bereichen werden nur Postleitzahlen übernommen, die ein Gebiet haben.
  Postfach- und Firmen-PLZ ohne Gebiet werden gestrichelt angezeigt.
- **Transparenz:** ganz rausgezoomt deckend, beim Reinzoomen immer
  transparenter, aber nie unsichtbar. Die Grenzlinie bleibt kräftig. Die
  Mindest-Deckkraft lässt sich in den Einstellungen anpassen.
- **Link kopieren:** erzeugt einen Link mit allen Postleitzahlen, z. B. um die
  Auswahl vom Laptop aufs Handy zu übertragen. Die Liste wird außerdem lokal im
  Browser gespeichert.
- **Als App installieren:** auf dem Handy über „Zum Home-Bildschirm“.

## Daten

Die Gebiete sind die **Postal Areas (POA) 2021** des Australian Bureau of
Statistics in voller Detailstufe (CC BY 4.0). Beim Deploy lädt der Workflow
`.github/workflows/pages.yml` den offiziellen Datensatz, vereinfacht ihn
nur mit 1 m Toleranz (sieht auch ganz reingezoomt aus wie das Original) und legt
pro Postleitzahl eine Datei an. Für niedrige Zoomstufen gibt es zusätzlich eine
Übersicht mit 50 m Toleranz (dort kleiner als ein halber Pixel). Ab Zoomstufe 10 lädt
die App für die sichtbaren Gebiete die vollen Grenzen nach, so bleibt sie auch
mit Tausenden Postleitzahlen flüssig. Die Zuordnung zu Staaten folgt den
Nummernbereichen von Australia Post.

## Veröffentlichen (GitHub Pages)

Jeder Push auf `main` baut die Daten und veröffentlicht die Seite unter
https://hubijo77.github.io/Postal-Codes-Reader-Australia/
(Repository → Settings → Pages → Source: **GitHub Actions**).

## Lokal ausprobieren

Ohne `data/`-Ordner fragt die App die Gebiete direkt beim ABS-Kartendienst ab.

```sh
python3 -m http.server 8000
```

Optional die Daten lokal bauen (Shapefile `POA_2021_AUST_GDA2020_SHP.zip` von
der ABS-Seite „Digital boundary files“ herunterladen und entpacken):

```sh
npx mapshaper POA_2021_AUST_GDA2020.shp -proj wgs84 -simplify dp interval=1 keep-shapes \
  -o format=geojson precision=0.000001 poa.geojson
npx mapshaper poa.geojson -simplify dp interval=50 keep-shapes \
  -o format=geojson precision=0.0001 poa-overview.geojson
node scripts/build-data.mjs poa.geojson poa-overview.geojson data
```
