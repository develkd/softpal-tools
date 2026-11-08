"""Einstieg: ``python -m audio_mitschnitt`` (Fenster) bzw. ``… --cli`` (Konsole)."""

from __future__ import annotations

import sys

from .cli import ausfuehren, parser_erstellen


def main(argv: list[str] | None = None) -> int:
    args = parser_erstellen().parse_args(argv)
    if args.cli or args.geraete:
        return ausfuehren(args)
    try:
        from .gui import starten
    except ImportError as fehler:  # z. B. Linux ohne python3-tk
        print(f"Fensteroberfläche nicht verfügbar ({fehler}) – nutze die Konsole.",
              file=sys.stderr)
        return ausfuehren(args)
    return starten()


if __name__ == "__main__":
    sys.exit(main())
