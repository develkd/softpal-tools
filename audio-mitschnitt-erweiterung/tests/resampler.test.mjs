import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aufnahmeModul, Resampler, sinus, testUhr } from './hilfen.mjs';

function goertzel(x, f, sr) {
  const k = 2 * Math.cos((2 * Math.PI * f) / sr);
  let s1 = 0; let s2 = 0;
  for (const v of x) { const s0 = v + k * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2)) / (x.length / 2);
}

test('44,1 -> 48 kHz: richtige Länge über viele Blöcke, Frequenz bleibt', () => {
  const rs = new Resampler(44100, 48000);
  const aus = [];
  let phase = 0;
  for (let b = 0; b < 100; b++) { // 100 Blöcke à 441 = 1 s, ungerade Blockgrenzen
    const ton = sinus(441, { frequenz: 1000, sampleRate: 44100, phase });
    phase += 441;
    aus.push(...rs.verarbeiten(ton, ton).links);
  }
  assert.ok(Math.abs(aus.length - 48000) <= 2, `Länge ${aus.length}`);
  const x = Float32Array.from(aus.slice(1000));
  assert.ok(goertzel(x, 1000, 48000) > 0.45, 'Ton 1 kHz fehlt');
  assert.ok(goertzel(x, 918.75, 48000) < 0.05, 'Frequenz verschoben');
});

test('48 -> 44,1 kHz und gleiche Rate', () => {
  const rs = new Resampler(48000, 44100);
  let n = 0;
  for (let b = 0; b < 50; b++) n += rs.verarbeiten(new Float32Array(960)).links.length;
  assert.ok(Math.abs(n - 44100) <= 2, `Länge ${n}`);
  const gleich = new Resampler(48000, 48000);
  const ein = Float32Array.from({ length: 10 }, (_, i) => i);
  const a = gleich.verarbeiten(ein).links;
  const b = gleich.verarbeiten(ein).links;
  assert.equal(a.length + b.length, 20 - 1); // 1 Sample Verzögerung durch Interpolation
  assert.deepEqual(Array.from(a), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('Aufnahme rechnet Quellen mit anderer Rate um', async () => {
  const { Aufnahme } = aufnahmeModul;
  const uhr = testUhr();
  const a = new Aufnahme({ sampleRate: 48000, jetzt: uhr, taktMs: 0 });
  a.starten();
  a.hinzufuegen('q', new Float32Array(44100).fill(0.5), null, 44100);
  const fifo = a.mischer.quellen.get('q');
  assert.ok(Math.abs(fifo.laenge - 48000) <= 2, `Länge ${fifo.laenge}`);
  a.entfernen('q');
  assert.equal(a.mischer.quellen.size, 0);
});
