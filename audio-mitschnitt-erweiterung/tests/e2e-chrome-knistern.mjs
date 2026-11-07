// Regression "Knistern": 12 s Dauer-Sinus (440 Hz) über die Chrome-Erweiterung
// aufnehmen und auf Aussetzer/Sprünge prüfen (Phase und Amplitude je 5 ms).
// Die alte Variante (ScriptProcessor + uhrgesteuerter Mischer) hatte hier
// etwa 9 Störungen in 14 s.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const erweiterung = resolve(new URL('../dist/chrome', import.meta.url).pathname);
const id = [...createHash('sha256').update(erweiterung).digest('hex').slice(0, 32)]
  .map((z) => String.fromCharCode('a'.charCodeAt(0) + parseInt(z, 16))).join('');

const server = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' });
  r.end(`<title>Sinus</title><script>window.los = async () => { const c = new AudioContext(); await c.resume();
    const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = 440; g.gain.value = 0.5;
    o.connect(g).connect(c.destination); o.start(); };</script>`);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'knistern-')), {
  headless: false,
  args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`,
    `--allowlisted-extension-id=${id}`, '--autoplay-policy=no-user-gesture-required'],
});
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.evaluate(() => window.los());
  const tab = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html?tab=${tab}`);
  await popup.click('#start');
  await popup.waitForFunction(() => document.getElementById('start').textContent.includes('Beenden'));
  const art = (await popup.evaluate(() => chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'status' }))).abgriffArt;
  console.log('Abgriff:', art);
  assert.equal(art, 'MediaStreamTrackProcessor');
  await seite.waitForTimeout(12000);
  await popup.click('#start');
  await popup.waitForFunction(() => document.getElementById('hinweis').textContent.startsWith('Gespeichert'));
  const d = await sw.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      const [x] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
      if (x && x.state === 'complete') return x;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });
  const mp3 = readFileSync(d.filename);

  const ergebnis = await seite.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const puffer = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(bytes.buffer);
    const sr = puffer.sampleRate;
    const roh = puffer.getChannelData(0);
    const x = roh.subarray(Math.floor(0.5 * sr), roh.length - Math.floor(0.3 * sr)); // Ein-/Ausschwingen weg
    // Frequenz genau bestimmen (Nulldurchgänge über 8 s)
    let null_ = 0; let erster = -1; let letzter = -1;
    for (let i = 1; i < Math.min(x.length, 8 * sr); i++) {
      if (x[i - 1] < 0 && x[i] >= 0) { null_++; if (erster < 0) erster = i; letzter = i; }
    }
    const f = ((null_ - 1) * sr) / (letzter - erster);
    const n = 240; const bl = Math.floor(x.length / n);
    const amps = []; const phs = [];
    for (let b = 0; b < bl; b++) {
      let re = 0; let im = 0;
      for (let i = 0; i < n; i++) {
        const w = (2 * Math.PI * f * (b * n + i)) / sr;
        re += x[b * n + i] * Math.cos(w); im -= x[b * n + i] * Math.sin(w);
      }
      amps.push((2 * Math.hypot(re, im)) / n); phs.push(Math.atan2(im, re));
    }
    // Phase entfalten, gleitender Median als Trend
    for (let i = 1; i < phs.length; i++) {
      while (phs[i] - phs[i - 1] > Math.PI) phs[i] -= 2 * Math.PI;
      while (phs[i] - phs[i - 1] < -Math.PI) phs[i] += 2 * Math.PI;
    }
    const median = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
    const ampMed = median(amps);
    let stoerungen = 0; let letzte = -10;
    for (let i = 0; i < phs.length; i++) {
      const fenster = phs.slice(Math.max(0, i - 10), i + 11);
      if (Math.abs(phs[i] - median(fenster)) > 0.1 || amps[i] < 0.7 * ampMed) {
        if (i - letzte > 3) stoerungen++;
        letzte = i;
      }
    }
    return { f, ampMed, sekunden: x.length / sr, stoerungen };
  }, mp3.toString('base64'));
  console.log(`Sinus ${ergebnis.f.toFixed(2)} Hz, Amplitude ${ergebnis.ampMed.toFixed(3)}, ${ergebnis.sekunden.toFixed(1)} s, Störungen: ${ergebnis.stoerungen}`);
  assert.ok(ergebnis.sekunden > 10, 'Aufnahme zu kurz');
  // ganz vereinzelte Störung durch ausgelastete CI-Rechner tolerieren
  assert.ok(ergebnis.stoerungen <= 1, `${ergebnis.stoerungen} Aussetzer/Sprünge – Knistern`);
  console.log('Knistern-Test OK');
} finally {
  await context.close();
  server.close();
}
