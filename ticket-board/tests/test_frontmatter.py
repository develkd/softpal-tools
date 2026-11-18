import pytest

from ticket_board.frontmatter import Dokument, FrontmatterFehler, wert_als_text


def test_lesen_und_schreiben_unveraendert():
    roh = (
        "---\n"
        "# Kommentar oben\n"
        "id: TB-1\n"
        'titel: "Login: Umlaute ä"\n'
        "labels: [auth, \"ui, fehler\"]\n"
        "rang: 1000\n"
        "extra:\n"
        "  verschachtelt: ja\n"
        "  liste:\n"
        "    - a\n"
        "---\n"
        "## Text\n\nInhalt\n"
    )
    dok = Dokument.lesen(roh)
    assert dok.get("id") == "TB-1"
    assert dok.get("titel") == "Login: Umlaute ä"
    assert dok.get("labels") == ["auth", "ui, fehler"]
    assert dok.get("rang") == "1000"
    assert dok.text == "## Text\n\nInhalt\n"
    assert dok.als_text() == roh


def test_nur_geaenderte_felder_werden_neu_geschrieben():
    roh = "---\nid: TB-1\ntitel:   'Alt'\nunbekannt: {a: 1}\nstatus: offen\n---\nText\n"
    dok = Dokument.lesen(roh)
    assert dok.setzen("titel", "Alt") is False
    assert dok.setzen("status", "erledigt") is True
    neu = dok.als_text()
    assert "titel:   'Alt'" in neu
    assert "unbekannt: {a: 1}" in neu
    assert "status: erledigt" in neu


def test_block_liste_und_leere_werte():
    dok = Dokument.lesen("---\nlabels:\n  - eins\n  - \"zwei drei\"\nsprint:\nepic: ~\n---\n")
    assert dok.get("labels") == ["eins", "zwei drei"]
    assert dok.get("sprint") is None
    assert dok.get("epic", "") == ""


@pytest.mark.parametrize("wert, erwartet", [
    ("TB-12", "TB-12"),
    ("sprint-03", "sprint-03"),
    ("2026-11-18", "2026-11-18"),
    ("1.10", '"1.10"'),
    ("yes", '"yes"'),
    ("Frage?", '"Frage?"'),
    ("a: b", '"a: b"'),
    ("#dc2626", '"#dc2626"'),
    ("", '""'),
    (None, ""),
    (1000, "1000"),
    (["a", "b c", "1.0"], '[a, b c, "1.0"]'),
])
def test_werte_schreiben(wert, erwartet):
    assert wert_als_text(wert) == erwartet


def test_rundreise_mit_sonderzeichen():
    dok = Dokument({"titel": 'Sag "Hallo" – #1: ok?', "labels": ["x,y", "ä"]}, "")
    wieder = Dokument.lesen(dok.als_text())
    assert wieder.get("titel") == 'Sag "Hallo" – #1: ok?'
    assert wieder.get("labels") == ["x,y", "ä"]


def test_crlf_und_bom():
    dok = Dokument.lesen("﻿---\r\nid: TB-1\r\n---\r\nText\r\n")
    assert dok.get("id") == "TB-1"
    assert dok.text == "Text\n"


@pytest.mark.parametrize("roh", ["kein frontmatter", "---\nid: 1\n", "---\nid: 1\nid: 2\n---\n", "---\nunsinn\n---\n"])
def test_ungueltig(roh):
    with pytest.raises(FrontmatterFehler):
        Dokument.lesen(roh)
