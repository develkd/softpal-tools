"""Zugriff auf die eingestellte Soundausgabe als Aufnahmequelle (Loopback).

* Windows: WASAPI-Loopback der Standard-Wiedergabe
* Linux:   PulseAudio-/PipeWire-„Monitor“ der Standard-Ausgabe
* macOS:   bietet kein Loopback – dafür muss ein virtuelles Gerät wie
           BlackHole installiert und als Ausgabe eingestellt sein.
"""

from __future__ import annotations

import sys
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator, Protocol

import numpy as np


@dataclass(frozen=True)
class Geraet:
    id: str
    name: str


class Aufnahmestrom(Protocol):
    def record(self, numframes: int) -> np.ndarray: ...


class Quelle(Protocol):
    """Schnittstelle, die der Recorder benutzt (in Tests durch Attrappen ersetzt)."""

    def standardausgabe(self) -> Geraet: ...

    def oeffnen(self, geraet: Geraet, samplerate: int, kanaele: int,
                blockgroesse: int): ...  # Kontextmanager -> Aufnahmestrom


class SoundcardQuelle:
    """Echte Quelle auf Basis des Pakets ``soundcard``."""

    def __init__(self) -> None:
        import soundcard  # noqa: F401 – Importfehler früh und verständlich melden
        self._sc = soundcard

    def standardausgabe(self) -> Geraet:
        lautsprecher = self._sc.default_speaker()
        if lautsprecher is None:
            raise RuntimeError("Es ist keine Soundausgabe eingestellt.")
        return Geraet(id=str(lautsprecher.id), name=str(lautsprecher.name))

    def alle_ausgaben(self) -> list[Geraet]:
        return [Geraet(id=str(s.id), name=str(s.name)) for s in self._sc.all_speakers()]

    def _loopback_zu(self, geraet: Geraet):
        """Sucht die Loopback-Aufnahmequelle genau dieser Ausgabe.

        Windows: Loopback hat dieselbe ID wie der Lautsprecher.
        PulseAudio/PipeWire: Monitor-Quelle heißt ``<ausgabe>.monitor``.
        Bewusst ohne die unscharfe Namenssuche von ``soundcard``, damit nie
        versehentlich ein Mikrofon aufgenommen wird.
        """
        gesucht = (geraet.id, f"{geraet.id}.monitor")
        quellen = {str(m.id): m for m in self._sc.all_microphones(include_loopback=True)}
        for kandidat in gesucht:
            if kandidat in quellen:
                return quellen[kandidat]
        raise RuntimeError(f"Für „{geraet.name}“ gibt es keine Loopback-Aufnahme. "
                           "Unter macOS wird dafür ein virtuelles Gerät wie "
                           "BlackHole benötigt.")

    @contextmanager
    def oeffnen(self, geraet: Geraet, samplerate: int, kanaele: int,
                blockgroesse: int) -> Iterator[Aufnahmestrom]:
        loopback = self._loopback_zu(geraet)
        with loopback.recorder(samplerate=samplerate, channels=kanaele,
                               blocksize=blockgroesse) as strom:
            yield strom


@contextmanager
def com_fuer_thread() -> Iterator[None]:
    """Initialisiert COM im aktuellen Thread (nur Windows, sonst nichts).

    ``soundcard`` initialisiert COM nur im importierenden Thread. Die
    Aufnahme läuft in einem eigenen Thread und braucht deshalb eine eigene
    Initialisierung.
    """
    if sys.platform != "win32":
        yield
        return
    import ctypes

    ole32 = ctypes.windll.ole32
    coinit_multithreaded = 0x0
    hr = ole32.CoInitializeEx(None, coinit_multithreaded)
    # S_OK (0) oder S_FALSE (1): wir müssen wieder freigeben.
    # RPC_E_CHANGED_MODE (<0): bereits anders initialisiert, nicht freigeben.
    selbst_initialisiert = hr in (0, 1)
    try:
        yield
    finally:
        if selbst_initialisiert:
            ole32.CoUninitialize()
