"""Aufnahme-Thread: liest die Soundausgabe und schreibt sie als MP3."""

from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from .encoder import Mp3Schreiber
from .quelle import Geraet, Quelle, com_fuer_thread

SAMPLERATE = 48000
KANAELE = 2


def dateiname_fuer(zeitpunkt: datetime, praefix: str = "Mitschnitt") -> str:
    return f"{praefix}_{zeitpunkt:%Y-%m-%d_%H-%M-%S}.mp3"


def freier_pfad(ordner: Path, name: str) -> Path:
    """Liefert einen noch nicht vorhandenen Pfad (hängt bei Bedarf _2, _3 … an)."""
    pfad = ordner / name
    stamm, endung = pfad.stem, pfad.suffix
    n = 2
    while pfad.exists():
        pfad = ordner / f"{stamm}_{n}{endung}"
        n += 1
    return pfad


def pegel_dbfs(block: np.ndarray) -> float:
    """Spitzenpegel eines Blocks in dBFS (Stille = -inf)."""
    if block.size == 0:
        return float("-inf")
    spitze = float(np.max(np.abs(block)))
    if spitze <= 0.0:
        return float("-inf")
    return 20.0 * np.log10(min(spitze, 1.0))


@dataclass
class Status:
    laeuft: bool = False
    pausiert: bool = False
    pfad: Optional[Path] = None
    geraet: str = ""
    sekunden: float = 0.0
    bytes: int = 0
    pegel_db: float = float("-inf")
    fehler: Optional[str] = None
    geraetewechsel: int = 0
    meldungen: list[str] = field(default_factory=list)


