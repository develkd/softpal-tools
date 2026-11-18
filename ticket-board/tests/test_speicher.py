import datetime as dt

import pytest

from ticket_board.frontmatter import Dokument
from ticket_board.speicher import Arbeitsbereich, Fehler, kuerzel_vorschlagen


def datei(projekt, eid):
    return next(projekt.eintraege_ordner.glob(f"{eid}-*.md"))


def test_projekt_anlegen_legt_ordner_und_dateien_an(arbeitsbereich, projekt):
    assert (projekt.pfad / "projekt.md").is_file()
    assert projekt.eintraege_ordner.is_dir()
    assert arbeitsbereich.uebersicht() == [{"id": "Ticket Board", "name": "Ticket Board", "kuerzel": "TB"}]
    with pytest.raises(Fehler):
        arbeitsbereich.projekt_anlegen("Ticket Board")
    with pytest.raises(Fehler):
        arbeitsbereich.projekt_anlegen("Anderes", "1X")


def test_ordnername_ohne_unerlaubte_zeichen(arbeitsbereich):
    info = arbeitsbereich.projekt_anlegen('Web/Shop: "Neu"?')
    assert info["id"] == "Web Shop Neu"
    assert info["kuerzel"] == "WSN"


def test_kuerzel_vorschlag():
    assert kuerzel_vorschlagen("Ticket Board") == "TB"
    assert kuerzel_vorschlagen("webshop") == "WEB"
    assert kuerzel_vorschlagen("123") == "T123"


def test_einzelprojekt(projekt):
    ab = Arbeitsbereich(projekt.pfad)
    assert ab.einzelprojekt
    assert [p.id for p in ab.projekte()] == ["Ticket Board"]
    with pytest.raises(Fehler):
        ab.projekt_anlegen("Noch eins")


def test_eintrag_anlegen_schreibt_markdown(projekt):
    e = projekt.eintrag_anlegen({"typ": "bug", "titel": "Login: Umlaute gehen nicht", "labels": "auth, ui",
                                 "version": "1.10", "faellig": "2026-12-01", "farbe": "#DC2626"})
    assert e["id"] == "TB-1"
    assert e["datei"] == "eintraege/TB-1-login-umlaute-gehen-nicht.md"
    inhalt = (projekt.pfad / e["datei"]).read_text(encoding="utf-8")
    assert inhalt.startswith("---\nid: TB-1\ntyp: bug\ntitel: \"Login: Umlaute gehen nicht\"\n")
    assert 'version: "1.10"' in inhalt
    assert 'farbe: "#dc2626"' in inhalt
    assert "labels: [auth, ui]" in inhalt
    assert "## Schritte zum Nachstellen" in inhalt
    assert e["version"] == "1.10" and e["labels"] == ["auth", "ui"]
    assert projekt.eintrag_anlegen({"titel": "Zweiter"})["id"] == "TB-2"
    assert "naechste_nummer" not in (projekt.pfad / "projekt.md").read_text(encoding="utf-8")


def test_geloeschte_ids_werden_nicht_wiederverwendet(projekt):
    projekt.eintrag_anlegen({"titel": "Eins"})
    projekt.eintrag_loeschen("TB-1")
    assert projekt.eintrag_anlegen({"titel": "Zwei"})["id"] == "TB-2"


def test_alter_zaehler_wird_beachtet(projekt):
    pfad = projekt.pfad / "projekt.md"
    pfad.write_text(pfad.read_text(encoding="utf-8").replace("kuerzel: TB\n", "kuerzel: TB\nnaechste_nummer: 50\n"), encoding="utf-8")
    assert projekt.eintrag_anlegen({"titel": "Alt"})["id"] == "TB-50"


def test_id_zaehler_beruecksichtigt_vorhandene_dateien(projekt):
    (projekt.eintraege_ordner / "TB-41-von-hand.md").write_text("---\ntitel: Von Hand\n---\n", encoding="utf-8")
    assert projekt.eintrag_anlegen({"titel": "Neu"})["id"] == "TB-42"


