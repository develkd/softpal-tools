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
