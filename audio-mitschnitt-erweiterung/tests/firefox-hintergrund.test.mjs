// Firefox-Hintergrundseite (src/firefox/background.js) mit nachgebildeter
// WebExtension-API. Wie in echtem Firefox verbindet sich der Abgriff schon
// WÄHREND tabs.executeScript mit der Hintergrundseite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInThisContext } from 'node:vm';
import { aufnahmeModul, Resampler, sinus } from './hilfen.mjs';

const TAB = 42;
const ereignisse = () => {
  const hoerer = [];
  return { addListener: (f) => hoerer.push(f), hoerer };
};

const api = {
  runtime: { onConnect: ereignisse(), onMessage: ereignisse(), getManifest: () => ({ version: 'test' }) },
  tabs: { onUpdated: ereignisse(), onRemoved: ereignisse(), executeScript: null },
  browserAction: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  storage: { local: { get: async () => ({}) } },
  downloads: { onChanged: ereignisse(), download: null },
};

/** Abgriff in der Seite: verbindet sich sofort, wie tap.js in Firefox. */
function abgriffVerbinden(frameId) {
  const vonHintergrund = [];
  const onMessage = ereignisse();
  const onDisconnect = ereignisse();
  let getrennt = false;
  const port = {
    name: 'audio-mitschnitt-abgriff',
    sender: { tab: { id: TAB }, frameId },
    postMessage: (m) => vonHintergrund.push(m),
    disconnect: () => { getrennt = true; },
    onMessage,
    onDisconnect,
  };
  for (const f of api.runtime.onConnect.hoerer) f(port);
  return {
    vonHintergrund,
    get getrennt() { return getrennt; },
    senden: (m) => onMessage.hoerer.forEach((f) => f(m)),
  };
}

const abgriffe = [];
api.tabs.executeScript = async (tabId, { file }) => {
  assert.equal(tabId, TAB);
  if (file === '/firefox/tap.js') abgriffe.push(abgriffVerbinden(0));
  return [undefined];
};
const downloads = [];
api.downloads.download = async (opt) => { downloads.push(opt); return downloads.length; };

globalThis.browser = api;
globalThis.AudioContext = class { constructor() { this.sampleRate = 44100; } close() {} };
const blobs = new Map();
globalThis.URL.createObjectURL = (blob) => { const u = `blob:test/${blobs.size}`; blobs.set(u, blob); return u; };
globalThis.URL.revokeObjectURL = () => {};
void aufnahmeModul; void Resampler; // lädt Aufnahme, Mischer, Resampler, lamejs global
runInThisContext(readFileSync(new URL('../src/firefox/background.js', import.meta.url), 'utf8'));

const nachricht = (m) => Promise.all(api.runtime.onMessage.hoerer.map((f) => f({ ziel: 'hintergrund', ...m })))
  .then((a) => a.find((x) => x !== undefined));
const warten = (ms) => new Promise((r) => setTimeout(r, ms));

test('Abgriff, der sich beim Einfügen verbindet, wird angenommen und aufgenommen', async () => {
  const st = await nachricht({ typ: 'starten', tabId: TAB, bitrate: 128, titel: 'Test' });
  assert.equal(st.fehler, undefined, st.fehler);
  assert.equal(abgriffe.length, 1);
  const abgriff = abgriffe[0];
  assert.deepEqual(abgriff.vonHintergrund, [], 'Hintergrund hat den Abgriff abgewiesen');
  assert.equal(abgriff.getrennt, false);

  // 1,5 s Ton in 44,1 kHz (Standardrate des "Systems"), Aufnahme läuft mit 44,1 kHz
  abgriff.senden({ typ: 'info', erfasst: 1, fremd: 0, blockiert: 0, fehler: 0 });
  abgriff.senden({ typ: 'diag', seite: 'www.youtube.com/watch', oben: true, abgriffFunktion: 'function',
    ctx: 'running 44100 Hz', abgriff: true, elemente: ['video eigen erfasst spielt'], gesendet: 15, fehler: [] });
  let phase = 0;
  for (let i = 0; i < 15; i++) {
    const ton = sinus(4410, { frequenz: 1000, sampleRate: 44100, phase });
    phase += 4410;
    abgriff.senden({ typ: 'pcm', l: ton, r: ton, rate: 44100 });
    await warten(100);
  }
  const status = await nachricht({ typ: 'status' });
  assert.equal(status.laeuft, true);
  assert.match(status.info, /1 Medienquelle/);
  assert.ok(status.pegelDb > -8, `Pegel ${status.pegelDb}`);
  assert.match(status.diagnose, /Eingefügt: tap\.js in 1 Frame\(s\) · verbundene Frames: 1/);
  assert.match(status.diagnose, /Frame 0 \(oben\) www\.youtube\.com\/watch: Kontext running 44100 Hz, Abgriff ja \(function\), Blöcke gesendet 15 \/ empfangen 15/);
  assert.match(status.diagnose, /· video eigen erfasst spielt/);

  const ende = await nachricht({ typ: 'stoppen' });
  assert.equal(ende.laeuft, false);
  assert.deepEqual(abgriff.vonHintergrund, [{ typ: 'stopp' }]);
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].filename, /^Mitschnitte\/Mitschnitt_.*\.mp3$/);

  // Inhalt prüfen: MP3 darf nicht still sein
  const blob = blobs.get(downloads[0].url);
  const mp3 = Buffer.from(await blob.arrayBuffer());
  assert.ok(mp3.length > 10000, `MP3 zu klein: ${mp3.length}`);
});

test('Status nach dem Stoppen und erneuter Start funktionieren', async () => {
  const vorher = abgriffe.length;
  const st = await nachricht({ typ: 'starten', tabId: TAB, bitrate: 128, titel: 'Test' });
  assert.equal(st.fehler, undefined, st.fehler);
  assert.equal(abgriffe.length, vorher + 1);
  assert.deepEqual(abgriffe.at(-1).vonHintergrund, []);
  await nachricht({ typ: 'stoppen' });
});

test('Browser-interne Seite: klare Meldung, keine hängende Aufnahme', async () => {
  const original = api.tabs.executeScript;
  api.tabs.executeScript = async () => { throw new Error('Missing host permission for the tab'); };
  try {
    const st = await nachricht({ typ: 'starten', tabId: TAB, bitrate: 128, titel: 'about:config' });
    assert.match(st.fehler, /Browser-interne Seite/);
    assert.equal((await nachricht({ typ: 'status' })).laeuft, false);
  } finally {
    api.tabs.executeScript = original;
  }
});
