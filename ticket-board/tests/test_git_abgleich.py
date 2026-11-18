"""Git-Abgleich mit echtem Git: zwei „Geräte“ (A und B) und ein gemeinsamer Server (bare repo)."""

import subprocess

import pytest

from ticket_board.frontmatter import Dokument
from ticket_board.git_abgleich import GitAbgleich, dreiwege, git_verfuegbar, projekt_klonen, url_pruefen
from ticket_board.speicher import Arbeitsbereich, Fehler

pytestmark = pytest.mark.skipif(not git_verfuegbar(), reason="git nicht installiert")


@pytest.fixture(autouse=True)
def git_umgebung(monkeypatch, tmp_path):
    leer = tmp_path / "gitconfig"
    leer.write_text("")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(leer))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for art in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{art}_NAME", "Test")
        monkeypatch.setenv(f"GIT_{art}_EMAIL", "test@example.com")


def sh(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def server(tmp_path):
    pfad = tmp_path / "server.git"
    sh("init", "-q", "--bare", "-b", "main", str(pfad), cwd=tmp_path)
    return pfad


@pytest.fixture
def geraete(tmp_path, server):
    """Gerät A legt das Projekt an und richtet den Abgleich ein, Gerät B holt es."""
    ab_a = Arbeitsbereich(tmp_path / "a")
    a = ab_a.projekt(ab_a.projekt_anlegen("Webshop", "WS")["id"])
    a.eintrag_anlegen({"titel": "Erstes Ticket"})
    GitAbgleich(a).einrichten(str(server))
    ab_b = Arbeitsbereich(tmp_path / "b")
    name = projekt_klonen(ab_b.pfad, str(server), "Webshop")
    b = ab_b.projekt(name)
    return a, b


def test_status_ohne_repository(projekt):
    st = GitAbgleich(projekt).status()
    assert st["aktiv"] is False
    assert "kein" in st["grund"].lower()


def test_einrichten_nur_lokal(projekt):
    erg = GitAbgleich(projekt).einrichten("")
    st = erg["status"]
    assert st["aktiv"] and st["zweig"] == "main" and st["aenderungen"] == []
    assert "Ticket-Board" in sh("log", "--format=%s", cwd=projekt.pfad)
    projekt.eintrag_anlegen({"titel": "Neu"})
    assert GitAbgleich(projekt).status()["aenderungen"] == ["eintraege/TB-1-neu.md"]
    erg = GitAbgleich(projekt).abgleichen()
    assert any("Nur lokal" in s for s in erg["schritte"])
    assert "TB-1" in sh("log", "-1", "--format=%s", cwd=projekt.pfad)


def test_einrichten_und_holen(geraete, server):
    a, b = geraete
    assert [e["id"] for e in b.laden()["eintraege"]] == ["WS-1"]
    st = GitAbgleich(b).status()
    assert st["upstream"] == "origin/main" and st["vor"] == 0 and st["zurueck"] == 0


def test_aenderungen_wandern_in_beide_richtungen(geraete):
    a, b = geraete
    a.eintrag_anlegen({"titel": "Von A"})
    GitAbgleich(a).abgleichen()
    erg = GitAbgleich(b).abgleichen()
    assert "Neues vom Server geholt" in erg["schritte"]
    assert {e["titel"] for e in b.laden()["eintraege"]} == {"Erstes Ticket", "Von A"}
    b.eintrag_aendern("WS-2", {"status": "erledigt"})
    GitAbgleich(b).abgleichen()
    GitAbgleich(a).abgleichen()
    assert next(e for e in a.laden()["eintraege"] if e["id"] == "WS-2")["status"] == "erledigt"


def test_verschiedene_felder_werden_automatisch_zusammengefuehrt(geraete):
    a, b = geraete
    a.eintrag_aendern("WS-1", {"status": "in-arbeit", "text": "Zeile 1\nZeile 2\nZeile 3\n"})
    GitAbgleich(a).abgleichen()
    GitAbgleich(b).abgleichen()
    a.eintrag_aendern("WS-1", {"status": "review", "text": "Zeile 1 von A\nZeile 2\nZeile 3\n"})
    b.eintrag_aendern("WS-1", {"version": "2.0", "text": "Zeile 1\nZeile 2\nZeile 3 von B\n"})
    # aktualisiert ändert sich auf beiden Seiten → wird ohne Rückfrage zusammengeführt
    GitAbgleich(a).abgleichen()
    erg = GitAbgleich(b).abgleichen()
    assert not erg["status"]["merge"], erg
    e = b.laden()["eintraege"][0]
    assert (e["status"], e["version"]) == ("review", "2.0")
    assert e["text"] == "Zeile 1 von A\nZeile 2\nZeile 3 von B\n"
    GitAbgleich(a).abgleichen()
    assert a.laden()["eintraege"][0]["version"] == "2.0"


def test_echter_konflikt_wird_nachgefragt(geraete):
    a, b = geraete
    a.eintrag_aendern("WS-1", {"titel": "Titel von A"})
    b.eintrag_aendern("WS-1", {"titel": "Titel von B", "prioritaet": "hoch"})
    GitAbgleich(a).abgleichen()
    erg = GitAbgleich(b).abgleichen()
    st = erg["status"]
    assert st["merge"] is True
    (k,) = st["konflikte"]
    assert k["id"] == "WS-1" and k["anzeige"].startswith("eintraege/WS-1-")
    assert k["felder"] == [{"feld": "titel", "meine": "Titel von B", "fremde": "Titel von A"}]
    # Solange offen: Datei bleibt ohne Konfliktmarker lesbar (vorläufig meine Fassung)
    assert b.laden()["eintraege"][0]["titel"] == "Titel von B"
    erg = GitAbgleich(b).loesen(k["datei"], "fremde")
    assert not erg["status"]["merge"]
    e = b.laden()["eintraege"][0]
    assert (e["titel"], e["prioritaet"]) == ("Titel von A", "hoch")  # nicht strittiges Feld bleibt
    GitAbgleich(a).abgleichen()
    assert a.laden()["eintraege"][0]["prioritaet"] == "hoch"


def test_abbrechen_stellt_eigene_fassung_wieder_her(geraete):
    a, b = geraete
    a.eintrag_aendern("WS-1", {"titel": "A"})
    b.eintrag_aendern("WS-1", {"titel": "B"})
    GitAbgleich(a).abgleichen()
    GitAbgleich(b).abgleichen()
    erg = GitAbgleich(b).abbrechen()
    assert not erg["status"]["merge"]
    assert b.laden()["eintraege"][0]["titel"] == "B"


def test_doppelte_id_wird_umnummeriert(geraete):
    a, b = geraete
    epic_b = b.eintrag_anlegen({"typ": "epic", "titel": "Epic von B"})          # WS-2 auf B
    kind_b = b.eintrag_anlegen({"titel": "Kind von B", "epic": epic_b["id"]})  # WS-3 auf B
    a.eintrag_anlegen({"titel": "Ticket von A"})                               # WS-2 auf A
    GitAbgleich(a).abgleichen()
    erg = GitAbgleich(b).abgleichen()
    assert any("WS-2 heißt jetzt" in s for s in erg["schritte"]), erg["schritte"]
    daten = b.laden()
    assert daten["probleme"] == []
    nach_titel = {e["titel"]: e for e in daten["eintraege"]}
    assert nach_titel["Ticket von A"]["id"] == "WS-2"
    neu = nach_titel["Epic von B"]["id"]
    assert neu not in ("WS-1", "WS-2", "WS-3")
    assert nach_titel["Kind von B"]["epic"] == neu  # Verweis mitgezogen
    assert kind_b["id"] == nach_titel["Kind von B"]["id"]
    GitAbgleich(a).abgleichen()
    assert {e["titel"] for e in a.laden()["eintraege"]} == set(nach_titel)


def test_nur_der_ticket_ordner_wird_committet(tmp_path, monkeypatch):
    repo = tmp_path / "code"
    repo.mkdir()
    sh("init", "-q", "-b", "main", cwd=repo)
    (repo / "main.py").write_text("print(1)\n")
    sh("add", "main.py", cwd=repo)
    sh("commit", "-q", "-m", "Code", cwd=repo)
    (repo / "main.py").write_text("print(2)\n")  # ungesicherte Code-Änderung
    ab = Arbeitsbereich(repo / "docs" / "tickets")
    p = ab.projekt(ab.projekt_anlegen("Tickets", "TK")["id"])
    p.eintrag_anlegen({"titel": "Im Code-Repo"})
    GitAbgleich(p).abgleichen()
    geaendert = sh("show", "--name-only", "--format=", "HEAD", cwd=repo).split()
    assert geaendert and all(d.startswith("docs/tickets/Tickets/") for d in geaendert)
    assert sh("status", "--porcelain", "--", "main.py", cwd=repo).strip() == "M main.py"


def test_projekt_klonen_prueft_inhalt(tmp_path, server):
    with pytest.raises(Fehler):
        projekt_klonen(tmp_path / "ws", str(server), "Leer")  # leeres Repo ohne projekt.md
    assert not (tmp_path / "ws" / "Leer").exists()


@pytest.mark.parametrize("url", ["-u evil", "ext::sh -c touch", "einfach text", ""])
def test_ungueltige_adressen(url):
    with pytest.raises(Fehler):
        url_pruefen(url)


@pytest.mark.parametrize("url", ["https://github.com/a/b.git", "git@github.com:a/b.git", "/srv/git/t.git",
                                 "D:\\Sync\\t.git", "ssh://host/t.git", "../t.git"])
def test_gueltige_adressen(url):
    assert url_pruefen(url) == url


def test_dreiwege_regeln():
    basis = Dokument({"id": "X-1", "titel": "T", "rang": 1000, "aktualisiert": "2026-01-01"}, "Text\n").als_text()
    meine = Dokument({"id": "X-1", "titel": "T", "rang": 3000, "aktualisiert": "2026-01-05"}, "Text\n").als_text()
    fremde = Dokument({"id": "X-1", "titel": "T2", "rang": 2000, "aktualisiert": "2026-01-03"}, "Text\n").als_text()
    inhalt, konflikte = dreiwege(basis, meine, fremde)
    assert konflikte == []
    dok = Dokument.lesen(inhalt)
    assert (dok.get("titel"), dok.get("rang"), dok.get("aktualisiert")) == ("T2", "3000", "2026-01-05")
    # gelöscht auf einer Seite, unverändert auf der anderen → gelöscht
    assert dreiwege(basis, None, basis) == (None, [])
    # gelöscht gegen geändert → Rückfrage
    inhalt, konflikte = dreiwege(basis, None, fremde)
    assert konflikte and dreiwege(basis, None, fremde, "fremde") == (fremde, [])


def test_benachbarte_felder_git_konflikt_wird_aufgeloest(geraete):
    """status und prioritaet stehen direkt untereinander – Git selbst meldet hier einen
    Konflikt, der feldweise Abgleich löst ihn ohne Rückfrage."""
    a, b = geraete
    a.eintrag_aendern("WS-1", {"text": "eins\nzwei\ndrei\nvier\n"})
    GitAbgleich(a).abgleichen()
    GitAbgleich(b).abgleichen()
    a.eintrag_aendern("WS-1", {"status": "review", "text": "EINS\nzwei\ndrei\nvier\n"})
    b.eintrag_aendern("WS-1", {"prioritaet": "kritisch", "text": "eins\nzwei\ndrei\nVIER\n"})
    GitAbgleich(a).abgleichen()
    erg = GitAbgleich(b).abgleichen()
    assert "1 Datei(en) automatisch zusammengeführt" in erg["schritte"], erg["schritte"]
    e = b.laden()["eintraege"][0]
    assert (e["status"], e["prioritaet"], e["text"]) == ("review", "kritisch", "EINS\nzwei\ndrei\nVIER\n")
    assert "<<<<<<<" not in (b.pfad / e["datei"]).read_text(encoding="utf-8")


def test_api(tmp_path, server):
    import json
    import threading
    import urllib.request

    from ticket_board.server import server_erstellen

    ab = Arbeitsbereich(tmp_path / "ws")
    ab.projekt_anlegen("Webshop", "WS")
    srv = server_erstellen(ab, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    def post(pfad, daten=None):
        req = urllib.request.Request(srv.url + pfad.lstrip("/"), method="POST" if daten is not None else "GET",
                                     data=json.dumps(daten).encode() if daten is not None else None,
                                     headers={"X-Ticket-Board": "1", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())

    try:
        assert post("api/p/Webshop/git")["aktiv"] is False
        erg = post("api/p/Webshop/git/einrichten", {"url": str(server)})
        assert erg["status"]["upstream"] == "origin/main"
        assert (ab.pfad / "Webshop" / ".gitattributes").read_text() == "*.md text eol=lf\n"
        ab.projekt("Webshop").eintrag_anlegen({"titel": "Über die API"})
        erg = post("api/p/Webshop/git/abgleichen", {})
        assert "Übertragen" in erg["schritte"]
        neu = post("api/projekte/klonen", {"url": str(server), "name": "Kopie"})
        assert neu == {"id": "Kopie", "name": "Webshop", "kuerzel": "WS"}
        assert [e["titel"] for e in ab.projekt("Kopie").laden()["eintraege"]] == ["Über die API"]
    finally:
        srv.shutdown()
        srv.server_close()
