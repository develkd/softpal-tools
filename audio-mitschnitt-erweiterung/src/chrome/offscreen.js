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
let autoEinst = { nachStille: 5, mindestTon: 3 };

/** Automatische Aufnahme ohne Ton oder kürzer als die Mindestlänge? */
function zuKurz(a) {
  return a.tonSekunden === 0 || a.tonSekunden < autoEinst.mindestTon;
}

function neueAufnahme({ bitrate, titel, automatisch }) {
  const a = new Aufnahme({ bitrate, titel, automatik: automatisch ? { nachStille: autoEinst.nachStille } : null });
  a.info = automatisch ? 'Automatisch · neue Datei nach Stille' : 'Gesamter Ton des Tabs';
  if (automatisch) {
    a.beiStille = () => teilen().catch(console.error);
    a.beiErstemTon = () => {
      // Service Worker setzt das Symbol und liefert den aktuellen Tabtitel
      // (Playlist: Datei nach dem Titel benennen, der beim ersten Ton im Tab steht)
      chrome.runtime.sendMessage({ ziel: 'hintergrund', typ: 'ton', tabId, aktuell: aufnahme === a })
        .then((antwort) => { if (antwort && antwort.titel) a.titel = antwort.titel; })
        .catch(() => {});
    };
  }
  return a;
}

/** Automatik: Datei nach Stille abschließen, Tab-Aufnahme läuft für die nächste weiter. */
async function teilen() {
  const alt = aufnahme;
  if (!alt || !alt.laeuft || !alt.automatik) return;
  aufnahme = neueAufnahme({ bitrate: alt.bitrate, titel: alt.titel, automatisch: true });
  aufnahme.starten();
  const kurz = zuKurz(alt);
  const blob = alt.stoppen({ stilleVerwerfen: true });
  if (kurz) {
    await chrome.runtime.sendMessage({
      ziel: 'hintergrund', typ: 'verworfen', tabId, mindest: autoEinst.mindestTon, mitTon: alt.tonSekunden > 0, weiter: true,
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  offeneUrls.add(url);
  await chrome.runtime.sendMessage({
    ziel: 'hintergrund', typ: 'fertig', url, dateinamen: alt.dateinamen, tabId, automatisch: true, weiter: true,
  });
}

/** Automatische Aufnahme ganz beenden (speichern, wenn lang genug). */
function automatischBeenden() {
  return stoppen({ stilleVerwerfen: true, verwerfen: zuKurz(aufnahme) });
}

async function starten({ streamId, bitrate, titel, tabId: tab, automatik = null }) {
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

  if (automatik) autoEinst = { ...autoEinst, ...automatik };
  aufnahme = neueAufnahme({ bitrate, titel, automatisch: Boolean(automatik) });
  // Rückruf liest "aufnahme" bei jedem Block neu -> nach dem Teilen geht es in die neue Datei
  // bevorzugt direkt an der Tonspur (ohne zweite Uhr), sonst per AudioWorklet
  abgriff = erstelleSpurAbgriff(stream.getAudioTracks()[0],
    (l, r, rate) => aufnahme.hinzufuegen('tab', l, r, rate));
  if (!abgriff) {
    abgriff = await erstelleAbgriffWorklet(ctx, (l, r) => aufnahme.hinzufuegen('tab', l, r),
      chrome.runtime.getURL('lib/abgriff-worklet.js'));
    quelle.connect(abgriff.eingang);
  }
  aufnahme.starten();

  // Tab geschlossen o. Ä. -> automatisch beenden und speichern
  for (const spur of stream.getAudioTracks()) {
    spur.addEventListener('ended', () => {
      if (!aufnahme || !aufnahme.laeuft) return;
      (aufnahme.automatik ? automatischBeenden() : stoppen()).catch(console.error);
    });
  }
  return aufnahme.status();
}

async function stoppen({ stilleVerwerfen = false, verwerfen = false } = {}) {
  if (!aufnahme || !aufnahme.laeuft) return { laeuft: false };
  const blob = aufnahme.stoppen({ stilleVerwerfen });
  const status = aufnahme.status();
  if (abgriff) abgriff.trennen();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) await ctx.close().catch(() => {});
  abgriff = null;
  stream = null;
  ctx = null;

  if (verwerfen) {
    await chrome.runtime.sendMessage({
      ziel: 'hintergrund', typ: 'verworfen', tabId, mindest: autoEinst.mindestTon, mitTon: status.tonSekunden > 0,
    });
    return { ...status, verworfen: true };
  }
  const url = URL.createObjectURL(blob);
  offeneUrls.add(url);
  const antwort = await chrome.runtime.sendMessage({
    ziel: 'hintergrund', typ: 'fertig', url, dateinamen: aufnahme.dateinamen, tabId,
    automatisch: Boolean(aufnahme.automatik),
  });
  if (antwort && antwort.fehler) throw new Error(antwort.fehler);
  return { ...status, gespeichert: (antwort && antwort.name) || aufnahme.dateiname };
}

function status() {
  const s = aufnahme ? aufnahme.status() : { laeuft: false };
  return { ...s, tabId, offeneDateien: offeneUrls.size, abgriffArt: abgriff ? abgriff.art : null };
}

chrome.runtime.onMessage.addListener((nachricht, absender, antworten) => {
  if (nachricht.ziel !== 'offscreen') return false;
  (async () => {
    switch (nachricht.typ) {
      case 'starten': return starten(nachricht);
      case 'stoppen': return aufnahme && aufnahme.automatik ? automatischBeenden() : stoppen();
      case 'automatikAus': return aufnahme && aufnahme.laeuft && aufnahme.automatik ? automatischBeenden() : status();
      case 'einstellungen':
        autoEinst = { nachStille: nachricht.nachStille, mindestTon: nachricht.mindestTon };
        if (aufnahme && aufnahme.automatik) aufnahme.automatik.nachStille = autoEinst.nachStille;
        return status();
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
