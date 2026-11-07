/*
 * Chrome/Edge – Offscreen-Dokument: nimmt den Tab-Ton auf und kodiert MP3.
 */
'use strict';

let aufnahme = null;
let stream = null;
let ctx = null;
let abgriff = null;
let tabId = null;
const offeneUrls = new Set();

async function starten({ streamId, bitrate, titel, tabId: tab }) {
  if (aufnahme && aufnahme.laeuft) throw new Error('Es läuft bereits eine Aufnahme.');
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  tabId = tab;
  ctx = new AudioContext({ sampleRate: 48000 });
  const quelle = ctx.createMediaStreamSource(stream);
  // Beim Aufnehmen schaltet Chrome den Tab stumm – Ton weiter hörbar machen
  quelle.connect(ctx.destination);

  aufnahme = new Aufnahme({ bitrate, titel });
  aufnahme.info = 'Gesamter Ton des Tabs';
  abgriff = erstelleAbgriff(ctx, (l, r) => aufnahme.mischer.hinzufuegen('tab', l, r));
  quelle.connect(abgriff.eingang);
  aufnahme.starten();

  // Tab geschlossen o. Ä. -> automatisch beenden und speichern
  for (const spur of stream.getAudioTracks()) {
    spur.addEventListener('ended', () => {
      if (aufnahme && aufnahme.laeuft) stoppen().catch(console.error);
    });
  }
  return aufnahme.status();
}

async function stoppen() {
  if (!aufnahme || !aufnahme.laeuft) return { laeuft: false };
  const blob = aufnahme.stoppen();
  const status = aufnahme.status();
  if (abgriff) abgriff.trennen();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) await ctx.close().catch(() => {});
  abgriff = null;
  stream = null;
  ctx = null;

  const url = URL.createObjectURL(blob);
  offeneUrls.add(url);
  const antwort = await chrome.runtime.sendMessage({
    ziel: 'hintergrund', typ: 'fertig', url, dateiname: aufnahme.dateiname, tabId,
  });
  if (antwort && antwort.fehler) throw new Error(antwort.fehler);
  return { ...status, gespeichert: aufnahme.dateiname };
}

function status() {
  const s = aufnahme ? aufnahme.status() : { laeuft: false };
  return { ...s, tabId, offeneDateien: offeneUrls.size };
}

chrome.runtime.onMessage.addListener((nachricht, absender, antworten) => {
  if (nachricht.ziel !== 'offscreen') return false;
  (async () => {
    switch (nachricht.typ) {
      case 'starten': return starten(nachricht);
      case 'stoppen': return stoppen();
      case 'status': return status();
      case 'pausieren': if (aufnahme) aufnahme.pausieren(); return status();
      case 'fortsetzen': if (aufnahme) aufnahme.fortsetzen(); return status();
      case 'freigeben':
        URL.revokeObjectURL(nachricht.url);
        offeneUrls.delete(nachricht.url);
        return {};
      default: throw new Error(`Unbekannte Nachricht: ${nachricht.typ}`);
    }
  })().then(
    (ergebnis) => antworten(ergebnis ?? {}),
    (fehler) => antworten({ fehler: fehler.message || String(fehler) }),
  );
  return true;
});
