// Lädt die Browser-Skripte (klassische Skripte) in Node.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';

const require = createRequire(import.meta.url);
const lib = new URL('../src/lib/', import.meta.url);

if (!globalThis.lamejs) runInThisContext(readFileSync(new URL('lame.min.js', lib), 'utf8'));
export const { Mischer } = require('../src/lib/mischer.js');
export const aufnahmeModul = require('../src/lib/aufnahme.js');

/** Uhr zum Weiterdrehen in Tests */
export function testUhr(start = 1000) {
  let t = start;
  const uhr = () => t;
  uhr.vor = (sek) => { t += sek; };
  return uhr;
}

export function sinus(frames, { frequenz = 440, amplitude = 0.5, sampleRate = 48000, phase = 0 } = {}) {
  const a = new Float32Array(frames);
  for (let i = 0; i < frames; i++) a[i] = amplitude * Math.sin(2 * Math.PI * frequenz * (i + phase) / sampleRate);
  return a;
}

const BITRATEN = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATEN = [44100, 48000, 32000];

/** Minimaler MPEG-1-Layer-III-Frame-Parser: prüft lückenlosen Frame-Strom. */
export function mp3Frames(buf) {
  const frames = [];
  let pos = 0;
  while (pos + 4 <= buf.length) {
    const kopf = buf.readUInt32BE(pos);
    if (((kopf >>> 21) & 0x7ff) !== 0x7ff) throw new Error(`kein Frame-Sync bei Byte ${pos}`);
    if (((kopf >>> 19) & 3) !== 3 || ((kopf >>> 17) & 3) !== 1) throw new Error('kein MPEG-1 Layer III');
    const bitrate = BITRATEN[(kopf >>> 12) & 0xf];
    const sampleRate = RATEN[(kopf >>> 10) & 3];
    const padding = (kopf >>> 9) & 1;
    const kanaele = ((kopf >>> 6) & 3) === 3 ? 1 : 2;
    frames.push({ bitrate, sampleRate, kanaele });
    pos += Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
  }
  return frames;
}
