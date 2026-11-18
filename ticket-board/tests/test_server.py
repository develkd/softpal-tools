import json
import threading
import urllib.error
import urllib.request

import pytest

from ticket_board.server import server_erstellen


@pytest.fixture
def server(arbeitsbereich):
    arbeitsbereich.pfad.mkdir(parents=True)
    srv = server_erstellen(arbeitsbereich, 0)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv
    srv.shutdown()
    srv.server_close()


def anfrage(server, methode, pfad, daten=None, kopf=None, host=None):
    kopf = {"X-Ticket-Board": "1", **(kopf or {})}
    body = None
    if daten is not None:
        body = json.dumps(daten).encode()
        kopf.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(f"{server.url.rstrip('/')}{pfad}", data=body, method=methode, headers=kopf)
    if host:
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as f:
        return f.code, f.headers, f.read()


def j(antwort):
    return json.loads(antwort[2].decode())


def test_oberflaeche_wird_ausgeliefert(server):
    status, kopf, inhalt = anfrage(server, "GET", "/")
    assert status == 200
    assert "Ticket-Board" in inhalt.decode()
    assert "default-src 'self'" in kopf["Content-Security-Policy"]
    for datei in ("/app.js", "/app.css", "/markdown.js", "/icon.svg"):
        assert anfrage(server, "GET", datei)[0] == 200
    assert anfrage(server, "GET", "/../speicher.py")[0] == 404
    assert anfrage(server, "GET", "/%2e%2e/speicher.py")[0] == 404


def test_ablauf_ueber_api(server):
    assert j(anfrage(server, "GET", "/api/info"))["projekte"] == []
    status, _, inhalt = anfrage(server, "POST", "/api/projekte", {"name": "Mein Projekt", "kuerzel": "mp"})
    assert status == 201 and json.loads(inhalt)["kuerzel"] == "MP"
    p = "/api/p/Mein%20Projekt"
    assert anfrage(server, "POST", f"{p}/sprints", {"name": "S1"})[0] == 201
    e = j(anfrage(server, "POST", f"{p}/eintraege", {"titel": "Hallo", "typ": "story"}))
    assert e["id"] == "MP-1"
    status, _, inhalt = anfrage(server, "PUT", f"{p}/eintraege/MP-1", {"status": "review", "basis": "falsch"})
    assert status == 409 and json.loads(inhalt)["aktuell"]["id"] == "MP-1"
    assert j(anfrage(server, "PUT", f"{p}/eintraege/MP-1", {"status": "review", "basis": e["basis"]}))["status"] == "review"
    assert anfrage(server, "POST", f"{p}/reihenfolge", {"sprint": "sprint-01", "ids": ["MP-1"]})[0] == 200
    assert anfrage(server, "POST", f"{p}/sprints/sprint-01/starten", {})[0] == 200
    daten = j(anfrage(server, "GET", p))
    assert daten["eintraege"][0]["sprint"] == "sprint-01"
    assert daten["sprints"][0]["status"] == "aktiv"
    assert j(anfrage(server, "GET", f"{p}/stand"))["stand"] == daten["stand"]
    assert anfrage(server, "POST", f"{p}/sprints/sprint-01/abschliessen", {"ziel": ""})[0] == 200
    assert anfrage(server, "DELETE", f"{p}/eintraege/MP-1")[0] == 200
    assert j(anfrage(server, "GET", p))["eintraege"] == []


def test_fehlermeldungen(server):
    anfrage(server, "POST", "/api/projekte", {"name": "P"})
    status, _, inhalt = anfrage(server, "POST", "/api/p/P/eintraege", {"titel": ""})
    assert status == 400 and "Titel" in json.loads(inhalt)["fehler"]
    assert anfrage(server, "GET", "/api/p/Gibtsnicht")[0] == 404
    assert anfrage(server, "GET", "/api/p/..%2F..")[0] == 404
    assert anfrage(server, "PUT", "/api/p/P/eintraege/P-99", {"titel": "x"})[0] == 404


def test_schutz_gegen_fremde_seiten(server):
    # ohne eigenen Kopf (wie bei einem Formular einer fremden Webseite)
    assert anfrage(server, "POST", "/api/projekte", {"name": "X"}, kopf={"X-Ticket-Board": ""})[0] == 403
    # fremde Herkunft
    assert anfrage(server, "POST", "/api/projekte", {"name": "X"}, kopf={"Origin": "https://boese.example"})[0] == 403
    # falscher Host (DNS-Rebinding)
    assert anfrage(server, "GET", "/api/info", host="boese.example:1234")[0] == 403
    # kein JSON
    assert anfrage(server, "POST", "/api/projekte", {"name": "X"}, kopf={"Content-Type": "text/plain"})[0] == 415
    assert j(anfrage(server, "GET", "/api/info"))["projekte"] == []
