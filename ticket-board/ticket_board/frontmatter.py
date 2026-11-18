"""Markdown-Dateien mit Frontmatter lesen und schreiben, ohne Zusatzpakete.

Unterstützt wird die Teilmenge von YAML, die das Ticket-Board selbst schreibt:

    ---
    titel: "Login: Umlaute"     # Zeichenkette, bei Bedarf in Anführungszeichen
    labels: [auth, "ui fehler"] # Liste in eckigen Klammern
    tags:                       # oder als Block-Liste
      - a
    rang: 1000
    ---
    Freier Markdown-Text …

Felder, die das Tool nicht kennt (auch verschachteltes YAML), bleiben beim
Speichern Zeichen für Zeichen erhalten. Bekannte Felder werden nur dann neu
geschrieben, wenn sich ihr Wert tatsächlich ändert.
"""

from __future__ import annotations

import json
import re
from typing import Any

__all__ = ["Dokument", "FrontmatterFehler", "wert_als_text"]


class FrontmatterFehler(ValueError):
    """Die Datei hat keinen lesbaren Frontmatter-Block."""


_SCHLUESSEL = re.compile(r"^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$")
_PLAIN = re.compile(r"^[A-Za-zÄÖÜäöüß_][\w\-. äöüÄÖÜß/]*$")
_DATUM = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RESERVIERT = {"true", "false", "yes", "no", "on", "off", "null", "y", "n"}


def _skalar_lesen(roh: str) -> Any:
    roh = roh.strip()
    if roh in ("", "~", "null", "Null", "NULL"):
        return None
    if roh.startswith('"') and roh.endswith('"') and len(roh) >= 2:
        try:
            return json.loads(roh)
        except ValueError:
            return roh[1:-1]
    if roh.startswith("'") and roh.endswith("'") and len(roh) >= 2:
        return roh[1:-1].replace("''", "'")
    return roh


def _liste_lesen(inhalt: str) -> list[Any]:
    teile: list[str] = []
    aktuell = ""
    zeichen: str | None = None
    i = 0
    while i < len(inhalt):
        c = inhalt[i]
        if zeichen:
            aktuell += c
            if c == "\\" and zeichen == '"' and i + 1 < len(inhalt):
                aktuell += inhalt[i + 1]
                i += 1
            elif c == zeichen:
                zeichen = None
        elif c in "\"'":
            zeichen = c
            aktuell += c
        elif c == ",":
            teile.append(aktuell)
            aktuell = ""
        else:
            aktuell += c
        i += 1
    teile.append(aktuell)
    werte = [_skalar_lesen(t) for t in teile if t.strip() != ""]
    return [w for w in werte if w is not None]


def _skalar_schreiben(wert: Any) -> str:
    if wert is None:
        return ""
    if isinstance(wert, bool):
        return "true" if wert else "false"
    if isinstance(wert, int):
        return str(wert)
    text = str(wert)
    if text == "":
        return '""'
    if _DATUM.match(text):
        return text
    if (
        _PLAIN.match(text)
        and text == text.strip()
        and text.lower() not in _RESERVIERT
        and "  " not in text
    ):
        return text
    return json.dumps(text, ensure_ascii=False)


def wert_als_text(wert: Any) -> str:
    """Wert so darstellen, wie er hinter ``schluessel:`` steht."""
    if isinstance(wert, (list, tuple)):
        return "[" + ", ".join(_skalar_schreiben(w) for w in wert) + "]"
    return _skalar_schreiben(wert)