class Recorder:
    """Nimmt alles auf, was auf der eingestellten Soundausgabe läuft.

    Wird während der Aufnahme in den Windows-/System-Einstellungen eine
    andere Standardausgabe gewählt, wechselt die Aufnahme automatisch mit
    (``ausgabe_folgen=True``); die MP3-Datei läuft dabei ohne Unterbrechung
    weiter.
    """

    def __init__(self, quelle: Quelle, ordner: Path | str, bitrate: int = 192,
                 ausgabe_folgen: bool = True, blockdauer: float = 0.1,
                 pruefintervall: float = 2.0, praefix: str = "Mitschnitt",
                 uhr: Callable[[], datetime] = datetime.now):
        self._quelle = quelle
        self.ordner = Path(ordner)
        self.bitrate = bitrate
        self.ausgabe_folgen = ausgabe_folgen
        self.blockframes = max(1, int(SAMPLERATE * blockdauer))
        self.pruefintervall = pruefintervall
        self.praefix = praefix
        self._uhr = uhr

        self._stopp = threading.Event()
        self._pause = threading.Event()
        self._sperre = threading.Lock()
        self._status = Status()
        self._thread: Optional[threading.Thread] = None
        self._bereit = threading.Event()

    # ------------------------------------------------------------ Steuerung
    def starten(self) -> Path:
        if self._thread and self._thread.is_alive():
            raise RuntimeError("Aufnahme läuft bereits")
        self.ordner.mkdir(parents=True, exist_ok=True)
        pfad = freier_pfad(self.ordner, dateiname_fuer(self._uhr(), self.praefix))
        self._stopp.clear()
        self._pause.clear()
        self._bereit.clear()
        with self._sperre:
            self._status = Status(laeuft=True, pfad=pfad)
        self._thread = threading.Thread(target=self._lauf, args=(pfad,),
                                        name="audio-mitschnitt", daemon=True)
        self._thread.start()
        return pfad

    def stoppen(self, timeout: float = 10.0) -> Optional[Path]:
        """Beendet die Aufnahme und schließt die MP3-Datei sauber ab."""
        self._stopp.set()
        if self._thread:
            self._thread.join(timeout)
        return self._status.pfad

    def pausieren(self) -> None:
        self._pause.set()
        with self._sperre:
            self._status.pausiert = True

    def fortsetzen(self) -> None:
        self._pause.clear()
        with self._sperre:
            self._status.pausiert = False

    @property
    def laeuft(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def warten_bis_bereit(self, timeout: float = 5.0) -> bool:
        """Wartet, bis die Aufnahmequelle geöffnet ist (oder ein Fehler auftrat)."""
        return self._bereit.wait(timeout)

    def status(self) -> Status:
        """Momentaufnahme des Zustands (thread-sicher, für die Oberfläche)."""
        with self._sperre:
            s = self._status
            kopie = Status(**{**s.__dict__, "meldungen": list(s.meldungen)})
            s.meldungen.clear()
            return kopie

    # ------------------------------------------------------------ intern
    def _melden(self, text: str) -> None:
        with self._sperre:
            self._status.meldungen.append(text)

    def _lauf(self, pfad: Path) -> None:
        schreiber: Optional[Mp3Schreiber] = None
        try:
            with com_fuer_thread():  # standardausgabe() braucht unter Windows COM
                schreiber = Mp3Schreiber(pfad, SAMPLERATE, KANAELE, self.bitrate)
                self._aufnahmeschleife(schreiber)
        except Exception as fehler:  # noqa: BLE001 – Fehler an die Oberfläche geben
            with self._sperre:
                self._status.fehler = f"{type(fehler).__name__}: {fehler}"
        finally:
            if schreiber is not None:
                try:
                    schreiber.schliessen()
                except Exception as fehler:  # noqa: BLE001
                    with self._sperre:
                        self._status.fehler = self._status.fehler or str(fehler)
                with self._sperre:
                    self._status.bytes = schreiber.bytes_geschrieben
                    self._status.sekunden = schreiber.dauer_sekunden
                if schreiber.bytes_geschrieben == 0:
                    try:  # keine leeren Dateien liegen lassen
                        schreiber.pfad.unlink()
                    except OSError:
                        pass
            with self._sperre:
                self._status.laeuft = False
                self._status.pegel_db = float("-inf")
            self._bereit.set()

    MAX_FEHLVERSUCHE = 15
    LUECKE_SEKUNDEN = 0.5   # so lange ohne Daten -> Stille einfügen
    LATENZ_SEKUNDEN = 0.2   # Puffer, um verspätete Daten nicht zu überholen

    def _aufnahmeschleife(self, schreiber: Mp3Schreiber) -> None:
        geraet = self._quelle.standardausgabe()
        takt = _Takt(time.monotonic())
        fehlversuche = 0
        while not self._stopp.is_set():
            with self._sperre:
                self._status.geraet = geraet.name
            frames_vorher = schreiber.frames
            try:
                neues_geraet = self._geraet_aufnehmen(geraet, schreiber, takt)
            except Exception as fehler:  # noqa: BLE001
                # Gerät verschwunden (z. B. USB-Headset abgezogen)? Dann auf die
                # neue Standardausgabe wechseln, statt die Aufnahme abzubrechen.
                # Schlägt schon der allererste Start fehl, Fehler weitergeben.
                if self._stopp.is_set():
                    break
                if schreiber.frames > frames_vorher:
                    fehlversuche = 0
                fehlversuche += 1
                if (not self.ausgabe_folgen or schreiber.frames == 0
                        or fehlversuche > self.MAX_FEHLVERSUCHE):
                    raise
                self._melden(f"Aufnahme von „{geraet.name}“ unterbrochen ({fehler}) – "
                             "versuche es erneut …")
                self._stopp.wait(1.0)
                try:
                    geraet = self._quelle.standardausgabe()
                except Exception:  # noqa: BLE001 – gerade kein Gerät: später erneut
                    pass
                continue
            fehlversuche = 0
            schreiber.auf_platte()
            if neues_geraet is None:
                break
            self._melden(f"Soundausgabe gewechselt: {geraet.name} → {neues_geraet.name}")
            with self._sperre:
                self._status.geraetewechsel += 1
            geraet = neues_geraet

    def _geraet_aufnehmen(self, geraet: Geraet, schreiber: Mp3Schreiber,
                          takt: "_Takt") -> Optional[Geraet]:
        """Nimmt von ``geraet`` auf, bis gestoppt wird (-> None) oder die
        Standardausgabe wechselt (-> neues Gerät).

        Das eigentliche Lesen läuft in einem eigenen Thread: Unter
        PulseAudio/PipeWire liefert die Monitor-Quelle bei Stille überhaupt
        keine Daten, ein direkter Lesezugriff würde dann beliebig lange
        blockieren. So bleiben Stopp und Gerätewechsel immer prompt, und
        fehlende Zeit wird als Stille ergänzt.
        """
        bloecke: "queue.Queue[object]" = queue.Queue()
        halt = threading.Event()
        leser = threading.Thread(target=self._leser, args=(geraet, bloecke, halt),
                                 name="audio-mitschnitt-leser", daemon=True)
        leser.start()
        letzte_pruefung = time.monotonic()
        letztes_flush = time.monotonic()
        letzte_daten = time.monotonic()
        try:
            while not self._stopp.is_set():
                try:
                    eintrag = bloecke.get(timeout=0.05)
                except queue.Empty:
                    eintrag = None
                jetzt = time.monotonic()
                pausiert = self._pause.is_set()
                takt.ticken(jetzt, pausiert)

                if isinstance(eintrag, BaseException):
                    raise eintrag
                if eintrag is _OFFEN:
                    self._bereit.set()
                    letzte_daten = jetzt
                elif eintrag is not None:
                    letzte_daten = jetzt
                    if not pausiert:
                        schreiber.schreiben(eintrag)
                    with self._sperre:
                        self._status.pegel_db = pegel_dbfs(eintrag)
                elif not pausiert and jetzt - letzte_daten >= self.LUECKE_SEKUNDEN:
                    # Quelle schweigt -> Stille einfügen, damit die Datei mit der
                    # realen Zeit Schritt hält (etwas Puffer für Latenz lassen).
                    fehlend = int(takt.soll_frames - schreiber.frames
                                  - self.LATENZ_SEKUNDEN * SAMPLERATE)
                    if fehlend > 0:
                        schreiber.schreiben(np.zeros((fehlend, KANAELE), dtype=np.float32))
                    with self._sperre:
                        self._status.pegel_db = float("-inf")

                with self._sperre:
                    self._status.sekunden = schreiber.dauer_sekunden
                    self._status.bytes = schreiber.bytes_geschrieben

                if jetzt - letztes_flush >= 5.0:
                    schreiber.auf_platte()
                    letztes_flush = jetzt

                if self.ausgabe_folgen and jetzt - letzte_pruefung >= self.pruefintervall:
                    letzte_pruefung = jetzt
                    try:
                        aktuell = self._quelle.standardausgabe()
                    except Exception:  # noqa: BLE001 – kurzzeitig kein Gerät: weiter
                        continue
                    if aktuell.id != geraet.id:
                        return aktuell
            # Gestoppt, während die Quelle schwieg: Stille bis zum Stopp ergänzen
            jetzt = time.monotonic()
            if not self._pause.is_set() and jetzt - letzte_daten >= self.LUECKE_SEKUNDEN:
                takt.ticken(jetzt, False)
                fehlend = int(takt.soll_frames - schreiber.frames)
                if fehlend > 0:
                    schreiber.schreiben(np.zeros((fehlend, KANAELE), dtype=np.float32))
            return None
        finally:
            halt.set()
            # Unter Windows endet der Leser sofort; ein bei Stille blockierter
            # PulseAudio-Leser beendet sich beim nächsten Datenblock selbst.
            leser.join(timeout=1.0)

    def _leser(self, geraet: Geraet, bloecke: "queue.Queue[object]",
               halt: threading.Event) -> None:
        try:
            with com_fuer_thread():
                with self._quelle.oeffnen(geraet, SAMPLERATE, KANAELE,
                                          self.blockframes) as strom:
                    bloecke.put(_OFFEN)
                    while not halt.is_set():
                        bloecke.put(strom.record(numframes=self.blockframes))
        except Exception as fehler:  # noqa: BLE001 – an die Aufnahmeschleife geben
            if not halt.is_set():
                bloecke.put(fehler)


_OFFEN = object()  # Signal des Lesers: Quelle ist geöffnet


class _Takt:
    """Zählt, wie viele Frames bei realer Zeit (ohne Pausen) da sein sollten."""

    def __init__(self, jetzt: float) -> None:
        self.soll_frames = 0.0
        self._letzte = jetzt

    def ticken(self, jetzt: float, pausiert: bool) -> None:
        if not pausiert:
            self.soll_frames += (jetzt - self._letzte) * SAMPLERATE
        self._letzte = jetzt
