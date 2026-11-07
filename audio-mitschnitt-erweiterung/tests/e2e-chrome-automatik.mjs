// End-to-End in echtem Chromium: Automatik im Popup einschalten, Seite spielt
// Töne ab -> Aufnahme startet von selbst, endet nach Stille, MP3 wird gespeichert.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mp3Frames } from './hilfen.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const erweiterung = resolve(new URL('../dist/chrome', import.meta.url).pathname);
const erweiterungsId = [...createHash('sha256').update(erweiterung).digest('hex').slice(0, 32)]
  .map((z) => String.fromCharCode('a'.charCodeAt(0) + parseInt(z, 16))).join('');

const TESTSEITE = `<!doctype html><meta charset="utf-8"><title>Automatik</title>
<script>
  // 2 s 1000 Hz, 1 s Pause, 2 s 2000 Hz – danach Stille
  window.abspielen = async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const t0 = ctx.currentTime + 0.2;
    for (const [start, dauer, f] of [[0, 2, 1000], [3, 2, 2000]]) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; g.gain.value = 0.4;
      o.connect(g).connect(ctx.destination);
      o.start(t0 + start); o.stop(t0 + start + dauer);
    }
    setTimeout(() => ctx.close(), 5600); // danach ist der Tab nicht mehr hörbar
  };
</script>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(TESTSEITE);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const profil = mkdtempSync(join(tmpdir(), 'mitschnitt-auto-'));
const context = await chromium.launchPersistentContext(profil, {
  headless: false,
  args: [
    `--disable-extensions-except=${erweiterung}`,
    `--load-extension=${erweiterung}`,
    `--allowlisted-extension-id=${erweiterungsId}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ nachStille: 2 }));

  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  const tabId = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${erweiterungsId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById('automatik-text').textContent.includes('diesem Tab'));
  await popup.check('#automatik');
  await popup.waitForFunction(() => document.getElementById('hinweis').textContent.includes('wartet auf Ton'));
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), 'AUTO');
  console.log('Automatik an:', await popup.textContent('#hinweis'));

  await seite.bringToFront();
  await seite.evaluate(() => window.abspielen());
  // Start abwarten (Tab wird hörbar)
  const gestartet = await sw.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      if ((await chrome.action.getBadgeText({})) === 'REC') return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  });
  assert.ok(gestartet, 'Aufnahme startete nicht automatisch');
  console.log('automatisch gestartet');
  await popup.bringToFront();
  await popup.waitForTimeout(1500);
  await popup.screenshot({ path: join(profil, 'popup-automatik.png') });
  console.log(`Screenshot: ${join(profil, 'popup-automatik.png')}`);
  await seite.bringToFront();

  // Ende abwarten: Töne (5,2 s) + 2 s Stille
  const download = await sw.evaluate(async () => {
    for (let i = 0; i < 150; i++) {
      const [d] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
      if (d && d.state === 'complete') return d;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });
  assert.ok(download, 'keine automatisch gespeicherte Datei');
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), 'AUTO');

  await popup.bringToFront();
  await popup.waitForFunction(() => document.getElementById('hinweis').textContent.includes('Automatisch gespeichert'));
  console.log(await popup.textContent('#hinweis'));

  const mp3 = readFileSync(download.filename);
  const dauer = (mp3Frames(mp3).length * 1152) / 48000;
  console.log(`MP3: ${(mp3.length / 1024).toFixed(0)} KB, ${dauer.toFixed(2)} s`);
  // 2 s + 1 s + 2 s; Anfang kann um die Erkennungszeit "hörbar" kürzer sein,
  // die Stille am Ende muss weg sein
  assert.ok(dauer > 3.8 && dauer < 6.2, `Dauer ${dauer}`);

  const verlauf = await seite.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const puffer = await new OfflineAudioContext(1, 8000, 8000).decodeAudioData(bytes.buffer);
    const x = puffer.getChannelData(0); const sr = puffer.sampleRate;
    const energie = (seg, f) => {
      const k = 2 * Math.cos((2 * Math.PI * f) / sr); let s1 = 0; let s2 = 0;
      for (const v of seg) { const s0 = v + k * s1 - s2; s2 = s1; s1 = s0; }
      return s1 * s1 + s2 * s2 - k * s1 * s2;
    };
    const aus = []; const halb = Math.floor(sr / 2);
    for (let s = 0; s + halb <= x.length; s += halb) {
      const seg = x.subarray(s, s + halb); let p = 0;
      for (const v of seg) p = Math.max(p, Math.abs(v));
      aus.push(p < 0.02 ? 'still' : energie(seg, 1000) > energie(seg, 2000) ? 1000 : 2000);
    }
    return aus;
  }, mp3.toString('base64'));
  console.log('Verlauf (je 0,5 s):', verlauf.join(' '));
  const folge = verlauf.filter((v, i) => v !== verlauf[i - 1]).filter((v) => v !== 'still');
  assert.deepEqual(folge, [1000, 2000]);
  assert.ok(verlauf.slice(-1)[0] !== 'still' || verlauf.slice(-2)[0] !== 'still', 'Stille am Ende nicht entfernt');
  console.log('Automatik-E2E OK');
} finally {
  await context.close();
  server.close();
}
