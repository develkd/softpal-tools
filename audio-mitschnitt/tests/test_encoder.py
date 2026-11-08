import numpy as np
import pytest

from audio_mitschnitt.encoder import Mp3Schreiber, auf_kanaele_bringen, float_zu_int16
from mp3info import dauer, frames_lesen


def sinus(sekunden, frequenz=440.0, samplerate=48000, kanaele=2, amplitude=0.5):
    t = np.arange(int(sekunden * samplerate)) / samplerate
    ton = (amplitude * np.sin(2 * np.pi * frequenz * t)).astype(np.float32)
    return np.repeat(ton[:, None], kanaele, axis=1)


def test_float_zu_int16_begrenzt():
    ergebnis = float_zu_int16(np.array([0.0, 1.0, -1.0, 2.0, -3.0, 0.5]))
    assert ergebnis.dtype == np.int16
    assert list(ergebnis) == [0, 32767, -32767, 32767, -32767, 16384]


@pytest.mark.parametrize("eingang,erwartet", [((10,), (10, 2)), ((10, 1), (10, 2)),
                                              ((10, 2), (10, 2)), ((10, 6), (10, 2))])
def test_auf_kanaele_bringen(eingang, erwartet):
    assert auf_kanaele_bringen(np.zeros(eingang), 2).shape == erwartet


def test_mono_wird_verdoppelt_und_surround_gekuerzt():
    mono = np.array([[0.1], [0.2]], dtype=np.float32)
    assert np.allclose(auf_kanaele_bringen(mono, 2), [[0.1, 0.1], [0.2, 0.2]])
    surround = np.arange(12, dtype=np.float32).reshape(2, 6)
    assert np.allclose(auf_kanaele_bringen(surround, 2), [[0, 1], [6, 7]])


def test_schreibt_gueltige_mp3(tmp_path):
    pfad = tmp_path / "test.mp3"
    with Mp3Schreiber(pfad, bitrate=192) as s:
        for _ in range(30):  # 3 Sekunden in 100-ms-Blöcken
            s.schreiben(sinus(0.1))
    assert s.dauer_sekunden == pytest.approx(3.0)
    assert s.bytes_geschrieben == pfad.stat().st_size

    frames = frames_lesen(pfad)
    assert {f["samplerate"] for f in frames} == {48000}
    assert {f["bitrate"] for f in frames} == {192}
    assert {f["kanaele"] for f in frames} == {2}
    assert dauer(pfad) == pytest.approx(3.0, abs=0.1)


def test_ungueltige_bitrate(tmp_path):
    with pytest.raises(ValueError):
        Mp3Schreiber(tmp_path / "x.mp3", bitrate=100)


def test_schreiben_nach_schliessen(tmp_path):
    s = Mp3Schreiber(tmp_path / "x.mp3")
    s.schliessen()
    s.schliessen()  # doppelt schließen ist harmlos
    with pytest.raises(RuntimeError):
        s.schreiben(sinus(0.1))
