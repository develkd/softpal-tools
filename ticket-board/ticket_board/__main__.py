"""Einstieg: ``python -m ticket_board [ORDNER]`` startet den Server und öffnet den Browser."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import webbrowser
from pathlib import Path

from . import __version__
from .server import server_erstellen
from .speicher import Arbeitsbereich

STANDARD_ORDNER = Path.home() / "Tickets"
STANDARD_PORT = 8765


def parser_erstellen() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="ticket_board",
        description="Ticket-Board: Epics, Stories, Aufgaben und Bugs als Markdown-Dateien.",
    )
    p.add_argument("ordner", nargs="?", default=str(STANDARD_ORDNER),
                   help=f"Arbeitsbereich mit Projektordnern oder ein einzelner Projektordner "
                        f"(Standard: {STANDARD_ORDNER})")
    p.add_argument("-p", "--port", type=int, default=STANDARD_PORT,
                   help=f"Port auf 127.0.0.1 (Standard: {STANDARD_PORT}, 0 = beliebig)")
    p.add_argument("--kein-browser", action="store_true", help="Browser nicht automatisch öffnen")
    p.add_argument("--version", action="version", version=f"ticket-board {__version__}")
    return p


def _laufende_instanz(port: int) -> dict | None:
    """Läuft auf dem Port schon ein Ticket-Board? Dann dessen Info zurückgeben."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/info", timeout=1) as antwort:
            info = json.loads(antwort.read().decode("utf-8"))
            return info if info.get("app") == "ticket-board" else None
    except (OSError, ValueError):
        return None


def main(argv: list[str] | None = None) -> int:
    args = parser_erstellen().parse_args(argv)
    arbeitsbereich = Arbeitsbereich(Path(args.ordner))
    arbeitsbereich.pfad.mkdir(parents=True, exist_ok=True)

    try:
        server = server_erstellen(arbeitsbereich, args.port)
    except OSError:
        info = _laufende_instanz(args.port)
        if info and Path(info.get("arbeitsbereich", "")) == arbeitsbereich.pfad:
            url = f"http://127.0.0.1:{args.port}/"
            print(f"Ticket-Board läuft bereits: {url}")
            if not args.kein_browser:
                webbrowser.open(url)
            return 0
        server = server_erstellen(arbeitsbereich, 0)

    print(f"Ticket-Board {__version__}")
    print(f"Ordner:  {arbeitsbereich.pfad}")
    print(f"Adresse: {server.url}")
    print("Beenden mit Strg+C oder in der App über ⋯ → Beenden.")
    if not args.kein_browser:
        webbrowser.open(server.url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
