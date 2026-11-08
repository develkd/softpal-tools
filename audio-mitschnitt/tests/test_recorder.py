import threading
import time
from contextlib import contextmanager
from datetime import datetime

import numpy as np
import pytest

from audio_mitschnitt.quelle import Geraet
from audio_mitschnitt.recorder import (Recorder, dateiname_fuer, freier_pfad,
                                       pegel_dbfs)
from mp3info import dauer, frames_lesen

LAUTSPRECHER = Geraet("spk-1", "Lautsprecher (Realtek)")
HEADSET = Geraet("spk-2", "Headset (USB)")


class FalscheQuelle:
    """Liefert Sinus-Blöcke in Echtzeit-ähnlichem Tempo, ohne Audio-Hardware."""

    def __init__(self, tempo=20.0, kanaele_geliefert=2, fehler_beim_oeffnen=None):
        self.standard = LAUTSPRECHER
        self.geoeffnet: list[str] = []
        self.tempo = tempo  # >1: schneller als Echtzeit
        self.kanaele_geliefert = kanaele_geliefert
        self.fehler_beim_oeffnen = fehler_beim_oeffnen
        self.abbruch_nach_bloecken = None  # simuliert abgezogenes Gerät
        self.bloecke = 0
        self.sperre = threading.Lock()

    def standardausgabe(self):
        with self.sperre:
            return self.standard

    @contextmanager
    def oeffnen(self, geraet, samplerate, kanaele, blockgroesse):
        if self.fehler_beim_oeffnen:
            raise self.fehler_beim_oeffnen
        self.geoeffnet.append(geraet.id)
        quelle = self

        class Strom:
            def record(self, numframes):
                time.sleep(numframes / samplerate / quelle.tempo)
                quelle.bloecke += 1
                if quelle.abbruch_nach_bloecken and quelle.bloecke == quelle.abbruch_nach_bloecken:
                    raise RuntimeError("Gerät entfernt")
                t = np.arange(numframes) / samplerate
                ton = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
                return np.repeat(ton[:, None], quelle.kanaele_geliefert, axis=1)

        yield Strom()


def warten_auf(bedingung, timeout=5.0):
    ende = time.monotonic() + timeout
    while time.monotonic() < ende:
        if bedingung():
            return True
        time.sleep(0.01)
    return False


def feste_uhr():
    return datetime(2026, 11, 7, 20, 15, 3)


def test_dateiname_und_freier_pfad(tmp_path):
    assert dateiname_fuer(feste_uhr()) == "Mitschnitt_2026-11-07_20-15-03.mp3"
    (tmp_path / "a.mp3").write_bytes(b"")
    (tmp_path / "a_2.mp3").write_bytes(b"")
    assert freier_pfad(tmp_path, "a.mp3").name == "a_3.mp3"
    assert freier_pfad(tmp_path, "b.mp3").name == "b.mp3"


def test_pegel():
    assert pegel_dbfs(np.zeros((10, 2))) == float("-inf")
    assert pegel_dbfs(np.full((10, 2), 1.0)) == pytest.approx(0.0)
    assert pegel_dbfs(np.full((10, 2), 0.1)) == pytest.approx(-20.0)


def test_aufnahme_erzeugt_mp3(tmp_path):
    quelle = FalscheQuelle()
    r = Recorder(quelle, tmp_path, bitrate=128, uhr=feste_uhr)
    pfad = r.starten()
    assert r.warten_bis_bereit()
    assert warten_auf(lambda: r.status().sekunden >= 2.0)
    r.stoppen()

    st = r.status()
    assert not st.laeuft and st.fehler is None
    assert pfad == tmp_path / "Mitschnitt_2026-11-07_20-15-03.mp3"
    assert st.geraet == LAUTSPRECHER.name
    assert st.bytes == pfad.stat().st_size > 0
    frames = frames_lesen(pfad)
    assert {f["bitrate"] for f in frames} == {128}
    assert dauer(pfad) == pytest.approx(st.sekunden, abs=0.15)


def test_mono_quelle_wird_stereo(tmp_path):
    r = Recorder(FalscheQuelle(kanaele_geliefert=1), tmp_path)
    pfad = r.starten()
    assert warten_auf(lambda: r.status().sekunden >= 0.5)
    r.stoppen()
    assert {f["kanaele"] for f in frames_lesen(pfad)} == {2}


def test_pause_nimmt_nichts_auf(tmp_path):
    quelle = FalscheQuelle()
    r = Recorder(quelle, tmp_path)
    r.starten()
    assert warten_auf(lambda: r.status().sekunden >= 0.5)
    r.pausieren()
    time.sleep(0.05)
    sekunden_bei_pause = r.status().sekunden
    bloecke_bei_pause = quelle.bloecke
    assert warten_auf(lambda: quelle.bloecke >= bloecke_bei_pause + 10)
    assert r.status().sekunden == pytest.approx(sekunden_bei_pause, abs=0.11)
    assert r.status().pausiert
    r.fortsetzen()
    assert warten_auf(lambda: r.status().sekunden >= sekunden_bei_pause + 0.5)
    r.stoppen()


