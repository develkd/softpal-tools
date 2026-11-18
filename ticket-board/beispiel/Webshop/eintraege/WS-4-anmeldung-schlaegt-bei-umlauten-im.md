---
id: WS-4
typ: bug
titel: Anmeldung schlägt bei Umlauten im Passwort fehl
status: in-arbeit
prioritaet: kritisch
sprint: sprint-01
epic: WS-1
version: "1.0.0"
faellig: 2026-11-20
farbe: "#dc2626"
labels: [auth]
rang: 2000
erstellt: 2026-11-18
aktualisiert: 2026-11-18
---
## Schritte zum Nachstellen

1. Konto mit Passwort `Grüße123` anlegen
2. Abmelden und neu anmelden

## Erwartet

Anmeldung klappt.

## Tatsächlich

„Passwort falsch“. Vermutlich die Kodierung beim Hashen, siehe WS-5.
