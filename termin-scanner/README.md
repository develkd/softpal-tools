# Termin-Scanner (Android)

Android-App, die Termine aus fotografierten Dokumenten erkennt und – **nach ausdrücklicher Bestätigung** – in den Google Kalender bzw. den Kalender des Handys einträgt.

## Ablauf

1. **Foto aufnehmen** (Kamera), **Bild aus der Galerie wählen** oder ein Bild aus einer anderen App per **„Teilen“ → Termin-Scanner** senden.
2. **Texterkennung** mit Google ML Kit – komplett auf dem Gerät, das Foto wird nicht hochgeladen.
3. **Termin-Erkennung** (Modul `extraction`): Datum, Uhrzeit/Zeitraum, Titel, Ort, Fristen. Briefdatum, Geburtsdatum, Rechnungsdatum und vergangene Daten werden nicht vorgeschlagen.
4. **Prüfansicht**: Alle gefundenen Termine werden angezeigt und sind bearbeitbar (Titel, Datum, Beginn/Ende, ganztägig, Ort, Erinnerung, Notiz). Per Häkchen wird gewählt, was eingetragen wird; Termine können auch manuell ergänzt werden. Oben wird der Zielkalender gewählt (Google-Kalender stehen zuerst).
5. **Bestätigungsdialog** „In den Kalender eintragen?“ listet nochmals alles auf. Erst mit **„Ja, eintragen“** wird geschrieben.
6. **Ergebnis**: Eingetragene Termine lassen sich direkt im Kalender öffnen. Doppelte Einträge (gleicher Titel + Beginn) werden erkannt und nicht erneut angelegt.

Ohne Kalender-Berechtigung öffnet die App stattdessen die Kalender-App mit vorausgefülltem Termin (dort mit „Speichern“ bestätigen).

**Google Kalender:** Termine in einem Kalender des Google-Kontos werden von Android automatisch mit dem Google Kalender (Web, andere Geräte) synchronisiert – eine Anmeldung in der App ist nicht nötig.

## Projektstruktur

```
termin-scanner/
├── app/          Android-App (Kotlin, Jetpack Compose, Material 3)
│   ├── ocr/          TextRecognitionService – ML Kit Texterkennung
│   ├── calendar/     CalendarRepository – Kalender lesen/schreiben (CalendarContract)
│   └── ui/           Screens, Prüfkarten, Bestätigungsdialog, ViewModel
└── extraction/   Reines Kotlin/JVM-Modul ohne Android-Abhängigkeit
                  AppointmentExtractor, DateParser, TimeParser, LayoutAnalyzer (+ Unit-Tests)
```

- `minSdk` 26 (Android 8.0), `targetSdk`/`compileSdk` 35
- Berechtigungen: `READ_CALENDAR`, `WRITE_CALENDAR` (Kamera läuft über die System-Kamera-App, keine Kamera-Berechtigung nötig)

## Erkannte Formate (Auswahl)

| Art | Beispiele |
|---|---|
| Datum | `12.11.2026`, `12.11.26`, `12. 11. 2026`, `2026-11-12`, `12.11.` (Jahr wird ergänzt), `12. November 2026`, `1. Dez.`, `November 20th, 2026` |
| Uhrzeit | `14:30`, `14.30 Uhr`, `14 Uhr`, `um 9`, `2 pm`, `10:00 - 11:30 Uhr`, `von 10 bis 12 Uhr`, `Beginn: … / Ende: …` |
| Titel | Zeile am Datum („Elternabend am …“), `Betreff:`, „Einladung zum …“, Überschrift (größte Zeile), Absender („Termin: Praxis Dr. …“) |
| Ort | `Ort:`, `Raum:`, `Treffpunkt:`, `Adresse:`, „… im Gemeindezentrum“ |
| Frist | „bis zum 15.12.2026“, „spätestens …“, „fällig am …“ → ganztägig, Titel „Frist: …“ |

## Bauen & Testen

Voraussetzung: JDK 17+ und Android SDK (Android Studio).

```bash
cd termin-scanner
./gradlew :extraction:test          # Termin-Erkennung testen (reines JVM, kein SDK nötig)
./gradlew :app:testDebugUnitTest    # App-Unit-Tests
./gradlew :app:assembleDebug        # APK: app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:installDebug         # auf angeschlossenes Handy installieren
```

Oder in Android Studio den Ordner `termin-scanner/` öffnen und „Run“ drücken.

**CI:** `.github/workflows/termin-scanner.yml` baut bei jeder Änderung unter `termin-scanner/` die Tests und das Debug-APK. Das APK liegt als Artefakt `termin-scanner-debug-apk` am jeweiligen Workflow-Lauf und kann direkt aufs Handy geladen werden (Installation aus unbekannten Quellen erlauben).
