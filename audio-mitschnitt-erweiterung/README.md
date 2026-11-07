# Audio-Mitschnitt – Browser-Erweiterung

Erweiterung für **Chrome, Edge (und andere Chromium-Browser) sowie Firefox**, die den **Ton des aktuellen Tabs als MP3** aufnimmt. Sie funktioniert unabhängig vom Betriebssystem (Windows, macOS, Linux) und braucht keine Installation außerhalb des Browsers.

![Popup während der Aufnahme](docs/popup.png)

> **Wichtig – was eine Erweiterung kann und was nicht:** Browser lassen Erweiterungen aus Sicherheitsgründen **nicht** an die gesamte Soundausgabe des Computers. Aufgenommen wird nur, was **im Browser-Tab** abgespielt wird (Videos, Musik, Web-Konferenzen im Browser, Web-Apps). Ton anderer Programme (Teams-/Zoom-App, Spotify-App, Systemklänge) erfasst nur die Desktop-App [`../audio-mitschnitt/`](../audio-mitschnitt/README.md).

## Bedienung

1. Im Tab, dessen Ton aufgenommen werden soll, auf das **Symbol der Erweiterung** klicken.
2. **„● Aufnahme starten“**. Das Symbol zeigt nun `REC`. Das Popup darf geschlossen werden, die Aufnahme läuft weiter.
3. Zum Beenden erneut das Symbol anklicken: **„■ Beenden & speichern“**.
4. Die Datei landet als `Mitschnitt_JJJJ-MM-TT_hh-mm-ss.mp3` unter **Downloads/Mitschnitte/**. Mit der Einstellung „Speicherort jedes Mal fragen“ wird stattdessen nachgefragt.

Weitere Funktionen:

- **Pause/Weiter**: Die Pausenzeit fehlt in der Datei.
- **Qualität** 96–320 kbit/s (Standard 192), 48 kHz Stereo.
- **Stille bleibt erhalten**: Die Datei läuft synchron zur echten Zeit.
- **Tab geschlossen**: Die Aufnahme wird automatisch beendet und gespeichert.
- Der Ton bleibt während der Aufnahme **hörbar**.
- Es läuft immer nur eine Aufnahme zugleich. Das Popup zeigt an, in welchem Tab.

## Unterschiede Chrome / Firefox

| | Chrome, Edge, Brave, Opera … | Firefox |
|---|---|---|
| Technik | `tabCapture` (offizielle Tab-Aufnahme) | Firefox bietet keine Tab-Aufnahme. Die Erweiterung greift die `<audio>`/`<video>`-Elemente der Seite über Web Audio ab. |
| Was wird aufgenommen | **alles**, was der Tab ausgibt: Videos, Musik, Web Audio, WebRTC-Anrufe | `<audio>`/`<video>`-Elemente (YouTube, Mediatheken, Podcasts …) und WebRTC-Streams an Media-Elementen |
| Nicht erfasst | – | reine Web-Audio-Ausgaben (z. B. Spiele, manche Synthesizer); Medien von **fremden Domains ohne CORS** (sie spielen normal weiter, fehlen aber in der Aufnahme; das Popup zeigt die Anzahl an) |
| Seitenwechsel im Tab | Aufnahme läuft weiter | Aufnahme läuft weiter, Abgriff wird automatisch neu eingefügt |
| Getestet | automatisiert in Chromium (siehe unten) | Logik in Chromium simuliert, `web-ext lint` ohne Fehler; **in echtem Firefox noch nicht getestet** |

Firefox-Besonderheit: Erlaubt die Seite noch keine Tonwiedergabe (Autoplay-Sperre), wartet der Abgriff auf einen Klick in die Seite. Er fasst die Elemente vorher nicht an, damit nichts verstummt.

## Installieren

Erst bauen (Node.js ≥ 18, keine Abhängigkeiten):

```bash
cd audio-mitschnitt-erweiterung
node build.mjs
```

Das erzeugt `dist/chrome/`, `dist/firefox/` sowie je eine ZIP-Datei. Die ZIPs gibt es auch fertig als Artefakt **`audio-mitschnitt-erweiterung`** am Workflow-Lauf auf GitHub (Actions).

**Chrome / Edge**
1. `chrome://extensions` (bzw. `edge://extensions`) öffnen, **Entwicklermodus** einschalten.
2. **„Entpackte Erweiterung laden“** → Ordner `dist/chrome` wählen (bzw. die entpackte ZIP).
3. Symbol über das Puzzle-Menü an die Leiste anheften.

**Firefox**
- Zum Ausprobieren: `about:debugging#/runtime/this-firefox` → **„Temporäres Add-on laden …“** → `dist/firefox/manifest.json`. Das Add-on bleibt bis zum Neustart von Firefox installiert.
- Dauerhaft: Firefox installiert nur von Mozilla signierte Add-ons. Die ZIP bei [addons.mozilla.org](https://addons.mozilla.org/developers/) hochladen (auch „nicht gelistet“ zur eigenen Verteilung möglich) oder mit `web-ext sign` signieren. Alternativ in Firefox ESR/Developer Edition `xpinstall.signatures.required` auf `false` setzen.

Benötigte Berechtigungen: Chrome: `tabCapture`, `offscreen`, `activeTab`, `downloads`, `storage`. Firefox: `<all_urls>` (Abgriff auch in eingebetteten Playern/iframes), `tabs`, `activeTab`, `downloads`, `storage`. Es werden keine Daten gesendet; alles bleibt lokal.

## Aufbau

```
audio-mitschnitt-erweiterung/
├── manifest.chrome.json     Manifest V3 (Service Worker + Offscreen-Dokument)
├── manifest.firefox.json    Manifest V2 (dauerhafte Hintergrundseite)
├── build.mjs                baut dist/chrome, dist/firefox und ZIPs
├── src/
│   ├── lib/
│   │   ├── mischer.js       Quellen mischen, Takt nach echter Zeit, Stille/Drift
│   │   ├── aufnahme.js      Mischer + MP3-Kodierung, Pause, Status
│   │   ├── abgriff.js       PCM aus einem AudioContext abgreifen
│   │   ├── lame.min.js      lamejs 1.2.1 (MP3-Encoder, LGPL-3.0)
│   │   └── lizenzen/        Lizenztexte Drittanbieter
│   ├── popup/               Oberfläche (für beide Browser gleich)
│   ├── chrome/              background.js (tabCapture, Download), offscreen.* (Aufnahme)
│   ├── firefox/             background.* (Aufnahme, Download), tap.js (Abgriff in der Seite)
│   └── icons/
└── tests/
    ├── *.test.mjs           Unit-Tests (node --test), MP3 wird Frame für Frame geprüft
    ├── e2e-chrome.mjs       echter Chromium: Erweiterung laden, Töne aufnehmen, MP3 analysieren
    └── e2e-abgriff.mjs      Firefox-Abgriff in Chromium mit nachgebildeter Erweiterungs-API
```

## Entwickeln & Testen

```bash
npm test                 # Unit-Tests
npm run test:e2e         # baut und testet in Chromium (Playwright nötig; unter Linux: xvfb-run -a npm run test:e2e)
npm run lint:firefox     # Mozilla-Prüfung des Firefox-Pakets
```

**CI:** `.github/workflows/audio-mitschnitt-erweiterung.yml` führt alle Tests aus und stellt die beiden ZIPs als Artefakt bereit.

## Hinweis

Aufnahmen von Gesprächen oder Konferenzen nur mit Einverständnis aller Beteiligten anfertigen (§ 201 StGB). Bei urheberrechtlich geschützten Inhalten gelten die üblichen Grenzen der Privatkopie. Manche Streaming-Dienste schützen ihre Inhalte per DRM. Deren Ton kann eine Erweiterung nicht aufnehmen, dort entsteht Stille.
