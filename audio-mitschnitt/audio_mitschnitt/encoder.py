"""MP3-Kodierung mit LAME (über das Paket ``lameenc``)."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np

ERLAUBTE_BITRATEN = (96, 128, 160, 192, 256, 320)


def float_zu_int16(daten: np.ndarray) -> np.ndarray:
    """Wandelt Float-Samples (-1.0 … 1.0) in 16-Bit-PCM um, mit Begrenzung."""
    begrenzt = np.clip(np.asarray(daten, dtype=np.float32), -1.0, 1.0)
    return np.round(begrenzt * 32767.0).astype(np.int16)


def auf_kanaele_bringen(daten: np.ndarray, kanaele: int) -> np.ndarray:
    """Bringt einen Block (Frames × Kanäle) auf genau ``kanaele`` Kanäle.

    Mono wird verdoppelt, überzählige Kanäle (z. B. 5.1) werden auf die
    ersten Kanäle reduziert.
    """
    daten = np.asarray(daten, dtype=np.float32)
    if daten.ndim == 1:
        daten = daten[:, np.newaxis]
    vorhanden = daten.shape[1]
    if vorhanden == kanaele:
        return daten
    if vorhanden == 1:
        return np.repeat(daten, kanaele, axis=1)
    if vorhanden > kanaele:
        return daten[:, :kanaele]
    # weniger Kanäle als gewünscht (aber mehr als einer): letzten Kanal auffüllen
    fehlend = np.repeat(daten[:, -1:], kanaele - vorhanden, axis=1)
    return np.concatenate([daten, fehlend], axis=1)


class Mp3Schreiber:
    """Schreibt Float-Audioblöcke fortlaufend als MP3-Datei.

    Die Datei wird direkt unter ihrem endgültigen Namen geschrieben und
    regelmäßig auf die Platte gebracht. MP3 ist ein Datenstrom aus
    unabhängigen Frames – auch nach einem Absturz bleibt das bis dahin
    Aufgenommene abspielbar.
    """

    def __init__(self, pfad: Path | str, samplerate: int = 48000, kanaele: int = 2,
                 bitrate: int = 192, qualitaet: int = 2):
        import lameenc  # erst hier, damit Hilfsfunktionen ohne LAME testbar bleiben

        if bitrate not in ERLAUBTE_BITRATEN:
            raise ValueError(f"Bitrate {bitrate} kbit/s nicht unterstützt")
        if kanaele not in (1, 2):
            raise ValueError("MP3 unterstützt nur 1 oder 2 Kanäle")

        self.pfad = Path(pfad)
        self.samplerate = samplerate
        self.kanaele = kanaele
        self.bitrate = bitrate
        self.frames = 0
        self.bytes_geschrieben = 0

        self._encoder = lameenc.Encoder()
        self._encoder.set_bit_rate(bitrate)
        self._encoder.set_in_sample_rate(samplerate)
        self._encoder.set_channels(kanaele)
        self._encoder.set_quality(qualitaet)  # 2 = hohe Qualität, 7 = schnell

        self.pfad.parent.mkdir(parents=True, exist_ok=True)
        self._datei = open(self.pfad, "wb")
        self._geschlossen = False

    @property
    def dauer_sekunden(self) -> float:
        return self.frames / self.samplerate

    def schreiben(self, block: np.ndarray) -> None:
        """Hängt einen Block (Frames × Kanäle, float32) an."""
        if self._geschlossen:
            raise RuntimeError("Datei ist bereits geschlossen")
        block = auf_kanaele_bringen(block, self.kanaele)
        if block.shape[0] == 0:
            return
        pcm = float_zu_int16(block)
        mp3 = self._encoder.encode(pcm.tobytes())
        if mp3:
            self._datei.write(mp3)
            self.bytes_geschrieben += len(mp3)
        self.frames += block.shape[0]

    def auf_platte(self) -> None:
        """Schreibt gepufferte Daten auf den Datenträger."""
        if not self._geschlossen:
            self._datei.flush()
            try:
                os.fsync(self._datei.fileno())
            except OSError:
                pass

    def schliessen(self) -> None:
        if self._geschlossen:
            return
        try:
            # LAME wirft einen Fehler, wenn noch nie etwas kodiert wurde
            rest = self._encoder.flush() if self.frames else b""
            if rest:
                self._datei.write(rest)
                self.bytes_geschrieben += len(rest)
        finally:
            self._datei.close()
            self._geschlossen = True

    def __enter__(self) -> "Mp3Schreiber":
        return self

    def __exit__(self, *exc) -> None:
        self.schliessen()
