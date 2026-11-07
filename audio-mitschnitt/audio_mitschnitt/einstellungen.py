"""Speichert die Einstellungen der Oberfläche als JSON im Benutzerprofil."""

from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from .encoder import ERLAUBTE_BITRATEN

APP_NAME = "AudioMitschnitt"


def konfig_ordner() -> Path:
    if sys.platform == "win32":
        basis = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
        return basis / APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    basis = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return basis / "audio-mitschnitt"


def standard_zielordner() -> Path:
    musik = Path.home() / "Music"
    if not musik.is_dir() and (Path.home() / "Musik").is_dir():
        musik = Path.home() / "Musik"
    return (musik if musik.is_dir() else Path.home()) / "Mitschnitte"


@dataclass
class Einstellungen:
    zielordner: str = ""
    bitrate: int = 192
    ausgabe_folgen: bool = True

    def __post_init__(self) -> None:
        if not self.zielordner:
            self.zielordner = str(standard_zielordner())
        if self.bitrate not in ERLAUBTE_BITRATEN:
            self.bitrate = 192
        self.ausgabe_folgen = bool(self.ausgabe_folgen)

    @classmethod
    def laden(cls, datei: Path | None = None) -> "Einstellungen":
        datei = datei or konfig_ordner() / "einstellungen.json"
        try:
            roh = json.loads(datei.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return cls()
        if not isinstance(roh, dict):
            return cls()
        bekannt = {f.name for f in fields(cls)}
        try:
            return cls(**{k: v for k, v in roh.items() if k in bekannt})
        except TypeError:
            return cls()

    def speichern(self, datei: Path | None = None) -> None:
        datei = datei or konfig_ordner() / "einstellungen.json"
        try:
            datei.parent.mkdir(parents=True, exist_ok=True)
            datei.write_text(json.dumps(asdict(self), indent=2, ensure_ascii=False),
                             encoding="utf-8")
        except OSError:
            pass  # Einstellungen sind Komfort – nie die Aufnahme deswegen stören
