# FitCoach (Android)

Sport-, Diät- und Aktivitäten-App auf **Deutsch und Türkisch**: Gewicht täglich eintragen, Kalorien per Foto ermitteln,
Tagesbedarf berechnen und verfolgen, aufgenommene und verbrauchte Kalorien vergleichen und Übungen mit Animation
vorgemacht bekommen. Die App gibt **ausschließlich positive, ermutigende Hinweise**.

## Funktionen

| Bereich | Was die App kann |
|---|---|
| **Profil** (erster Start, später unter Einstellungen) | Alter, Geschlecht (weiblich/männlich/divers), Größe, aktuelles Gewicht, Aktivitätszustand (**Sportlich / Normal / Unsportlich**), Ziel (abnehmen/halten/zunehmen) |
| **Tagesbedarf** | Automatisch berechnet (siehe unten) **oder selbst festgelegt** (1000–6000 kcal). Die App verfolgt den Tag: Ring mit „noch frei“, Sport zählt als Bonus dazu. |
| **Übersicht (Dashboard)** | Tagesring, ermutigender Tageshinweis, Serie aufeinanderfolgender Tage, **Wochen-Diagramm aufgenommen vs. verbraucht**, Gewichtsverlauf (30 Tage), BMI |
| **Essen** | Mahlzeit **fotografieren** oder aus der Galerie wählen → Kalorien werden ermittelt; Vorschläge mit Portionsgrößen (½, 1, 1½, 2); Suche in einer Tabelle mit ~70 deutschen und türkischen Gerichten; manuelle Eingabe |
| **Sport** | Tagesprogramm passend zum Aktivitätszustand (1 Aufwärmübung + 3 Übungen, wechselt täglich), jede Übung mit **animierter Strichfigur**, Schritt-für-Schritt-Anleitung, Dosierung, Stoppuhr; „Geschafft“ trägt den Verbrauch ein. Weitere Aktivitäten (Spazieren, Radfahren, Schwimmen …) frei eintragbar. |
| **Gewicht** | Jeden Tag das aktuelle Gewicht eintragen (ein Eintrag pro Tag, der neueste zählt), Verlauf über 7/30/90/365 Tage, Liste mit Löschen. Das Profilgewicht folgt dem neuesten Eintrag, der Bedarf bleibt so aktuell. |
| **Sprache** | Deutsch / Türkçe, umschaltbar beim ersten Start und in den Einstellungen (folgt sonst der Systemsprache) |

### Kalorien per Foto – zwei Stufen

1. **Auf dem Gerät (Standard, offline):** Google ML Kit erkennt Bildinhalte (z. B. „Pizza“, „Banana“, „Bread“). Die App
   ordnet sie Lebensmitteln aus der eingebauten Tabelle zu und schlägt Portionen vor; über die Suche lässt sich alles
   ergänzen. Das Foto verlässt das Gerät nicht. Die Erkennung ist allgemein gehalten – bei gemischten Tellern hilft die Suche.
2. **ChatGPT-Analyse (optional, genauer):** Mit einem eigenen OpenAI-API-Schlüssel (Einstellungen →
   „ChatGPT-Fotoanalyse“) wird das Foto über die OpenAI **Responses API** (`POST /v1/responses`) an ChatGPT gesendet –
   standardmäßig Modell `gpt-5.5`, in den Einstellungen änderbar (z. B. ein günstigeres Modell). ChatGPT erkennt jedes
   Lebensmittel, schätzt Gramm und kcal und antwortet als JSON nach festem Schema (Structured Outputs, `strict`); das
   Ergebnis wird übernommen und kann vor dem Speichern angepasst werden. Die Anfrage setzt `store: false`. Jede Analyse
   wird über das OpenAI-Konto des Schlüssels abgerechnet. Fehler (ungültiger Schlüssel, Guthaben aufgebraucht, Modell
   nicht verfügbar, überlastet, offline) werden freundlich erklärt.
   Ohne Internet oder bei Problemen bleibt Stufe 1 verfügbar.

### Berechnung

- **Grundumsatz** (Mifflin-St Jeor): `10 × kg + 6,25 × cm − 5 × Alter + s`, s = +5 (männlich), −161 (weiblich), −78 (divers, Mittelwert)
- **Tagesbedarf** = Grundumsatz × Aktivitätsfaktor + Ziel: Unsportlich 1,2 · Normal 1,55 · Sportlich 1,725;
  abnehmen −400 kcal, zunehmen +300 kcal; nie unter 1200 kcal. Ein selbst festgelegter Wert hat Vorrang.
