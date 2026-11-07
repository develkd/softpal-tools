// Prüft den Firefox-Abgriff (src/firefox/tap.js) in Chromium: die
// Erweiterungs-API (browser.runtime.connect) wird nachgebildet, Web Audio und
// <audio>-Elemente sind echt. Firefox selbst wird damit NICHT getestet.
//
// Szenario:
//  - <audio> derselben Herkunft (1000 Hz)            -> muss aufgenommen werden
//  - <audio> von fremder Herkunft ohne CORS (2000 Hz) -> darf nicht angefasst werden
//  - nach 2 s neu eingefügtes <audio> (3000 Hz)      -> muss erkannt werden
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const src = new URL('../src/', import.meta.url);

function wav(frequenz, sekunden, sr = 48000) {
  const n = sr * sekunden;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(0.3 * 32767 * Math.sin(2 * Math.PI * frequenz * i / sr)), 44 + i * 2);
  return buf;
}

const SEITE = (fremdUrl) => `<!doctype html><meta charset="utf-8"><title>Abgriff</title>
<script src="/lib/lame.min.js"></script><script src="/lib/mischer.js"></script><script src="/lib/resampler.js"></script><script src="/lib/aufnahme.js"></script>
<audio id="eigen" src="/ton1000.wav" loop></audio>
<audio id="fremd" src="${fremdUrl}" loop></audio>
<script>
  // Nachbildung von browser.runtime.connect: Port liefert direkt an eine Aufnahme
  // wie die Firefox-Hintergrundseite; hier bewusst eine andere Rate als die
  // Standardrate der Seite, damit die Umrechnung mitgetestet wird
  const seitenRate = new AudioContext().sampleRate;
  window.aufnahme = new Aufnahme({ bitrate: 128, sampleRate: seitenRate === 48000 ? 44100 : 48000 });
  window.infos = [];
  window.browser = { runtime: { connect: () => ({
    postMessage(m) {
      if (m.typ === 'pcm') { window.pcmRate = m.rate; aufnahme.hinzufuegen('seite', m.l, m.r, m.rate); }
      if (m.typ === 'info') infos.push(m);
      if (m.typ === 'diag') window.letzteDiag = m;
    },
    disconnect() {},
    onMessage: { addListener() {} },
    onDisconnect: { addListener() {} },
  }) } };
  window.laden = (datei) => new Promise((ok) => {
    const s = document.createElement('script'); s.src = datei; s.onload = ok; document.head.append(s);
  });
</script>`;

const dateien = {
  '/lib/lame.min.js': readFileSync(new URL('lib/lame.min.js', src)),
  '/lib/mischer.js': readFileSync(new URL('lib/mischer.js', src)),
  '/lib/resampler.js': readFileSync(new URL('lib/resampler.js', src)),
  '/lib/aufnahme.js': readFileSync(new URL('lib/aufnahme.js', src)),
  '/lib/abgriff.js': readFileSync(new URL('lib/abgriff.js', src)),
  '/firefox/tap.js': readFileSync(new URL('firefox/tap.js', src)),
  '/ton1000.wav': wav(1000, 2),
  '/ton2000.wav': wav(2000, 2),
  '/ton3000.wav': wav(3000, 2),
};
function server() {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(s.seite); return; }
      const d = dateien[req.url];
      if (!d) { res.writeHead(404); res.end(); return; }
      const typ = req.url.endsWith('.wav') ? 'audio/wav' : 'text/javascript';
      res.writeHead(200, { 'content-type': typ, 'content-length': d.length });
      res.end(d);
    }).listen(0, '127.0.0.1', () => ok(s));
  });
}