@pytest.mark.parametrize("felder", [
    {"titel": ""},
    {"titel": "x", "typ": "quatsch"},
    {"titel": "x", "status": "fertig"},
    {"titel": "x", "faellig": "1.12.2026"},
    {"titel": "x", "faellig": "2026-02-30"},
    {"titel": "x", "farbe": "rot"},
    {"titel": "x", "sprint": "sprint-99"},
    {"titel": "x", "epic": "TB-99"},
    {"titel": "x", "typ": "unteraufgabe"},
    {"titel": "a\nb"},
    {"titel": "x", "id": "TB-7"},
    {"titel": "x", "unbekannt": 1},
])
def test_ungueltige_eingaben(projekt, felder):
    with pytest.raises(Fehler):
        projekt.eintrag_anlegen(felder)


def test_aendern_behaelt_fremde_felder_und_text(projekt):
    e = projekt.eintrag_anlegen({"titel": "Alt", "text": "Mein Text\n"})
    pfad = projekt.pfad / e["datei"]
    pfad.write_text(pfad.read_text(encoding="utf-8").replace("---\nMein", "punkte: 5\n---\nMein"), encoding="utf-8")
    projekt.eintrag_aendern("TB-1", {"titel": "Neu", "status": "in-arbeit"})
    dok = Dokument.lesen(pfad.read_text(encoding="utf-8"))
    assert dok.get("titel") == "Neu"
    assert dok.get("status") == "in-arbeit"
    assert dok.get("punkte") == "5"
    assert dok.text == "Mein Text\n"
    assert pfad.name == "TB-1-alt.md"  # Dateiname bleibt stabil


def test_konflikt_bei_aenderung_von_aussen(projekt):
    e = projekt.eintrag_anlegen({"titel": "Konflikt"})
    pfad = projekt.pfad / e["datei"]
    pfad.write_text(pfad.read_text(encoding="utf-8") + "Von außen\n", encoding="utf-8")
    with pytest.raises(Fehler) as f:
        projekt.eintrag_aendern("TB-1", {"titel": "Meins"}, basis=e["basis"])
    assert f.value.status == 409
    assert f.value.daten["text"].endswith("Von außen\n")
    projekt.eintrag_aendern("TB-1", {"titel": "Meins"})  # ohne basis = trotzdem speichern
    assert projekt.laden()["eintraege"][0]["titel"] == "Meins"


def test_ohne_aenderung_wird_nicht_geschrieben(projekt):
    e = projekt.eintrag_anlegen({"titel": "Gleich"})
    pfad = projekt.pfad / e["datei"]
    vorher = pfad.stat().st_mtime_ns
    projekt.eintrag_aendern("TB-1", {"titel": "Gleich", "labels": []})
    assert pfad.stat().st_mtime_ns == vorher


def test_epic_und_unteraufgaben(projekt):
    s = projekt.sprint_anlegen({})
    ep = projekt.eintrag_anlegen({"typ": "epic", "titel": "Benutzerverwaltung", "sprint": s["id"]})
    assert ep["sprint"] == ""  # Epics gehören in keinen Sprint
    story = projekt.eintrag_anlegen({"typ": "story", "titel": "Login", "epic": ep["id"], "sprint": s["id"]})
    unter = projekt.eintrag_anlegen({"typ": "unteraufgabe", "titel": "Formular", "eltern": story["id"]})
    assert unter["sprint"] == s["id"] and unter["epic"] == ep["id"]
    # Elternteil wandert ins Backlog -> Unteraufgabe folgt
    projekt.eintrag_aendern(story["id"], {"sprint": ""})
    daten = {e["id"]: e for e in projekt.laden()["eintraege"]}
    assert daten[unter["id"]]["sprint"] == ""
    with pytest.raises(Fehler):
        projekt.eintrag_aendern(ep["id"], {"typ": "story"})  # Epic mit Einträgen
    with pytest.raises(Fehler):
        projekt.eintrag_aendern(story["id"], {"typ": "unteraufgabe", "eltern": story["id"]})
    with pytest.raises(Fehler):
        projekt.eintrag_anlegen({"typ": "unteraufgabe", "titel": "x", "eltern": unter["id"]})
    with pytest.raises(Fehler):
        projekt.eintrag_loeschen(story["id"])  # hat Unteraufgaben


def test_loeschen_verschiebt_in_papierkorb_und_entfernt_verweise(projekt):
    ep = projekt.eintrag_anlegen({"typ": "epic", "titel": "Epic"})
    projekt.eintrag_anlegen({"titel": "Kind", "epic": ep["id"]})
    projekt.eintrag_loeschen(ep["id"])
    assert (projekt.pfad / ".papierkorb" / "TB-1-epic.md").is_file()
    daten = projekt.laden()
    assert [e["id"] for e in daten["eintraege"]] == ["TB-2"]
    assert daten["eintraege"][0]["epic"] == ""