def test_wechsel_der_standardausgabe_wird_verfolgt(tmp_path):
    quelle = FalscheQuelle()
    r = Recorder(quelle, tmp_path, pruefintervall=0.05)
    pfad = r.starten()
    assert warten_auf(lambda: r.status().sekunden >= 0.5)
    with quelle.sperre:
        quelle.standard = HEADSET
    assert warten_auf(lambda: quelle.geoeffnet[-1:] == [HEADSET.id])
    assert warten_auf(lambda: r.status().geraet == HEADSET.name)
    r.stoppen()
    st = r.status()
    assert quelle.geoeffnet == [LAUTSPRECHER.id, HEADSET.id]
    assert st.geraetewechsel == 1
    assert pfad.exists() and st.fehler is None


def test_ohne_folgen_bleibt_geraet(tmp_path):
    quelle = FalscheQuelle()
    r = Recorder(quelle, tmp_path, ausgabe_folgen=False, pruefintervall=0.05)
    r.starten()
    assert warten_auf(lambda: r.status().sekunden >= 0.3)
    quelle.standard = HEADSET
    time.sleep(0.3)
    r.stoppen()
    assert quelle.geoeffnet == [LAUTSPRECHER.id]


def test_entferntes_geraet_fuehrt_zur_neuen_ausgabe(tmp_path):
    quelle = FalscheQuelle()
    quelle.abbruch_nach_bloecken = 5

    r = Recorder(quelle, tmp_path, pruefintervall=0.05)
    r._stopp.wait = lambda t: False  # Wartezeit vor dem Neuversuch im Test überspringen
    pfad = r.starten()
    assert warten_auf(lambda: len(quelle.geoeffnet) >= 2)
    assert warten_auf(lambda: r.status().sekunden >= 1.0)
    r.stoppen()
    st = r.status()
    assert st.fehler is None
    assert frames_lesen(pfad)


def test_fehler_beim_start_wird_gemeldet(tmp_path):
    r = Recorder(FalscheQuelle(fehler_beim_oeffnen=RuntimeError("kein Loopback")), tmp_path)
    r.starten()
    assert r.warten_bis_bereit()
    assert warten_auf(lambda: not r.laeuft)
    st = r.status()
    assert not st.laeuft
    assert "kein Loopback" in st.fehler


def test_doppelter_start_verboten(tmp_path):
    r = Recorder(FalscheQuelle(), tmp_path)
    r.starten()
    with pytest.raises(RuntimeError):
        r.starten()
    r.stoppen()


def test_leere_datei_wird_bei_fehler_entfernt(tmp_path):
    r = Recorder(FalscheQuelle(fehler_beim_oeffnen=RuntimeError("x")), tmp_path)
    pfad = r.starten()
    assert warten_auf(lambda: not r.laeuft)
    assert not pfad.exists()


class StummeQuelle(FalscheQuelle):
    """Wie PulseAudio-Monitor bei Stille: record() liefert schlicht nichts."""

    def __init__(self):
        super().__init__()
        self.freigabe = threading.Event()

    @contextmanager
    def oeffnen(self, geraet, samplerate, kanaele, blockgroesse):
        self.geoeffnet.append(geraet.id)
        freigabe = self.freigabe

        class Strom:
            def record(self, numframes):
                freigabe.wait()
                return np.zeros((numframes, kanaele), dtype=np.float32)

        yield Strom()


def test_stille_ohne_daten_wird_aufgefuellt_und_stopp_blockiert_nicht(tmp_path):
    quelle = StummeQuelle()
    r = Recorder(quelle, tmp_path)
    pfad = r.starten()
    start = time.monotonic()
    assert warten_auf(lambda: r.status().sekunden >= 1.0)
    time.sleep(0.5)
    vergangen = time.monotonic() - start
    t0 = time.monotonic()
    r.stoppen()
    assert time.monotonic() - t0 < 2.0  # Stopp hängt nicht am blockierten Leser
    quelle.freigabe.set()
    st = r.status()
    assert st.fehler is None
    # Datei hält mit der realen Zeit Schritt (abzüglich Lücken-/Latenzpuffer)
    assert vergangen - 0.05 <= st.sekunden <= vergangen + 0.3
    assert dauer(pfad) == pytest.approx(st.sekunden, abs=0.15)


def test_wechsel_wird_auch_bei_stille_erkannt(tmp_path):
    quelle = StummeQuelle()
    r = Recorder(quelle, tmp_path, pruefintervall=0.05)
    r.starten()
    time.sleep(0.2)
    with quelle.sperre:
        quelle.standard = HEADSET
    assert warten_auf(lambda: quelle.geoeffnet[-1:] == [HEADSET.id])
    r.stoppen()
    quelle.freigabe.set()
