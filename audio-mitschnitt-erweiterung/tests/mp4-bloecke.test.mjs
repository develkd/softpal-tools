// Übergabe kodierter Blöcke an die echte mp4-muxer-Bibliothek – mit den
// Problemfällen aus der Praxis: Chrome-Blöcke ohne Dauer und Firefox-Blöcke,
// die mp4-muxers instanceof-Prüfung nicht bestehen (hier: einfache Objekte).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const Mp4Muxer = require('../src/lib/mp4-muxer.js');
const { blockHinzufuegen } = require('../src/lib/mp4-bloecke.js');

function block({ type = 'key', timestamp, duration = null, bytes = [0, 0, 0, 1, 0x65, 1, 2, 3] }) {
  return { type, timestamp, duration, byteLength: bytes.length, copyTo: (ziel) => ziel.set(bytes) };
}

test('Blöcke ohne Dauer und ohne EncodedVideoChunk-Typ ergeben eine MP4', () => {
  const ziel = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({
    target: ziel,
    video: { codec: 'avc', width: 640, height: 360 },
    audio: { codec: 'opus', numberOfChannels: 2, sampleRate: 48000 },
    fastStart: 'in-memory',
  });
  const avcBeschreibung = new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
  const videoMeta = { decoderConfig: { codec: 'avc1.64001f', codedWidth: 640, codedHeight: 360, description: avcBeschreibung.buffer } };
  const opusKopf = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]);
  const audioMeta = { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: opusKopf.buffer } };

  // mit der Original-Funktion scheitert das genau wie in Chrome gemeldet
  assert.throws(() => muxer.addVideoChunk(block({ timestamp: 0 }), videoMeta), /EncodedVideoChunk/);
  assert.throws(() => muxer.addVideoChunkRaw(new Uint8Array(4), 'key', 0, null, videoMeta), /duration/);

  for (let i = 0; i < 10; i++) {
    blockHinzufuegen(muxer, 'video', block({ type: i === 0 ? 'key' : 'delta', timestamp: i * 33333 }), i === 0 ? videoMeta : undefined, 33333);
    blockHinzufuegen(muxer, 'audio', block({ type: 'key', timestamp: i * 20000, duration: i % 2 ? 20000 : null, bytes: [0xfc, 1, 2] }),
      i === 0 ? audioMeta : undefined, 21333);
  }
  muxer.finalize();
  const mp4 = new Uint8Array(ziel.buffer);
  assert.equal(Buffer.from(mp4.subarray(4, 8)).toString('latin1'), 'ftyp');
  assert.ok(Buffer.from(mp4).includes(Buffer.from('avcC')), 'AVC-Beschreibung fehlt');
  assert.ok(Buffer.from(mp4).includes(Buffer.from('Opus')), 'Opus-Spur fehlt');
});

test('negative Zeitstempel werden auf 0 gesetzt', () => {
  const ziel = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({ target: ziel, video: { codec: 'avc', width: 2, height: 2 }, fastStart: 'in-memory' });
  const meta = { decoderConfig: { codec: 'avc1.64001f', description: new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe0, 0]).buffer } };
  blockHinzufuegen(muxer, 'video', block({ timestamp: -5 }), meta, 33333);
  muxer.finalize();
  assert.ok(ziel.buffer.byteLength > 0);
});
