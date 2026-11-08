import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VideoSammler } from './hilfen.mjs';

const warten = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s).toString('base64');

/** Nachgebildeter Port eines Video-Skripts in einem Frame. */
function port(kandidat) {
  const an = [];
  const hoerer = { nachricht: [], getrennt: [] };
  const p = {
    name: 'audio-mitschnitt-video',
    an,
    getrennt: false,
    postMessage: (m) => an.push(m),
    disconnect() { p.getrennt = true; },
    onMessage: { addListener: (f) => hoerer.nachricht.push(f) },
    onDisconnect: { addListener: (f) => hoerer.getrennt.push(f) },
    senden: (m) => hoerer.nachricht.forEach((f) => f(m)),
    trennenVonSeite: () => hoerer.getrennt.forEach((f) => f()),
  };
  if (kandidat) setTimeout(() => p.senden({ typ: 'kandidat', ...kandidat }), 5);
  return p;
}

test('wählt das spielende, größte Video und sammelt die Daten bis zum Ende', async () => {
  const gespeichert = [];
  const s = new VideoSammler({
    wartezeit: 30,
    beiFertig: async (blob, info) => { gespeichert.push({ text: await blob.text(), info }); return 'Video.mp4'; },
  });
  const bereit = s.vorbereiten({ titel: 'Test', tabId: 1 });
  const klein = port({ flaeche: 100, spielt: true });
  const gross = port({ flaeche: 5000, spielt: true });
  const pausiert = port({ flaeche: 90000, spielt: false });
  const leer = port({ flaeche: 0, spielt: false });
  for (const p of [klein, gross, pausiert, leer]) assert.equal(s.portAnnehmen(p), true);
  assert.equal(s.portAnnehmen({ name: 'anderer-port' }), false);
  await warten(60);
  assert.deepEqual(gross.an, [{ typ: 'start' }]);
  for (const p of [klein, pausiert, leer]) {
    assert.deepEqual(p.an, [{ typ: 'abbruch' }]);
    assert.ok(p.getrennt);
  }
  gross.senden({ typ: 'gestartet', breite: 1280, hoehe: 720, video: 'H.264', audio: 'Opus' });
  const st = await bereit;
  assert.equal(st.zustand, 'laeuft');
  assert.equal(st.breite, 1280);

  gross.senden({ typ: 'daten', b64: b64('ftyp') });
  gross.senden({ typ: 'status', sekunden: 2.5, bilder: 75, verworfen: 0 });
  gross.senden({ typ: 'daten', b64: b64('moof+mdat') });
  assert.equal(s.status().bytes, 13);
  assert.equal(s.status().sekunden, 2.5);

  const ende = s.stoppen();
  assert.deepEqual(gross.an.at(-1), { typ: 'stopp' });
  gross.senden({ typ: 'daten', b64: b64('-rest') });
  gross.senden({ typ: 'ende', sekunden: 3 });
  const erg = await ende;
  assert.equal(erg.gespeichert, 'Video.mp4');
  assert.equal(erg.abgebrochen, false);
  assert.equal(gespeichert[0].text, 'ftypmoof+mdat-rest');
  assert.equal(gespeichert[0].info.titel, 'Test');
  assert.equal(s.laeuft, false);
});

test('Seite bricht ab (Tab zu): Bisheriges wird trotzdem gespeichert', async () => {
  let blobText = null;
  const s = new VideoSammler({ wartezeit: 10, beiFertig: async (blob) => { blobText = await blob.text(); return 'Teil.mp4'; } });
  const bereit = s.vorbereiten({ titel: 'X' });
  const p = port({ flaeche: 10, spielt: true });
  s.portAnnehmen(p);
  await warten(30);
  p.senden({ typ: 'gestartet', breite: 2, hoehe: 2 });
  await bereit;
  p.senden({ typ: 'daten', b64: b64('teil1') });
  p.trennenVonSeite();
  await warten(10);
  assert.equal(blobText, 'teil1');
  assert.equal(s.letztes.abgebrochen, true);
  assert.equal(s.letztes.gespeichert, 'Teil.mp4');
});

test('kein Video auf der Seite: verständlicher Fehler', async () => {
  const s = new VideoSammler({ wartezeit: 10, beiFertig: () => assert.fail('nichts speichern') });
  const bereit = s.vorbereiten({});
  s.portAnnehmen(port({ flaeche: 0, spielt: false }));
  await assert.rejects(bereit, /Kein Video auf der Seite gefunden/);
  assert.equal(s.laeuft, false);
});

test('Seite antwortet nicht / Startfehler werden gemeldet', async () => {
  const s = new VideoSammler({ wartezeit: 10, startTimeout: 50, beiFertig: () => {} });
  await assert.rejects(s.vorbereiten({}), /nicht geantwortet/);
  const bereit = s.vorbereiten({});
  const p = port({ flaeche: 10, spielt: true });
  s.portAnnehmen(p);
  await warten(30);
  p.senden({ typ: 'fehler', text: 'Dieses Video ist gegen Aufnahme geschützt (fremde Domain).' });
  await assert.rejects(bereit, /geschützt/);
  assert.equal(s.laeuft, false);
});

test('zweite Aufnahme während einer laufenden wird abgelehnt', async () => {
  const s = new VideoSammler({ wartezeit: 10, beiFertig: async () => 'a.mp4' });
  s.vorbereiten({});
  assert.throws(() => s.vorbereiten({}), /läuft bereits/);
  await s.stoppen();
});
