// End-to-End in echtem Chromium: Video-Aufnahme über das Popup starten und
// beenden; die MP4 muss Bild (640×360) und Ton in passender Länge enthalten,
// im Browser abspielbar und lippensynchron sein. Das Testvideo zeigt jede
// Sekunde einen weißen Blitz und piept gleichzeitig (1000 Hz, 0,12 s).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// Im echten Gebrauch erlaubt der Klick aufs Symbol (activeTab) das Einfügen in die
// Seite. Den Klick kann der Test nicht auslösen; deshalb eine Kopie der
// Erweiterung mit Zugriff auf den lokalen Testserver laden.
const erweiterung = join(mkdtempSync(join(tmpdir(), 'erw-video-')), 'chrome');
cpSync(resolve(new URL('../dist/chrome', import.meta.url).pathname), erweiterung, { recursive: true });
const manifest = JSON.parse(readFileSync(join(erweiterung, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
writeFileSync(join(erweiterung, 'manifest.json'), JSON.stringify(manifest));
const id = [...createHash('sha256').update(erweiterung).digest('hex').slice(0, 32)]
  .map((z) => String.fromCharCode('a'.charCodeAt(0) + parseInt(z, 16))).join('');
const testvideo = readFileSync(new URL('fixtures/testvideo.webm', import.meta.url));

const server = createServer((q, r) => {
  if (q.url === '/testvideo.webm') {
    r.writeHead(200, { 'content-type': 'video/webm', 'content-length': testvideo.length });
    r.end(testvideo);
    return;
  }
  r.writeHead(200, { 'content-type': 'text/html' });
  r.end(`<!doctype html><title>Videotest</title><h1>Seite mit Video</h1>
    <video id="v" src="/testvideo.webm" loop muted playsinline width="640" height="360"></video>`);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'video-')), {
  headless: false,
  viewport: { width: 1000, height: 700 },
  args: [`--disable-extensions-except=${erweiterung}`, `--load-extension=${erweiterung}`,
    `--allowlisted-extension-id=${id}`, '--autoplay-policy=no-user-gesture-required'],
});
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const seite = await context.newPage();
  await seite.goto(`http://127.0.0.1:${server.address().port}/`);
  await seite.evaluate(async () => {
    const v = document.getElementById('v');
    v.muted = false;
    await v.play();
  });
  const tab = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup/popup.html?tab=${tab}`);
  await popup.click('#video-start');
  await popup.waitForFunction(() => document.getElementById('video-start').textContent.includes('beenden'), null, { timeout: 15000 })
    .catch(async () => { throw new Error(`Video-Start fehlgeschlagen: ${await popup.textContent('#video-info')}`); });
  await popup.waitForFunction(() => /\d+×\d+/.test(document.getElementById('video-info').textContent));
  const info = await popup.textContent('#video-info');
  console.log('Video läuft:', info);
  assert.match(info, /^640×360 · H\.264 · (AAC|Opus)/);
  // Diagnose auch in Chrome
  await popup.waitForFunction(() => !document.getElementById('diagnose').hidden);
  const diagnose = await popup.textContent('#diagnose-text');
  assert.match(diagnose, /Audio-Mitschnitt [\d.]+ · Chrome/);
  assert.match(diagnose, /Video: laeuft · 640×360 H\.264/);
  assert.match(diagnose, /Video-Kandidaten: 127\.0\.0\.1:\d+: 640×360 spielt \[WebCodecs ja, MP4 ja/);

  await seite.bringToFront();
  await seite.waitForTimeout(4500);
  await popup.bringToFront();
  console.log('Popup:', await popup.textContent('#video-zeit'));
  await popup.screenshot({ path: join(tmpdir(), 'popup-video.png') });
  await popup.click('#video-start');
  await popup.waitForFunction(() => document.getElementById('video-info').textContent.startsWith('Gespeichert'), null, { timeout: 30000 })
    .catch(async () => { throw new Error(`Speichern fehlgeschlagen: ${await popup.textContent('#video-info')}`); });
  const gespeichert = await popup.textContent('#video-info');
  console.log(gespeichert);
  assert.match(gespeichert, /\.mp4 \(/);

  const download = await sw.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const [d] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
      if (d && d.state === 'complete') return d;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });
  assert.ok(download, 'kein Download');
  const mp4 = readFileSync(download.filename);
  assert.equal(mp4.subarray(4, 8).toString('latin1'), 'ftyp', 'keine MP4-Datei');
  writeFileSync(join(tmpdir(), 'audio-mitschnitt-letztes-video.mp4'), mp4); // zum Nachsehen

  // im Browser prüfen: abspielbar, Maße, Dauer, Ton, Lippensynchronität
  const pruefung = await seite.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    const v = document.createElement('video');
    v.muted = true;
    v.src = url;
    await new Promise((ja, nein) => { v.onloadedmetadata = ja; v.onerror = () => nein(new Error(`nicht abspielbar: ${v.error && v.error.message}`)); });
    // Blitze: jedes Bild abspielen, Helligkeit messen (Zeit = mediaTime)
    const leinwand = new OffscreenCanvas(32, 18);
    const zeichner = leinwand.getContext('2d', { willReadFrequently: true });
    const hell = [];
    await new Promise((fertig) => {
      const bild = (_, meta) => {
        zeichner.drawImage(v, 0, 0, 32, 18);
        const d = zeichner.getImageData(0, 0, 32, 18).data;
        let summe = 0;
        for (let i = 0; i < d.length; i += 4) summe += d[i] + d[i + 1] + d[i + 2];
        hell.push([meta.mediaTime, summe / (d.length / 4) / 3]);
        if (!v.ended) v.requestVideoFrameCallback(bild);
      };
      v.requestVideoFrameCallback(bild);
      v.onended = () => setTimeout(fertig, 100);
      v.play();
    });
    const blitze = hell.filter(([, h], i) => h > 200 && (i === 0 || hell[i - 1][1] <= 200)).map(([t]) => t);
    // Pieptöne aus dem Ton
    const puffer = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(bytes.buffer.slice(0));
    const x = puffer.getChannelData(0);
    const sr = puffer.sampleRate;
    const toene = [];
    let spitze = 0;
    let an = false;
    for (let i = 0; i < x.length; i += 48) { // 1-ms-Schritte
      let m = 0;
      for (let k = i; k < Math.min(i + 48, x.length); k++) m = Math.max(m, Math.abs(x[k]));
      spitze = Math.max(spitze, m);
      if (!an && m > 0.1) { toene.push(i / sr); an = true; } else if (an && m < 0.02) an = false;
    }
    return { breite: v.videoWidth, hoehe: v.videoHeight, dauer: v.duration, bilder: hell.length, blitze, toene, tonSpitze: spitze };
  }, mp4.toString('base64'));
  const versatz = pruefung.blitze.map((b) => {
    const t = pruefung.toene.reduce((x, y) => (Math.abs(y - b) < Math.abs(x - b) ? y : x), Infinity);
    return Math.round((t - b) * 1000);
  });
  console.log(`MP4: ${(mp4.length / 1024).toFixed(0)} KB, ${pruefung.breite}×${pruefung.hoehe}, ${pruefung.dauer.toFixed(2)} s, ` +
    `${pruefung.bilder} Bilder, Ton-Spitze ${pruefung.tonSpitze.toFixed(2)}`);
  console.log('Versatz Ton–Bild je Blitz (ms):', versatz.join(' '));
  assert.equal(pruefung.breite, 640);
  assert.equal(pruefung.hoehe, 360);
  assert.ok(pruefung.dauer > 3.5 && pruefung.dauer < 7, `Dauer ${pruefung.dauer}`);
  assert.ok(pruefung.bilder > 80, `nur ${pruefung.bilder} Bilder`);
  // Testvideo: Piepton mit −8,6 dBFS Spitze (≈ 0,37); Pegel muss erhalten bleiben
  assert.ok(pruefung.tonSpitze > 0.25 && pruefung.tonSpitze < 0.5, `Tonpegel ${pruefung.tonSpitze}`);
  assert.ok(pruefung.blitze.length >= 3 && pruefung.toene.length >= 3, 'Blitze/Pieptöne nicht gefunden');
  const mittel = versatz.reduce((a, b) => a + b, 0) / versatz.length;
  assert.ok(Math.abs(mittel) < 60, `Ton und Bild im Mittel ${mittel.toFixed(0)} ms versetzt`);
  assert.ok(versatz.every((d) => Math.abs(d) < 110), `Ton und Bild zu weit versetzt: ${versatz}`);
  console.log('Video-E2E OK');
} finally {
  await context.close();
  server.close();
}
