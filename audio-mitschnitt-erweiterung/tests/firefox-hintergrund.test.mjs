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
let tabTitel = 'Video';
let ablehnen = null; // Dateiname, den downloads.download ablehnen soll
const ereignisse = () => {
  const hoerer = [];
  return { addListener: (f) => hoerer.push(f), hoerer };
};

const api = {
  runtime: { onConnect: ereignisse(), onMessage: ereignisse(), getManifest: () => ({ version: 'test' }) },
  tabs: { onUpdated: ereignisse(), onRemoved: ereignisse(), executeScript: null, query: async () => [],
    get: async (id) => ({ id, title: tabTitel }) },
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
const videoPorts = [];
/** Video-Skript (lib/video.js) in einem Frame: verbindet sich und meldet sein Video. */
function videoVerbinden(frameId, kandidat) {
  const an = [];
  const nachricht = ereignisse();
  const getrennt = ereignisse();
  const port = {
    name: 'audio-mitschnitt-video', sender: { tab: { id: TAB }, frameId },
    postMessage: (m) => an.push(m), disconnect() {}, onMessage: nachricht, onDisconnect: getrennt,
  };
  for (const f of api.runtime.onConnect.hoerer) f(port);
  const v = { an, senden: (m) => nachricht.hoerer.forEach((f) => f(m)) };
  v.senden({ typ: 'kandidat', ...kandidat });
  videoPorts.push(v);
  return v;
}
api.tabs.executeScript = async (tabId, { file }) => {
  assert.equal(tabId, TAB);
  if (file === '/lib/video.js') {
    videoVerbinden(0, { flaeche: 50000, spielt: true });
    videoVerbinden(3, { flaeche: 0, spielt: false }); // Frame ohne Video
  }
  if (file === '/firefox/tap.js') abgriffe.push(abgriffVerbinden(0));
  return [undefined];
};
const downloads = [];
api.downloads.download = async (opt) => {
  if (ablehnen && opt.filename.endsWith(ablehnen)) throw new Error('Invalid filename');
  downloads.push(opt);
  return downloads.length;
};

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
  assert.equal(downloads[0].filename, 'Mitschnitte/Test.mp3', 'Dateiname nicht aus dem Tabtitel');
  assert.equal(ende.gespeichert, 'Test.mp3');

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

async function mp3Dauer(download) {
  const { mp3Frames } = await import('./hilfen.mjs');
  const mp3 = Buffer.from(await blobs.get(download.url).arrayBuffer());
  return (mp3Frames(mp3).length * 1152) / 44100;
}

test('Automatik: startet bei Ton, teilt nach 0,5 s Stille in Dateien, nächster Ton sofort', async () => {
  await einstellen({ automatik: true, nachStille: 0.5, mindestTon: 1 });
  const vorherAbgriffe = abgriffe.length;
  const vorherDownloads = downloads.length;
  hoerbar(true);
  await warten(50);
  assert.equal(abgriffe.length, vorherAbgriffe + 1, 'Aufnahme nicht automatisch gestartet');
  const abgriff = abgriffe.at(-1);
  let st = await nachricht({ typ: 'status' });
  assert.equal(st.laeuft, true);
  assert.equal(st.automatisch, true);

  await tonLiefern(abgriff, 2); // Titel 1
  await tonLiefern(abgriff, 1, false); // 1 s Pause -> Datei 1 fertig
  st = await nachricht({ typ: 'status' });
  assert.equal(downloads.length, vorherDownloads + 1, 'Datei 1 nicht gespeichert');
  assert.equal(st.laeuft, true, 'Aufnahme sollte bereit bleiben');
  assert.equal(st.wartetAufTon, true);
  assert.match(st.letzteMeldung, /Automatisch gespeichert: .* – wartet auf Ton/);
  assert.equal(abgriffe.length, vorherAbgriffe + 1, 'Abgriff sollte verbunden bleiben');
  assert.deepEqual(abgriff.vonHintergrund, []);

  await tonLiefern(abgriff, 2); // Titel 2 über denselben Abgriff
  await tonLiefern(abgriff, 1, false);
  assert.equal(downloads.length, vorherDownloads + 2, 'Datei 2 nicht gespeichert');

  const d1 = await mp3Dauer(downloads.at(-2));
  const d2 = await mp3Dauer(downloads.at(-1));
  assert.ok(d1 > 1.7 && d1 < 2.6, `Datei 1: ${d1} s`);
  assert.ok(d2 > 1.7 && d2 < 2.6, `Datei 2: ${d2} s (Stille davor/danach nicht entfernt?)`);
});

test('Automatik: zu kurzer Ton wird verworfen, Aufnahme wartet weiter', async () => {
  await einstellen({ mindestTon: 3 });
  const abgriff = abgriffe.at(-1);
  const vorherDownloads = downloads.length;
  await tonLiefern(abgriff, 1);
  await tonLiefern(abgriff, 1, false);
  const st = await nachricht({ typ: 'status' });
  assert.equal(downloads.length, vorherDownloads, 'kurze Aufnahme wurde gespeichert');
  assert.match(st.letzteMeldung, /verworfen/);
  assert.equal(st.laeuft, true);
  assert.equal(st.wartetAufTon, true);
});

test('Automatik aus: wartende Aufnahme endet ohne leere Datei; hörbarer Tab startet nichts', async () => {
  const vorherDownloads = downloads.length;
  await einstellen({ automatik: false });
  const st = await nachricht({ typ: 'status' });
  assert.equal(st.laeuft, false);
  assert.equal(downloads.length, vorherDownloads, 'leere Datei gespeichert');
  const vorher = abgriffe.length;
  hoerbar(false);
  hoerbar(true);
  await warten(50);
  assert.equal(abgriffe.length, vorher);
  assert.equal((await nachricht({ typ: 'status' })).automatik, false);
});

test('Einstellung "nachStille" wird auf mindestens 0,5 s begrenzt', async () => {
  await einstellen({ automatik: true, nachStille: 0.1 });
  hoerbar(false);
  hoerbar(true);
  await warten(50);
  const abgriff = abgriffe.at(-1);
  const vorherDownloads = downloads.length;
  await einstellen({ mindestTon: 0 });
  await tonLiefern(abgriff, 1);
  await tonLiefern(abgriff, 0.4, false); // 0,4 s Stille: bei Grenze 0,5 s noch nicht fertig
  assert.equal(downloads.length, vorherDownloads, 'Grenze 0,5 s nicht beachtet');
  await tonLiefern(abgriff, 0.2, false);
  assert.equal(downloads.length, vorherDownloads + 1);
  await einstellen({ automatik: false });
});

test('Automatik/Playlist: jede Datei heißt wie der Titel beim ersten Ton', async () => {
  await einstellen({ automatik: true, nachStille: 0.5, mindestTon: 1 });
  tabTitel = '(2) Titel Eins - YouTube';
  hoerbar(false);
  hoerbar(true);
  await warten(50);
  const abgriff = abgriffe.at(-1);
  const vorher = downloads.length;
  await tonLiefern(abgriff, 1.5);
  tabTitel = 'Titel Zwei - YouTube'; // nächstes Video lädt während der Pause
  await tonLiefern(abgriff, 1, false);
  await tonLiefern(abgriff, 1.5);
  await tonLiefern(abgriff, 1, false);
  const namen = downloads.slice(vorher).map((d) => d.filename);
  assert.deepEqual(namen, ['Mitschnitte/Titel Eins.mp3', 'Mitschnitte/Titel Zwei.mp3']);
});

test('lehnt der Browser Umlaute ab, wird der ASCII-Titel verwendet', async () => {
  const abgriff = abgriffe.at(-1);
  tabTitel = 'Größe – Live';
  ablehnen = 'Größe – Live.mp3';
  const vorher = downloads.length;
  await tonLiefern(abgriff, 1.5);
  await tonLiefern(abgriff, 1, false);
  ablehnen = null;
  assert.deepEqual(downloads.slice(vorher).map((d) => d.filename), ['Mitschnitte/Groesse - Live.mp3']);
});

test('lehnt der Browser den Titel-Dateinamen ab, wird Datum/Uhrzeit verwendet', async () => {
  const abgriff = abgriffe.at(-1);
  tabTitel = 'Abgelehnt';
  ablehnen = 'Abgelehnt.mp3';
  const vorher = downloads.length;
  await tonLiefern(abgriff, 1.5);
  await tonLiefern(abgriff, 1, false);
  ablehnen = null;
  assert.equal(downloads.length, vorher + 1);
  assert.match(downloads.at(-1).filename, /^Mitschnitte\/Mitschnitt_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.mp3$/);
  await einstellen({ automatik: false });
});

test('Video: Start, Daten, Stopp -> MP4 unter dem Tabtitel gespeichert', async () => {
  tabTitel = 'Video';
  const vorher = downloads.length;
  const start = nachricht({ typ: 'videoStarten', tabId: TAB, titel: '(2) Mein Video - YouTube' });
  await warten(500); // Kandidaten sammeln (400 ms)
  const [mitVideo, ohneVideo] = videoPorts.slice(-2);
  assert.deepEqual(mitVideo.an, [{ typ: 'start' }]);
  assert.deepEqual(ohneVideo.an, [{ typ: 'abbruch' }]);
  mitVideo.senden({ typ: 'gestartet', breite: 1280, hoehe: 720, video: 'H.264', audio: 'Opus' });
  const st = await start;
  assert.ok(!st.fehler, st.fehler);
  assert.equal(st.zustand, 'laeuft');
  mitVideo.senden({ typ: 'daten', b64: Buffer.from('ftypisom').toString('base64') });
  mitVideo.senden({ typ: 'status', sekunden: 1.5, bilder: 45, verworfen: 0 });
  const status = await nachricht({ typ: 'status' });
  assert.equal(status.video.laeuft, true);
  assert.equal(status.video.breite, 1280);
  assert.equal(status.video.bytes, 8);
  const stopp = nachricht({ typ: 'videoStoppen' });
  await warten(10);
  assert.deepEqual(mitVideo.an.at(-1), { typ: 'stopp' });
  mitVideo.senden({ typ: 'ende', sekunden: 1.6 });
  const erg = await stopp;
  assert.equal(erg.gespeichert, 'Mein Video.mp4');
  assert.equal(downloads.length, vorher + 1);
  assert.equal(downloads.at(-1).filename, 'Mitschnitte/Mein Video.mp4');
  assert.equal(await blobs.get(downloads.at(-1).url).text(), 'ftypisom');
  assert.equal((await nachricht({ typ: 'status' })).video.laeuft, false);
});