class Dokument:
    """Eine Markdown-Datei: Frontmatter-Felder (geordnet) und Text."""

    def __init__(self, felder: dict[str, Any] | None = None, text: str = "") -> None:
        # Schlüssel -> Rohzeilen (erste Zeile "schluessel: wert", danach Folgezeilen)
        self._zeilen: dict[str, list[str]] = {}
        # Kommentare und Leerzeilen am Anfang des Blocks
        self._vorspann: list[str] = []
        self.text = text
        for schluessel, wert in (felder or {}).items():
            self.setzen(schluessel, wert)

    # -- Lesen ---------------------------------------------------------------
    @classmethod
    def lesen(cls, inhalt: str) -> "Dokument":
        inhalt = inhalt.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
        zeilen = inhalt.split("\n")
        if not zeilen or zeilen[0].rstrip() != "---":
            raise FrontmatterFehler("Datei beginnt nicht mit einem Frontmatter-Block (---)")
        ende = None
        for nr in range(1, len(zeilen)):
            if zeilen[nr].rstrip() in ("---", "..."):
                ende = nr
                break
        if ende is None:
            raise FrontmatterFehler("Frontmatter-Block wird nicht mit --- abgeschlossen")

        dok = cls()
        aktuell: str | None = None
        for zeile in zeilen[1:ende]:
            m = _SCHLUESSEL.match(zeile)
            if m and not zeile[:1].isspace():
                aktuell = m.group(1)
                if aktuell in dok._zeilen:
                    raise FrontmatterFehler(f"Feld „{aktuell}“ kommt doppelt vor")
                dok._zeilen[aktuell] = [zeile]
            elif aktuell is not None and (zeile[:1].isspace() or zeile.strip() == ""):
                dok._zeilen[aktuell].append(zeile)
            elif zeile.strip() == "" or zeile.lstrip().startswith("#"):
                if aktuell is None:
                    dok._vorspann.append(zeile)
                else:
                    dok._zeilen[aktuell].append(zeile)
            else:
                raise FrontmatterFehler(f"Zeile nicht lesbar: {zeile!r}")
        dok.text = "\n".join(zeilen[ende + 1:])
        return dok

    def __contains__(self, schluessel: str) -> bool:
        return schluessel in self._zeilen

    def schluessel(self) -> list[str]:
        return list(self._zeilen)

    def roh(self, schluessel: str) -> list[str] | None:
        """Rohzeilen eines Felds (für den zeilengenauen Vergleich beim Git-Abgleich)."""
        zeilen = self._zeilen.get(schluessel)
        return list(zeilen) if zeilen is not None else None

    def roh_setzen(self, schluessel: str, zeilen: list[str] | None) -> None:
        if zeilen is None:
            self._zeilen.pop(schluessel, None)
        else:
            self._zeilen[schluessel] = list(zeilen)

    def get(self, schluessel: str, standard: Any = None) -> Any:
        zeilen = self._zeilen.get(schluessel)
        if zeilen is None:
            return standard
        m = _SCHLUESSEL.match(zeilen[0])
        roh = (m.group(2) or "").strip() if m else ""
        if roh == "":
            eintraege = []
            for z in zeilen[1:]:
                s = z.strip()
                if s.startswith("- ") or s == "-":
                    eintraege.append(_skalar_lesen(s[1:]))
            eintraege = [e for e in eintraege if e is not None]
            if eintraege:
                return eintraege
            return standard
        if roh.startswith("[") and roh.endswith("]"):
            return _liste_lesen(roh[1:-1])
        wert = _skalar_lesen(roh)
        return standard if wert is None else wert

    # -- Schreiben -----------------------------------------------------------
    def setzen(self, schluessel: str, wert: Any) -> bool:
        """Feld setzen. Gibt ``True`` zurück, wenn sich etwas geändert hat."""
        if schluessel in self._zeilen and _gleich(self.get(schluessel), wert):
            return False
        text = wert_als_text(wert)
        neu = f"{schluessel}: {text}" if text else f"{schluessel}:"
        alt = self._zeilen.get(schluessel)
        # Nachfolgende Leer-/Kommentarzeilen gehören optisch zum nächsten Feld
        rest = []
        if alt:
            for z in reversed(alt[1:]):
                if z.strip() == "" or z.lstrip().startswith("#"):
                    rest.insert(0, z)
                else:
                    break
        self._zeilen[schluessel] = [neu, *rest]
        return True

    def entfernen(self, schluessel: str) -> bool:
        return self._zeilen.pop(schluessel, None) is not None

    def als_text(self) -> str:
        teile = ["---", *self._vorspann]
        for zeilen in self._zeilen.values():
            teile.extend(zeilen)
        teile.append("---")
        kopf = "\n".join(teile) + "\n"
        return kopf + self.text


def _normal(wert: Any) -> Any:
    if wert is None or wert == "" or wert == []:
        return None
    if isinstance(wert, (list, tuple)):
        return [str(w) for w in wert]
    return str(wert)


def _gleich(a: Any, b: Any) -> bool:
    return _normal(a) == _normal(b)
