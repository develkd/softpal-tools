"""Kommandozeilen-Variante: Aufnahme bis Strg+C oder für eine feste Dauer."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from .einstellungen import Einstellungen
from .encoder import ERLAUBTE_BITRATEN
from .recorder import Recorder


def zeit_text(sekunden: float) -> str:
    s = int(sekunden)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def groesse_text(anzahl_bytes: int) -> str:
    if anzahl_bytes < 1024 * 1024:
        return f"{anzahl_bytes / 1024:.0f} KB"
    return f"{anzahl_bytes / (1024 * 1024):.1f} MB"


def parser_erstellen() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="audio-mitschnitt",
        description="Schneidet alles, was auf der eingestellten Soundausgabe "
                    "ausgegeben wird, als MP3 mit.")
    p.add_argument("--cli", action="store_true",
                   help="ohne Fenster in der Konsole aufnehmen")
    p.add_argument("-o", "--ordner", type=Path, help="Zielordner für die MP3-Dateien")
    p.add_argument("-b", "--bitrate", type=int, choices=ERLAUBTE_BITRATEN,
                   help="MP3-Bitrate in kbit/s (Standard: 192)")
    p.add_argument("-d", "--dauer", type=float,
                   help="nach so vielen Sekunden automatisch beenden")
    p.add_argument("--nicht-folgen", action="store_true",
                   help="beim Wechsel der Standardausgabe NICHT mitwechseln")
    p.add_argument("--geraete", action="store_true",
                   help="verfügbare Soundausgaben auflisten und beenden")
    return p


def ausfuehren(args: argparse.Namespace) -> int:
    from .quelle import SoundcardQuelle

    einst = Einstellungen.laden()
    try:
        quelle = SoundcardQuelle()
    except Exception as fehler:  # noqa: BLE001
        print(f"Audio-System nicht verfügbar: {fehler}", file=sys.stderr)
        return 2

    if args.geraete:
        standard = quelle.standardausgabe()
        for g in quelle.alle_ausgaben():
            marker = "*" if g.id == standard.id else " "
            print(f" {marker} {g.name}")
        print("\n* = eingestellte Standardausgabe (wird aufgenommen)")
        return 0

    recorder = Recorder(
        quelle,
        ordner=args.ordner or Path(einst.zielordner),
        bitrate=args.bitrate or einst.bitrate,
        ausgabe_folgen=not args.nicht_folgen and einst.ausgabe_folgen,
    )
    pfad = recorder.starten()
    recorder.warten_bis_bereit()
    st = recorder.status()
    if st.fehler:
        print(f"Aufnahme fehlgeschlagen: {st.fehler}", file=sys.stderr)
        return 1
    print(f"Aufnahme von: {st.geraet}")
    print(f"Datei:        {pfad}")
    print("Beenden mit Strg+C" + (f" (oder nach {args.dauer:g} s)" if args.dauer else ""))

    start = time.monotonic()
    try:
        while recorder.laeuft:
            if args.dauer and time.monotonic() - start >= args.dauer:
                break
            time.sleep(0.25)
            st = recorder.status()
            for meldung in st.meldungen:
                print(f"\n{meldung}")
            pegel = "" if st.pegel_db == float("-inf") else f"{st.pegel_db:6.1f} dBFS"
            print(f"\r● {zeit_text(st.sekunden)}  {groesse_text(st.bytes):>9}  {pegel:<12}",
                  end="", flush=True)
    except KeyboardInterrupt:
        pass
    print()
    recorder.stoppen()
    st = recorder.status()
    if st.fehler:
        print(f"Fehler: {st.fehler}", file=sys.stderr)
    print(f"Gespeichert: {pfad} ({zeit_text(st.sekunden)}, {groesse_text(st.bytes)})")
    return 1 if st.fehler else 0
