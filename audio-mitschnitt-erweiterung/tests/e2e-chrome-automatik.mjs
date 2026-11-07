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

async function verlaufAnalysieren(seite, mp3) {
  return seite.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const puffer = await new OfflineAudioContext(1, 8000, 8000).decodeAudioData(bytes.buffer);
    const x = puffer.getChannelData(0); const sr = puffer.sampleRate;
    const energie = (seg, f) => {
      const k = 2 * Math.cos((2 * Math.PI * f) / sr); let s1 = 0; let s2 = 0;
      for (const v of seg) { const s0 = v + k * s1 - s2; s2 = s1; s1 = s0; }
      return s1 * s1 + s2 * s2 - k * s1 * s2;
    };
    const aus = []; const viertel = Math.floor(sr / 4);
    for (let s = 0; s + viertel <= x.length; s += viertel) {
      const seg = x.subarray(s, s + viertel); let p = 0;
      for (const v of seg) p = Math.max(p, Math.abs(v));
      aus.push(p < 0.02 ? 'still' : energie(seg, 1000) > energie(seg, 2000) ? 1000 : 2000);
    }
    return aus;
  }, mp3.toString('base64'));
}

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');

  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  const tabId = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${erweiterungsId}/popup/popup.html?tab=${tabId}`);
  await popup.waitForFunction(() => document.getElementById('automatik-text').textContent.includes('diesem Tab'));
  // Werte über die Eingabefelder setzen (Komma wie bei deutscher Eingabe)
  await popup.click('#einstellungen summary');
  await popup.fill('#nach-stille', '0.5');
  await popup.fill('#mindest-ton', '1');
  await popup.locator('#mindest-ton').blur();
  const gespeichert = await sw.evaluate(() => chrome.storage.local.get(['nachStille', 'mindestTon']));
  assert.deepEqual(gespeichert, { nachStille: 0.5, mindestTon: 1 });
  await popup.fill('#nach-stille', '0.1'); // unter Minimum -> 0,5
  await popup.locator('#nach-stille').blur();
  assert.equal(await popup.inputValue('#nach-stille'), '0.5');
  assert.equal((await sw.evaluate(() => chrome.storage.local.get('nachStille'))).nachStille, 0.5);

  await popup.check('#automatik');
  await popup.waitForFunction(() => document.getElementById('hinweis').textContent.includes('wartet auf Ton'));
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), 'AUTO');
  console.log('Automatik an:', await popup.textContent('#hinweis'));

  await seite.bringToFront();
  await seite.evaluate(() => window.abspielen());
  const rec = await sw.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      if ((await chrome.action.getBadgeText({})) === 'REC') return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  });
  assert.ok(rec, 'Aufnahme startete nicht automatisch');
  console.log('automatisch gestartet');
  await popup.bringToFront();
  await popup.waitForTimeout(1200);
  await popup.screenshot({ path: join(profil, 'popup-automatik.png') });
  console.log(`Screenshot: ${join(profil, 'popup-automatik.png')}`);
  await seite.bringToFront();

  // zwei Dateien: Ton 1 (vor der 1-s-Pause) und Ton 2
  const dateien = await sw.evaluate(async () => {
    for (let i = 0; i < 150; i++) {
      const d = (await chrome.downloads.search({ orderBy: ['startTime'] })).filter((x) => x.state === 'complete');
      if (d.length >= 2) return d;
      await new Promise((r) => setTimeout(r, 100));
    }
    return (await chrome.downloads.search({})).filter((x) => x.state === 'complete');
  });
  assert.equal(dateien.length, 2, `erwartet 2 Dateien, erhalten ${dateien.length}`);

  // Aufnahme wartet weiter (Tab-Aufnahme offen), Symbol AUTO
  await popup.bringToFront();
  await popup.waitForFunction(() => document.getElementById('hinweis').textContent.includes('Automatisch gespeichert'));
  console.log(await popup.textContent('#hinweis'));
  const st = await popup.evaluate(() => chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'status' }));
  assert.equal(st.laeuft, true);
  assert.equal(st.wartetAufTon, true);
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), 'AUTO');

  const erwartet = [1000, 2000];
  for (const [i, d] of dateien.entries()) {
    const mp3 = readFileSync(d.filename);
    const dauer = (mp3Frames(mp3).length * 1152) / 48000;
    const verlauf = await verlaufAnalysieren(seite, mp3);
    console.log(`Datei ${i + 1}: ${dauer.toFixed(2)} s · ${verlauf.join(' ')}`);
    assert.ok(dauer > 1.6 && dauer < 2.8, `Datei ${i + 1} Dauer ${dauer}`);
    const toene = [...new Set(verlauf.filter((v) => v !== 'still'))];
    assert.deepEqual(toene, [erwartet[i]], `Datei ${i + 1} enthält ${toene}`);
    assert.ok(verlauf.filter((v) => v === 'still').length <= 1, `Datei ${i + 1}: zu viel Stille`);
  }

  // Automatik aus: wartende Aufnahme endet, keine leere Datei
  await popup.uncheck('#automatik');
  await popup.waitForFunction(async () => {
    const s = await chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'status' });
    return !s.laeuft;
  });
  await popup.waitForTimeout(500);
  const alle = await sw.evaluate(async () => (await chrome.downloads.search({})).length);
  assert.equal(alle, 2, 'beim Ausschalten wurde eine (leere) Datei gespeichert');
  assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '');
  console.log('Automatik-E2E OK');
} finally {
  await context.close();
  server.close();
}