const haupt = await server();
const fremd = await server(); // anderer Port = andere Herkunft, kein CORS
haupt.seite = SEITE(`http://127.0.0.1:${fremd.address().port}/ton2000.wav`);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const seite = await browser.newPage();
  const fehler = [];
  seite.on('pageerror', (e) => fehler.push(e));
  await seite.goto(`http://127.0.0.1:${haupt.address().port}/`);
  await seite.evaluate(async () => {
    await Promise.all([document.getElementById('eigen').play(), document.getElementById('fremd').play()]);
    aufnahme.starten();
    await laden('/lib/abgriff.js');
    await laden('/firefox/tap.js');
  });
  await seite.waitForTimeout(2000);
  await seite.evaluate(() => {
    const neu = document.createElement('audio');
    neu.src = '/ton3000.wav'; neu.loop = true; neu.id = 'neu';
    document.body.append(neu);
    return neu.play();
  });
  await seite.waitForTimeout(2000);
  const ergebnis = await seite.evaluate(async () => {
    const blob = aufnahme.stoppen();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Analyse direkt im Browser: dekodieren und Tonanteile messen
    const ctx = new OfflineAudioContext(1, 48000, 48000);
    const puffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    const x = puffer.getChannelData(0);
    const sr = puffer.sampleRate;
    const energie = (seg, f) => {
      const k = 2 * Math.cos((2 * Math.PI * f) / sr); let s1 = 0; let s2 = 0;
      for (const v of seg) { const s0 = v + k * s1 - s2; s2 = s1; s1 = s0; }
      return s1 * s1 + s2 * s2 - k * s1 * s2;
    };
    const abschnitt = (von, bis) => {
      const seg = x.subarray(Math.floor(von * sr), Math.floor(bis * sr));
      return { f1000: energie(seg, 1000), f2000: energie(seg, 2000), f3000: energie(seg, 3000) };
    };
    return {
      dauer: puffer.duration,
      bytes: bytes.length,
      vorher: abschnitt(0.6, 1.6), // nur 1000 Hz erwartet
      nachher: abschnitt(3.0, 3.6), // 1000 + 3000 Hz erwartet
      info: infos.at(-1),
      diag: window.letzteDiag,
      raten: { seite: window.pcmRate, aufnahme: aufnahme.sampleRate },
      fremdNochHoerbar: !document.getElementById('fremd').paused,
    };
  });
  console.log(JSON.stringify(ergebnis, null, 1));
  assert.deepEqual(fehler, []);
  assert.notEqual(ergebnis.raten.seite, ergebnis.raten.aufnahme, 'Umrechnung wurde nicht getestet');
  assert.ok(ergebnis.dauer > 3.3 && ergebnis.dauer < 4.6, `Dauer ${ergebnis.dauer}`);
  const { vorher, nachher, info } = ergebnis;
  assert.ok(vorher.f1000 > 1000 * vorher.f2000, '1000 Hz (eigene Herkunft) fehlt oder 2000 Hz (fremd) wurde aufgenommen');
  assert.ok(nachher.f3000 > 100 * nachher.f2000, 'neu eingefügtes Element (3000 Hz) fehlt');
  assert.ok(nachher.f1000 > 100 * nachher.f2000);
  assert.deepEqual({ erfasst: info.erfasst, fremd: info.fremd, fehler: info.fehler }, { erfasst: 2, fremd: 1, fehler: 0 });
  assert.ok(ergebnis.fremdNochHoerbar);
  const d = ergebnis.diag;
  assert.ok(d, 'keine Diagnose empfangen');
  assert.equal(d.abgriffFunktion, 'function');
  assert.match(d.ctx, /^running \d+ Hz$/);
  assert.ok(d.gesendet > 10, `gesendet ${d.gesendet}`);
  assert.deepEqual(d.fehler, []);
  assert.deepEqual(d.elemente.map((e) => e.split(' ').slice(0, 3).join(' ')).sort(),
    ['audio eigen erfasst', 'audio eigen erfasst', 'audio fremd fremd']);
  console.log('Abgriff OK');
} finally {
  await browser.close();
  haupt.close();
  fremd.close();
}
