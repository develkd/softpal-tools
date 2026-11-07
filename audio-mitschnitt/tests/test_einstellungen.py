from audio_mitschnitt.einstellungen import Einstellungen


def test_speichern_und_laden(tmp_path):
    datei = tmp_path / "e.json"
    Einstellungen(zielordner=str(tmp_path), bitrate=320, ausgabe_folgen=False).speichern(datei)
    e = Einstellungen.laden(datei)
    assert (e.zielordner, e.bitrate, e.ausgabe_folgen) == (str(tmp_path), 320, False)


def test_kaputte_oder_fremde_werte(tmp_path):
    datei = tmp_path / "e.json"
    datei.write_text("{kaputt", encoding="utf-8")
    assert Einstellungen.laden(datei).bitrate == 192
    datei.write_text('{"bitrate": 999, "unbekannt": 1, "zielordner": ""}', encoding="utf-8")
    e = Einstellungen.laden(datei)
    assert e.bitrate == 192 and e.zielordner
    datei.write_text("[1, 2]", encoding="utf-8")
    assert Einstellungen.laden(datei).bitrate == 192
    assert Einstellungen.laden(tmp_path / "fehlt.json").bitrate == 192
