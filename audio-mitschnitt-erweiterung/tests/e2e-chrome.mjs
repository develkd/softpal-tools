// End-to-End-Test in echtem Chromium: Erweiterung laden, Testseite mit Tönen
// abspielen, über das Popup aufnehmen, MP3 prüfen.
// Aufruf: npm run test:e2e   (braucht Playwright + Chromium; unter Linux ohne
// Bildschirm mit xvfb-run starten)
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
// ID entpackter Erweiterungen = SHA-256 des Pfads, Hex 0-f als a-p
const erweiterungsId = [...createHash('sha256').update(erweiterung).digest('hex').slice(0, 32)]
  .map((z) => String.fromCharCode('a'.charCodeAt(0) + parseInt(z, 16))).join('');

const TESTSEITE = `<!doctype html><meta charset="utf-8"><title>Tontest</title>
<button id="los">los</button>
<script>
  // 1 s Stille, 2 s 1000 Hz, 1 s Stille, 2 s 2000 Hz – per Web Audio
  window.abspielen = async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    const t0 = ctx.currentTime + 1;
    for (const [start, dauer, f] of [[0, 2, 1000], [3, 2, 2000]]) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; g.gain.value = 0.4;
      o.connect(g).connect(ctx.destination);
      o.start(t0 + start); o.stop(t0 + start + dauer);
    }
    return ctx.state;
  };
</script>`;

// MP3 im Browser dekodieren (kein ffmpeg nötig) und je 0,5 s einordnen:
// 'still', 1000 oder 2000 (stärkerer Ton per Goertzel)
async function frequenzVerlauf(seite, mp3) {
  return seite.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const puffer = await new OfflineAudioContext(1, 8000, 8000).decodeAudioData(bytes.buffer);
    const x = puffer.getChannelData(0);
    const sr = puffer.sampleRate;
    const energie = (seg, f) => {
      const k = 2 * Math.cos((2 * Math.PI * f) / sr);
      let s1 = 0; let s2 = 0;
      for (const v of seg) { const s0 = v + k * s1 - s2; s2 = s1; s1 = s0; }
      return s1 * s1 + s2 * s2 - k * s1 * s2;
    };
    const verlauf = [];
    const halb = Math.floor(sr / 2);
    for (let start = 0; start + halb <= x.length; start += halb) {
      const seg = x.subarray(start, start + halb);
      let spitze = 0;
      for (const v of seg) spitze = Math.max(spitze, Math.abs(v));
      if (spitze < 0.02) verlauf.push('still');
      else verlauf.push(energie(seg, 1000) > energie(seg, 2000) ? 1000 : 2000);
    }
    return verlauf;
  }, mp3.toString('base64'));
}

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(TESTSEITE);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const seitenUrl = `http://127.0.0.1:${server.address().port}/`;

const profil = mkdtempSync(join(tmpdir(), 'mitschnitt-profil-'));
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
  assert.equal(new URL(sw.url()).host, erweiterungsId, 'Erweiterungs-ID stimmt nicht');

  const seite = await context.newPage();
  await seite.goto(seitenUrl);
  // ohne "tabs"-Berechtigung keine URLs sichtbar -> jüngster Tab ist die Testseite
  const tabId = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${erweiterungsId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById('tab-titel').textContent !== '…');
  await popup.click('#start');
  await popup.waitForFunction(() => document.getElementById('start').textContent.includes('Beenden'),
    null, { timeout: 10000 }).catch(async () => {
    throw new Error(`Start fehlgeschlagen: ${await popup.textContent('#hinweis')}`);
  });
  const abzeichen = await sw.evaluate(() => chrome.action.getBadgeText({}));
  assert.equal(abzeichen, 'REC');

  await seite.bringToFront();
  assert.equal(await seite.evaluate(() => window.abspielen()), 'running');
  await seite.waitForTimeout(7000);

  await popup.bringToFront();
  await popup.waitForFunction(() => document.getElementById('groesse').textContent !== '');
  console.log('Popup während der Aufnahme:', await popup.textContent('#zeit'), await popup.textContent('#groesse'));
  await popup.screenshot({ path: join(profil, 'popup.png') });
  await popup.click('#start');
  await popup.waitForFunction(() => document.getElementById('hinweis').textContent.startsWith('Gespeichert'),
    null, { timeout: 10000 });
  console.log(await popup.textContent('#hinweis'));

  // Download abwarten und Datei lesen
  const download = await sw.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const [d] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
      if (d && d.state !== 'in_progress') return d;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });
  assert.ok(download, 'kein Download');
  assert.equal(download.state, 'complete', JSON.stringify(download));
  // Playwright legt Downloads unter einer GUID ab; sonst muss der Name stimmen
  if (!download.filename.includes('playwright-artifacts')) {
    assert.match(download.filename, /Mitschnitte[\\/]Mitschnitt_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d.*\.mp3$/);
  }
  assert.equal(download.mime, 'audio/mpeg');
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '');

  const mp3 = readFileSync(download.filename);
  const frames = mp3Frames(mp3);
  const dauer = (frames.length * 1152) / 48000;
  console.log(`MP3: ${download.filename.split('/').pop()}, ${(mp3.length / 1024).toFixed(0)} KB, ${dauer.toFixed(2)} s`);
  assert.ok(frames.every((f) => f.sampleRate === 48000 && f.kanaele === 2 && f.bitrate === 192));
  assert.ok(dauer > 7 && dauer < 9.5, `Dauer ${dauer}`);

  const verlauf = await frequenzVerlauf(seite, mp3);
  console.log('Verlauf (je 0,5 s):', verlauf.join(' '));
  const folge = verlauf.filter((v, i) => v !== verlauf[i - 1]); // Wiederholungen zusammenfassen
  assert.deepEqual(folge.filter((v) => v !== 'still'), [1000, 2000], 'Töne fehlen oder falsch');
  assert.equal(verlauf.filter((v) => v === 1000).length >= 3, true);
  assert.equal(verlauf.filter((v) => v === 2000).length >= 3, true);
  console.log(`E2E OK (Screenshot: ${join(profil, 'popup.png')})`);
} finally {
  await context.close();
  server.close();
}
