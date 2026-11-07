"""Minimaler MP3-Frame-Parser für Tests (MPEG-1 Layer III)."""

from pathlib import Path

BITRATEN = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
SAMPLERATEN = [44100, 48000, 32000]


def frames_lesen(pfad: Path):
    daten = Path(pfad).read_bytes()
    # ID3v2-Tag überspringen
    pos = 0
    if daten[:3] == b"ID3":
        groesse = 0
        for b in daten[6:10]:
            groesse = (groesse << 7) | (b & 0x7F)
        pos = 10 + groesse
    frames = []
    while pos + 4 <= len(daten):
        kopf = int.from_bytes(daten[pos:pos + 4], "big")
        if (kopf >> 21) & 0x7FF != 0x7FF:
            raise ValueError(f"kein Frame-Sync bei Byte {pos}")
        version = (kopf >> 19) & 0b11
        layer = (kopf >> 17) & 0b11
        assert version == 0b11, "kein MPEG-1"
        assert layer == 0b01, "kein Layer III"
        bitrate = BITRATEN[(kopf >> 12) & 0xF]
        samplerate = SAMPLERATEN[(kopf >> 10) & 0b11]
        padding = (kopf >> 9) & 1
        modus = (kopf >> 6) & 0b11  # 3 = Mono
        laenge = 144 * bitrate * 1000 // samplerate + padding
        frames.append({"bitrate": bitrate, "samplerate": samplerate,
                       "kanaele": 1 if modus == 3 else 2})
        pos += laenge
    return frames


def dauer(pfad: Path) -> float:
    frames = frames_lesen(pfad)
    return len(frames) * 1152 / frames[0]["samplerate"]
