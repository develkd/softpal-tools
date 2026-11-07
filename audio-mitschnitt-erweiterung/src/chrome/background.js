/*
 * Chrome/Edge (Manifest V3) – Service Worker.
 *
 * Holt per tabCapture eine Stream-ID für den aktiven Tab und gibt sie an das
 * Offscreen-Dokument weiter, das Aufnahme und MP3-Kodierung übernimmt.
 * Der Zustand liegt im Offscreen-Dokument – der Service Worker darf jederzeit
 * beendet werden.
 */
'use strict';

const OFFSCREEN_URL = 'chrome/offscreen.html';

async function offscreenVorhanden() {
  const kontexte = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return kontexte.length > 0;
}

let offscreenWirdErstellt = null;
async function offscreenSicherstellen() {
  if (await offscreenVorhanden()) return;
  if (!offscreenWirdErstellt) {
    offscreenWirdErstellt = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA'],
      justification: 'Ton des Tabs aufnehmen und als MP3 kodieren',
    }).finally(() => { offscreenWirdErstellt = null; });
  }
  await offscreenWirdErstellt;
}

async function anOffscreen(nachricht) {
  if (!(await offscreenVorhanden())) return null;
  return chrome.runtime.sendMessage({ ...nachricht, ziel: 'offscreen' });
}

function abzeichen(aufnahme) {
  chrome.action.setBadgeText({ text: aufnahme ? 'REC' : '' });
  if (aufnahme) chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
}

async function starten({ tabId, bitrate, titel }) {
  const status = await anOffscreen({ typ: 'status' });
  if (status && status.laeuft) throw new Error('Es läuft bereits eine Aufnahme.');
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (fehler) {
    throw new Error(uebersetzen(fehler));
  }
  await offscreenSicherstellen();
  const antwort = await chrome.runtime.sendMessage({
    ziel: 'offscreen', typ: 'starten', streamId, tabId, bitrate, titel,
  });
  if (antwort && antwort.fehler) throw new Error(antwort.fehler);
  abzeichen(true);
  return antwort;
}

function uebersetzen(fehler) {
  const text = String(fehler && fehler.message ? fehler.message : fehler);
  if (/active stream/i.test(text)) return 'Dieser Tab wird bereits aufgenommen (evtl. von einer anderen Erweiterung).';
  if (/invoked|activeTab|permission/i.test(text)) return 'Bitte die Erweiterung über ihr Symbol in diesem Tab öffnen und erneut starten.';
  if (/chrome:\/\/|Chrome pages|cannot be captured/i.test(text)) return 'Browser-interne Seiten können nicht aufgenommen werden.';
  return text;
}

// Download, sobald das Offscreen-Dokument die Datei fertig hat
const offeneDownloads = new Map(); // downloadId -> blob-URL

async function speichern({ url, dateiname }) {
  const { fragen = false, unterordner = 'Mitschnitte' } = await chrome.storage.local.get(['fragen', 'unterordner']);
  const id = await chrome.downloads.download({
    url,
    filename: unterordner ? `${unterordner}/${dateiname}` : dateiname,
    saveAs: Boolean(fragen),
    conflictAction: 'uniquify',
  });
  offeneDownloads.set(id, url);
  return id;
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!offeneDownloads.has(delta.id) || !delta.state) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    const url = offeneDownloads.get(delta.id);
    offeneDownloads.delete(delta.id);
    await anOffscreen({ typ: 'freigeben', url });
    const status = await anOffscreen({ typ: 'status' });
    if (status && !status.laeuft && !status.offeneDateien) {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  }
});

chrome.runtime.onMessage.addListener((nachricht, absender, antworten) => {
  if (nachricht.ziel !== 'hintergrund') return false;
  (async () => {
    switch (nachricht.typ) {
      case 'starten':
        return starten(nachricht);
      case 'status':
        return (await anOffscreen({ typ: 'status' })) || { laeuft: false };
      case 'pausieren':
      case 'fortsetzen':
        return anOffscreen({ typ: nachricht.typ });
      case 'stoppen': {
        const antwort = await anOffscreen({ typ: 'stoppen' });
        abzeichen(false);
        return antwort;
      }
      case 'fertig': // vom Offscreen-Dokument: Datei liegt bereit
        abzeichen(false);
        return { downloadId: await speichern(nachricht) };
      default:
        throw new Error(`Unbekannte Nachricht: ${nachricht.typ}`);
    }
  })().then(
    (ergebnis) => antworten(ergebnis ?? {}),
    (fehler) => antworten({ fehler: fehler.message || String(fehler) }),
  );
  return true;
});

chrome.runtime.onStartup.addListener(() => abzeichen(false));
