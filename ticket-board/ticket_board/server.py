"""Kleiner HTTP-Server: liefert die Oberfläche aus und stellt eine JSON-API bereit.

Sicherheit (der Server darf Dateien schreiben):
- lauscht nur auf 127.0.0.1,
- akzeptiert nur Anfragen mit Host ``127.0.0.1:<port>`` bzw. ``localhost:<port>``
  (Schutz vor DNS-Rebinding),
- ändernde Anfragen brauchen den Kopf ``X-Ticket-Board: 1`` und JSON. Fremde
  Webseiten können diesen Kopf nicht ohne CORS-Freigabe setzen, und die gibt es nicht.
"""

from __future__ import annotations

import json
import mimetypes
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlsplit

from . import __version__
from .git_abgleich import GitAbgleich, projekt_klonen
from .speicher import Arbeitsbereich, Fehler

STATIC = Path(__file__).resolve().parent / "static"
MAX_ANFRAGE = 2 * 1024 * 1024


class TicketServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, adresse: tuple[str, int], arbeitsbereich: Arbeitsbereich) -> None:
        super().__init__(adresse, Handler)
        self.arbeitsbereich = arbeitsbereich

    @property
    def port(self) -> int:
        return self.server_address[1]

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/"

    def handle_error(self, request: Any, client_address: Any) -> None:
        # Browser hat die Verbindung geschlossen (Tab zu, Neuladen) – kein Grund für einen Stacktrace
        import sys
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)

    def beenden_spaeter(self) -> None:
        threading.Thread(target=self.shutdown, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    server: TicketServer
    server_version = f"TicketBoard/{__version__}"
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - leise
        pass

    # -- Antworten -------------------------------------------------------------
    def _senden(self, status: int, inhalt: bytes, typ: str, kopf: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(inhalt)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (kopf or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(inhalt)

    def _json(self, daten: Any, status: int = 200) -> None:
        inhalt = json.dumps(daten, ensure_ascii=False).encode("utf-8")
        self._senden(status, inhalt, "application/json; charset=utf-8")

    def _fehler(self, meldung: str, status: int, daten: Any = None) -> None:
        antwort: dict[str, Any] = {"fehler": meldung}
        if daten is not None:
            antwort["aktuell"] = daten
        self._json(antwort, status)

    # -- Prüfungen -------------------------------------------------------------
    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        erlaubt = {f"127.0.0.1:{self.server.port}", f"localhost:{self.server.port}"}
        return host in erlaubt

    def _aendernd_ok(self) -> bool:
        if self.headers.get("X-Ticket-Board") != "1":
            return False
        herkunft = self.headers.get("Origin")
        if herkunft and herkunft.lower().rstrip("/") not in {
            f"http://127.0.0.1:{self.server.port}", f"http://localhost:{self.server.port}"
        }:
            return False
        return True

    def _koerper(self) -> dict[str, Any]:
        laenge = int(self.headers.get("Content-Length") or 0)
        if laenge > MAX_ANFRAGE:
            raise Fehler("Anfrage zu groß", 413)
        if laenge == 0:
            return {}
        typ = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if typ != "application/json":
            raise Fehler("JSON erwartet", 415)
        try:
            daten = json.loads(self.rfile.read(laenge).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise Fehler("Ungültiges JSON") from None
        if not isinstance(daten, dict):
            raise Fehler("JSON-Objekt erwartet")
        return daten

    # -- Verteilung ------------------------------------------------------------
    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        self._verarbeiten("GET")

    def do_POST(self) -> None:
        self._verarbeiten("POST")

    def do_PUT(self) -> None:
        self._verarbeiten("PUT")

    def do_DELETE(self) -> None:
        self._verarbeiten("DELETE")

    def _verarbeiten(self, methode: str) -> None:
        if not self._host_ok():
            self._fehler("Unbekannter Host", HTTPStatus.FORBIDDEN)
            return
        url = urlsplit(self.path)
        teile = [unquote(t) for t in url.path.split("/") if t]
        try:
            if not teile or teile[0] != "api":
                if methode != "GET":
                    raise Fehler("Nicht erlaubt", 405)
                self._statisch(url.path)
                return
            if methode != "GET" and not self._aendernd_ok():
                raise Fehler("Anfrage abgelehnt", 403)
            koerper = self._koerper() if methode in ("POST", "PUT") else {}
            self._api(methode, teile[1:], koerper, parse_qs(url.query))
        except Fehler as f:
            self._fehler(f.meldung, f.status, f.daten)
        except Exception as f:  # noqa: BLE001 - Meldung an die Oberfläche
            self._fehler(f"Interner Fehler: {f}", 500)

    def _statisch(self, pfad: str) -> None:
        if pfad in ("", "/"):
            pfad = "/index.html"
        name = pfad.lstrip("/")
        ziel = (STATIC / name).resolve()
        if STATIC not in ziel.parents or not ziel.is_file():
            raise Fehler("Nicht gefunden", 404)
        typ = mimetypes.guess_type(ziel.name)[0] or "application/octet-stream"
        if typ.startswith("text/") or typ in ("application/javascript", "image/svg+xml"):
            typ += "; charset=utf-8"
        self._senden(200, ziel.read_bytes(), typ, {
            "Content-Security-Policy":
                "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        })

    def _api(self, methode: str, teile: list[str], k: dict[str, Any], query: dict[str, list[str]]) -> None:
        ab = self.server.arbeitsbereich
        weg = (methode, *teile)

        if weg == ("GET", "info"):
            self._json({
                "app": "ticket-board",
                "version": __version__,
                "arbeitsbereich": str(ab.pfad),
                "einzelprojekt": ab.einzelprojekt,
                "projekte": ab.uebersicht(),
            })
            return
        if weg == ("POST", "projekte"):
            self._json(ab.projekt_anlegen(k.get("name", ""), k.get("kuerzel", "")), 201)
            return
        if weg == ("POST", "projekte", "klonen"):
            if ab.einzelprojekt:
                raise Fehler("Hier ist ein einzelnes Projekt geöffnet – zum Holen weiterer Projekte "
                             "die App mit einem Arbeitsbereich-Ordner starten.")
            name = projekt_klonen(ab.pfad, str(k.get("url") or ""), str(k.get("name") or ""))
            p = ab.projekt(name)
            e = p.einstellungen()
            self._json({"id": p.id, "name": e["name"], "kuerzel": e["kuerzel"]}, 201)
            return
        if weg == ("POST", "beenden"):
            self._json({"ok": True})
            self.server.beenden_spaeter()
            return

        if len(teile) < 2 or teile[0] != "p":
            raise Fehler("Unbekannter Pfad", 404)
        p = ab.projekt(teile[1])
        rest = (methode, *teile[2:])

        routen: dict[tuple, Callable[[], Any]] = {
            ("GET",): p.laden,
            ("GET", "stand"): lambda: {"stand": p.stand()},
            ("PUT", "projekt"): lambda: p.projekt_aendern(k),
            ("POST", "eintraege"): lambda: p.eintrag_anlegen(k),
            ("POST", "reihenfolge"): lambda: (p.reihenfolge(
                k.get("sprint"), list(k.get("ids") or []), dict(k.get("status") or {})) or p.laden()),
            ("POST", "sprints"): lambda: p.sprint_anlegen(k),
            ("GET", "git"): lambda: GitAbgleich(p).status(),
            ("POST", "git", "abgleichen"): lambda: GitAbgleich(p).abgleichen(),
            ("POST", "git", "einrichten"): lambda: GitAbgleich(p).einrichten(str(k.get("url") or "")),
            ("POST", "git", "loesen"): lambda: GitAbgleich(p).loesen(k.get("datei"), str(k.get("wahl") or "")),
            ("POST", "git", "abbrechen"): lambda: GitAbgleich(p).abbrechen(),
        }
        if rest in routen:
            self._json(routen[rest](), 201 if methode == "POST" and rest[-1] in ("eintraege", "sprints") else 200)
            return

        if len(rest) == 3 and rest[1] == "eintraege":
            eid = rest[2]
            if methode == "PUT":
                basis = k.pop("basis", None)
                self._json(p.eintrag_aendern(eid, k, basis))
                return
            if methode == "DELETE":
                p.eintrag_loeschen(eid)
                self._json({"ok": True})
                return
        if len(rest) >= 3 and rest[1] == "sprints":
            sid = rest[2]
            if methode == "PUT" and len(rest) == 3:
                self._json(p.sprint_aendern(sid, k))
                return
            if methode == "DELETE" and len(rest) == 3:
                p.sprint_loeschen(sid)
                self._json({"ok": True})
                return
            if methode == "POST" and rest[3:] == ("starten",):
                self._json(p.sprint_starten(sid, k))
                return
            if methode == "POST" and rest[3:] == ("abschliessen",):
                self._json(p.sprint_abschliessen(sid, str(k.get("ziel") or "")))
                return
        raise Fehler("Unbekannter Pfad", 404)


def server_erstellen(arbeitsbereich: Arbeitsbereich, port: int = 0) -> TicketServer:
    return TicketServer(("127.0.0.1", port), arbeitsbereich)