- **Verbraucht** (Dashboard) = Grundumsatz × 1,2 (Alltag ohne Sport) + eingetragene Aktivitäten
- **Aktivitäten**: `kcal = MET × kg × Stunden` (MET-Werte nach dem Compendium of Physical Activities)

Alle Werte sind Richtwerte für den Alltag, keine medizinische Beratung.

### Nur positive Hinweise

Alle Texte sind ermutigend formuliert – statt „zu viel gegessen“ heißt es z. B. „Heute hast du ordentlich Energie
getankt – perfekt für eine kleine Bewegungseinheit!“. Es gibt keine Warnfarben; über dem Ziel bleibt der Ring einfach
voll („Ziel erreicht 🎉“). Unit-Tests prüfen alle Hinweise und Oberflächentexte in beiden Sprachen gegen eine Liste
negativer Begriffe. Auch ChatGPT wird angewiesen, nur positiv zu formulieren.

## Projektstruktur

```
fit-coach/
├── core/   Reines Kotlin/JVM-Modul (ohne Android), mit Unit-Tests
│   ├── EnergyCalculator   Grundumsatz, Tagesbedarf, MET-Verbrauch, BMI
│   ├── Stats              Tageswerte, Wochenvergleich, Gewichtsverlauf, Serie
│   ├── Encouragement      positive Hinweise (DE/TR)
│   ├── exercise/          Übungen, Keyframe-Posen der Strichfiguren, Tagesvorschläge
│   └── food/              Lebensmittel-Tabelle, Label-Zuordnung, ChatGPT-Fotoanalyse (OkHttp)
└── app/    Android-App (Kotlin, Jetpack Compose, Material 3)
    ├── data/              JSON-Speicher (privater App-Speicher), Foto laden, ML Kit
    └── ui/                Screens, Diagramme (Canvas), Strichfiguren-Animation
```

- `minSdk` 26 (Android 8.0), `targetSdk`/`compileSdk` 35
- Berechtigung: nur `INTERNET` (für die optionale ChatGPT-Analyse). Die Kamera läuft über die System-Kamera-App.
- Daten: eine JSON-Datei im privaten App-Speicher, kein Konto, keine Cloud; App-Backup ist deaktiviert, damit der
  OpenAI-API-Schlüssel das Gerät nicht verlässt.
- Abhängigkeiten: AndroidX/Compose, kotlinx.serialization und OkHttp (alle Apache-2.0),
  ML Kit Image Labeling (Google ML Kit Terms of Service, Modell in der App gebündelt).

## Bauen & Testen

Voraussetzung: JDK 17+ und Android SDK (Android Studio).

```bash
cd fit-coach
./gradlew :core:test                # Berechnung, Übungen, Lebensmittel, positive Texte, ChatGPT-Anbindung gegen Testserver (reines JVM)
./gradlew :app:testDebugUnitTest    # Oberflächentexte DE/TR vollständig und positiv
./gradlew :app:assembleDebug        # APK: app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:installDebug         # auf angeschlossenes Handy installieren
```

**APK:** `.github/workflows/fit-coach.yml` baut bei jeder Änderung unter `fit-coach/` Tests und Debug-APK. Das APK liegt
als Artefakt `fit-coach-debug-apk` am Workflow-Lauf und kann direkt aufs Handy geladen werden (Installation aus
unbekannten Quellen erlauben).

## Release

`.github/workflows/fit-coach-release.yml` baut die APK und veröffentlicht sie als GitHub-Release
(`FitCoach-<Version>.apk` plus SHA-256-Prüfsumme, Release-Notizen aus `release-notes.md`).

1. `versionName` (und `versionCode`) in `app/build.gradle.kts` erhöhen und per Pull Request nach `develop` bringen.
2. Release auslösen: Tag `fit-coach-v<versionName>` pushen **oder** unter *Actions → FitCoach Release → Run workflow*
   die Version eintragen (der Tag wird dann angelegt). Passt die Version nicht zu `versionName`, bricht der Lauf ab.

**Signatur:** Sind die Repository-Secrets `FITCOACH_KEYSTORE_BASE64` (Keystore als Base64), `FITCOACH_KEYSTORE_PASSWORD`,
`FITCOACH_KEY_ALIAS` und `FITCOACH_KEY_PASSWORD` gesetzt, wird ein Release-APK mit diesem festen Schlüssel signiert –
neue Versionen lassen sich dann über alte installieren, die Daten bleiben erhalten. Ohne Secrets wird mit einem
Debug-Schlüssel signiert (der Release-Text weist darauf hin).