def test_reihenfolge_und_board(projekt):
    s = projekt.sprint_anlegen({"name": "Sprint 1"})
    for t in ("A", "B", "C"):
        projekt.eintrag_anlegen({"titel": t})
    projekt.reihenfolge(s["id"], ["TB-3", "TB-1"], {"TB-1": "review"})
    daten = {e["id"]: e for e in projekt.laden()["eintraege"]}
    assert daten["TB-3"]["sprint"] == s["id"] and daten["TB-3"]["rang"] == 1000
    assert daten["TB-1"]["rang"] == 2000 and daten["TB-1"]["status"] == "review"
    assert daten["TB-2"]["sprint"] == ""
    with pytest.raises(Fehler):
        projekt.reihenfolge("", ["TB-1", "TB-1"])
    with pytest.raises(Fehler):
        projekt.reihenfolge("", ["TB-9"])


def test_sprint_ablauf(projekt):
    s1 = projekt.sprint_anlegen({"name": "Sprint 1", "ziel": "Login fertig"})
    s2 = projekt.sprint_anlegen({})
    assert (s1["id"], s2["id"], s2["name"]) == ("sprint-01", "sprint-02", "Sprint 2")
    a = projekt.eintrag_anlegen({"titel": "Erledigt", "sprint": s1["id"]})
    b = projekt.eintrag_anlegen({"titel": "Offen", "sprint": s1["id"]})
    projekt.eintrag_aendern(a["id"], {"status": "erledigt"})

    gestartet = projekt.sprint_starten(s1["id"], {"start": "2026-11-02"})
    assert gestartet["status"] == "aktiv"
    assert gestartet["ende"] == (dt.date(2026, 11, 2) + dt.timedelta(days=14)).isoformat()
    with pytest.raises(Fehler):
        projekt.sprint_starten(s2["id"], {})  # nur einer gleichzeitig
    with pytest.raises(Fehler):
        projekt.sprint_loeschen(s1["id"])

    erg = projekt.sprint_abschliessen(s1["id"], s2["id"])
    assert erg["verschoben"] == [b["id"]]
    daten = {e["id"]: e for e in projekt.laden()["eintraege"]}
    assert daten[a["id"]]["sprint"] == s1["id"]  # Erledigtes bleibt im alten Sprint
    assert daten[b["id"]]["sprint"] == s2["id"]
    assert projekt.laden()["sprints"][0]["status"] == "abgeschlossen"

    projekt.sprint_loeschen(s2["id"])
    daten = {e["id"]: e for e in projekt.laden()["eintraege"]}
    assert daten[b["id"]]["sprint"] == ""


def test_kaputte_dateien_landen_in_problemen(projekt):
    projekt.eintrag_anlegen({"titel": "Gut"})
    (projekt.eintraege_ordner / "kaputt.md").write_text("kein frontmatter", encoding="utf-8")
    (projekt.eintraege_ordner / "TB-1-doppelt.md").write_text("---\nid: TB-1\n---\n", encoding="utf-8")
    (projekt.eintraege_ordner / "TB-5-status.md").write_text("---\nstatus: fertig\n---\n", encoding="utf-8")
    daten = projekt.laden()
    assert sorted(e["id"] for e in daten["eintraege"]) == ["TB-1", "TB-5"]
    meldungen = " | ".join(p["meldung"] for p in daten["probleme"])
    assert "Frontmatter" in meldungen
    assert "gibt es schon" in meldungen
    assert "unbekannter Wert „fertig“" in meldungen


def test_stand_aendert_sich_bei_dateiaenderung(projekt):
    vorher = projekt.stand()
    projekt.eintrag_anlegen({"titel": "Neu"})
    assert projekt.stand() != vorher


def test_projekt_einstellungen(projekt):
    einst = projekt.projekt_aendern({"name": "Neu", "sprint_dauer_tage": 7,
                                     "hervorhebungen": [{"farbe": "#112233", "name": "Kunde"}]})
    assert einst["name"] == "Neu"
    assert einst["sprint_dauer_tage"] == 7
    assert einst["hervorhebungen"] == [{"farbe": "#112233", "name": "Kunde"}]
    with pytest.raises(Fehler):
        projekt.projekt_aendern({"kuerzel": "XX"})
