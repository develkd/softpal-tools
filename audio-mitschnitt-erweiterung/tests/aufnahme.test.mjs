import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { aufnahmeModul, mp3Frames, sinus, testUhr } from './hilfen.mjs';

const { Aufnahme, Mp3Kodierer, floatZuInt16, dateiname, pegelDb } = aufnahmeModul;
const SR = 48000;

function ffprobeVorhanden() {
  try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('floatZuInt16 begrenzt und rundet', () => {
  assert.deepEqual(Array.from(floatZuInt16(new Float32Array([0, 1, -1, 2, -3, 0.5]))),
    [0, 32767, -32767, 32767, -32767, 16384]);
});

test('Dateiname enthält Datum und Uhrzeit', () => {
  assert.equal(dateiname(new Date(2026, 10, 7, 9, 5, 3)), 'Mitschnitt_2026-11-07_09-05-03.mp3');
});

test('Pegel', () => {
  assert.equal(pegelDb(new Float32Array(4), new Float32Array(4)), -Infinity);
  assert.ok(Math.abs(pegelDb(new Float32Array([0.1]), new Float32Array([0])) + 20) < 1e-5);
});

test('ungültige Bitrate wird abgelehnt', () => {
  assert.throws(() => new Mp3Kodierer({ bitrate: 100 }), /Bitrate/);
});

test('Aufnahme mit Pause erzeugt gültige MP3 der richtigen Länge', async () => {
  const uhr = testUhr();
  const a = new Aufnahme({ bitrate: 128, jetzt: uhr, taktMs: 0 });
  a.starten();
  let phase = 0;
  const liefern = (sek) => {
    for (let n = 0; n < Math.round(sek * 10); n++) {
      const ton = sinus(SR / 10, { phase });
      phase += SR / 10;
      a.mischer.hinzufuegen('tab', ton, ton);
      uhr.vor(0.1);
      a.takt();
    }
  };
  liefern(2); // 2 s Ton
  a.pausieren();
  uhr.vor(3); // 3 s Pause zählen nicht
  a.takt();
  a.fortsetzen();
  liefern(1);
  assert.ok(a.status().pegelDb > -7 && a.status().pegelDb < -5); // 0,5 ≈ -6 dBFS
  const blob = a.stoppen();
  const st = a.status();
  assert.equal(st.laeuft, false);
  assert.ok(Math.abs(st.sekunden - 3) < 0.01, `Dauer ${st.sekunden}`);

  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/mpeg');
  assert.equal(buf.length, st.bytes);
  const frames = mp3Frames(buf);
  assert.ok(frames.every((f) => f.sampleRate === 48000 && f.kanaele === 2 && f.bitrate === 128));
  const dauer = (frames.length * 1152) / SR;
  assert.ok(Math.abs(dauer - 3) < 0.1, `MP3-Dauer ${dauer}`);

  if (ffprobeVorhanden()) {
    const ordner = mkdtempSync(join(tmpdir(), 'mitschnitt-'));
    const pfad = join(ordner, 'test.mp3');
    writeFileSync(pfad, buf);
    const aus = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels',
      '-of', 'json', pfad]).toString();
    const info = JSON.parse(aus);
    assert.equal(info.streams[0].codec_name, 'mp3');
    assert.equal(Number(info.streams[0].sample_rate), 48000);
    assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.1);
  }
});

test('Stoppen ohne Daten liefert Stille in Länge der Laufzeit', async () => {
  const uhr = testUhr();
  const a = new Aufnahme({ jetzt: uhr, taktMs: 0 });
  a.starten();
  uhr.vor(1.5);
  a.takt();
  const blob = a.stoppen();
  const frames = mp3Frames(Buffer.from(await blob.arrayBuffer()));
  assert.ok(Math.abs((frames.length * 1152) / SR - 1.5) < 0.1);
});

test('Dateiname aus dem Tabtitel', () => {
  const { dateinameAusTitel } = aufnahmeModul;
  const d = new Date(2026, 10, 7, 9, 5, 3);
  const faelle = [
    ['(3) Mein Lied - YouTube', 'Mein Lied.mp3'],
    ['Künstler – Titel (Live) | YouTube Music', 'Künstler – Titel (Live).mp3'],
    ['AC/DC: Back in Black?', 'AC DC Back in Black.mp3'],
    ['  ..versteckt  ', 'versteckt.mp3'],
    ['Ende mit Punkt.', 'Ende mit Punkt.mp3'],
    ['Zeile\nUmbruch\tTab', 'ZeileUmbruchTab.mp3'],
    ['Podcast <Folge 12> "Gäste"', 'Podcast Folge 12 Gäste.mp3'],
    ['CON', '_CON.mp3'],
    ['🎵 Musik 🎶', '🎵 Musik 🎶.mp3'],
    ['', 'Mitschnitt_2026-11-07_09-05-03.mp3'],
    [null, 'Mitschnitt_2026-11-07_09-05-03.mp3'],
    ['???', 'Mitschnitt_2026-11-07_09-05-03.mp3'],
    ['YouTube', 'YouTube.mp3'],
  ];
  for (const [titel, erwartet] of faelle) assert.equal(dateinameAusTitel(titel, d), erwartet, String(titel));
  const lang = dateinameAusTitel('x'.repeat(300), d);
  assert.equal(lang, `${'x'.repeat(120)}.mp3`);
});

test('Aufnahme: Dateiname folgt dem Titel, Ersatzname mit Datum', () => {
  const a = new Aufnahme({ titel: '(1) Erstes Video - YouTube', taktMs: 0 });
  assert.equal(a.dateiname, 'Erstes Video.mp3');
  a.titel = 'Zweites Video - YouTube';
  assert.equal(a.dateiname, 'Zweites Video.mp3');
  assert.match(a.ersatzname, /^Mitschnitt_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.mp3$/);
});

test('ASCII-Ausweichname und Reihenfolge der Namen', () => {
  const { dateinameAscii } = aufnahmeModul;
  assert.equal(dateinameAscii('Künstler – Titel (Live) | YouTube Music'), 'Kuenstler - Titel (Live).mp3');
  assert.equal(dateinameAscii('Café Größe 🎵'), 'Cafe Groesse.mp3');
  const a = new Aufnahme({ titel: 'Straße 🎶', taktMs: 0 });
  assert.equal(a.dateinamen.length, 3);
  assert.equal(a.dateinamen[0], 'Straße 🎶.mp3');
  assert.equal(a.dateinamen[1], 'Strasse.mp3');
  assert.match(a.dateinamen[2], /^Mitschnitt_/);
  assert.equal(new Aufnahme({ titel: 'Plain', taktMs: 0 }).dateinamen.length, 2); // ASCII = Titel
});
