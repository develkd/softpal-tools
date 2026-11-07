// Firefox-Hintergrundseite (src/firefox/background.js) mit nachgebildeter
// WebExtension-API. Wie in echtem Firefox verbindet sich der Abgriff schon
// WÄHREND tabs.executeScript mit der Hintergrundseite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInThisContext } from 'node:vm';
import { aufnahmeModul, Resampler, sinus } from './hilfen.mjs';

const TAB = 42;
const speicher = {};
const ereignisse = () => {
  const hoerer = [];
  return { addListener: (f) => hoerer.push(f), hoerer };
};

const api = {
  runtime: { onConnect: ereignisse(), onMessage: ereignisse(), getManifest: () => ({ version: 'test' }) },
  tabs: { onUpdated: ereignisse(), onRemoved: ereignisse(), executeScript: null, query: async () => [] },
  browserAction: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  storage: { local: { get: async () => ({ ...speicher }) }, onChanged: ereignisse() },
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

// ---- Automatik ------------------------------------------------------------
async function einstellen(werte) {
  Object.assign(speicher, werte);
  await Promise.all(api.storage.onChanged.hoerer.map((f) => f({}, 'local')));
}
const hoerbar = (an) => api.tabs.onUpdated.hoerer.forEach((f) => f(TAB, { audible: an },
  { id: TAB, url: 'https://www.youtube.com/watch?v=x', title: 'Video' }));

async function tonLiefern(abgriff, sekunden, ton = true) {
  let phase = 0;
  for (let i = 0; i < Math.round(sekunden * 10); i++) {
    const block = ton ? sinus(4410, { frequenz: 1000, sampleRate: 44100, phase }) : new Float32Array(4410);
    phase += 4410;
    abgriff.senden({ typ: 'pcm', l: block, r: block, rate: 44100 });
    await warten(100);
  }
}

test('Automatik: startet bei Ton, speichert nach Stille ohne Stille am Ende', async () => {
  await einstellen({ automatik: true, nachStille: 0.6 });
  const vorherAbgriffe = abgriffe.length;
  const vorherDownloads = downloads.length;
  hoerbar(true);
  await warten(50);
  assert.equal(abgriffe.length, vorherAbgriffe + 1, 'Aufnahme nicht automatisch gestartet');
  const abgriff = abgriffe.at(-1);
  let st = await nachricht({ typ: 'status' });
  assert.equal(st.laeuft, true);
  assert.equal(st.automatisch, true);

  await tonLiefern(abgriff, 3.5);
  await tonLiefern(abgriff, 1.5, false); // Stille -> beendet nach 0,6 s
  await warten(200);
  st = await nachricht({ typ: 'status' });
  assert.equal(st.laeuft, false, 'nicht automatisch beendet');
  assert.match(st.letzteMeldung, /Automatisch gespeichert/);
  assert.equal(downloads.length, vorherDownloads + 1);
  const mp3 = Buffer.from(await blobs.get(downloads.at(-1).url).arrayBuffer());
  const { mp3Frames } = await import('./hilfen.mjs');
  const dauer = (mp3Frames(mp3).length * 1152) / 44100;
  assert.ok(dauer > 3.0 && dauer < 4.3, `Dauer ${dauer} (Stille am Ende nicht entfernt?)`);

  // derselbe Tab ist weiter "hörbar": nicht sofort neu starten
  hoerbar(true);
  await warten(50);
  assert.equal((await nachricht({ typ: 'status' })).laeuft, false);
});

test('Automatik: kurzer Ton wird verworfen; nach Stille startet der Tab wieder', async () => {
  const vorherDownloads = downloads.length;
  hoerbar(false); // Sperre aufheben
  hoerbar(true);
  await warten(50);
  const abgriff = abgriffe.at(-1);
  assert.equal((await nachricht({ typ: 'status' })).laeuft, true);
  await tonLiefern(abgriff, 1);
  await tonLiefern(abgriff, 1.5, false);
  await warten(200);
  const st = await nachricht({ typ: 'status' });
  assert.equal(st.laeuft, false);
  assert.match(st.letzteMeldung, /verworfen/);
  assert.equal(downloads.length, vorherDownloads, 'kurze Aufnahme wurde gespeichert');
});

test('Automatik aus: hörbarer Tab startet nichts', async () => {
  await einstellen({ automatik: false });
  const vorher = abgriffe.length;
  hoerbar(false);
  hoerbar(true);
  await warten(50);
  assert.equal(abgriffe.length, vorher);
  assert.equal((await nachricht({ typ: 'status' })).automatik, false);
});
