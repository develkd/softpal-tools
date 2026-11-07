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
  if (aufnahme) {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
    return;
  }
  chrome.storage.local.get('automatik').then(({ automatik }) => {
    chrome.action.setBadgeText({ text: automatik ? 'AUTO' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#555555' });
  });
}

async function starten({ tabId, bitrate, titel, automatisch = false }) {
  const status = await anOffscreen({ typ: 'status' });
  if (status && status.laeuft) throw new Error('Es läuft bereits eine Aufnahme.');
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (fehler) {
    throw new Error(uebersetzen(fehler));
  }
  await offscreenSicherstellen();
  const { nachStille = 5 } = await chrome.storage.local.get('nachStille');
  const antwort = await chrome.runtime.sendMessage({
    ziel: 'offscreen', typ: 'starten', streamId, tabId, bitrate, titel,
    automatik: automatisch ? { nachStille: Number(nachStille) || 5 } : null,
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

// ---- Automatik --------------------------------------------------------------
// Chrome erlaubt tabCapture nur für Tabs, in denen das Symbol angeklickt wurde
// (activeTab). Die Automatik gilt deshalb für den Tab, in dem sie eingeschaltet
// wurde; Zustand in storage.session, da der Service Worker beendet werden kann.
async function automatikZustand() {
  const { automatik = false, bitrate = 192 } = await chrome.storage.local.get(['automatik', 'bitrate']);
  const { autoTabId = null, gesperrt = null, letzteMeldung = '' } =
    await chrome.storage.session.get(['autoTabId', 'gesperrt', 'letzteMeldung']);
  return { automatik, bitrate, autoTabId, gesperrt, letzteMeldung };
}

const meldung = (letzteMeldung) => chrome.storage.session.set({ letzteMeldung });

async function automatischStarten(tabId, titel) {
  const z = await automatikZustand();
  if (!z.automatik || z.autoTabId !== tabId || z.gesperrt === tabId) return;
  const status = await anOffscreen({ typ: 'status' });
  if (status && status.laeuft) return;
  try {
    await starten({ tabId, bitrate: Number(z.bitrate) || 192, titel, automatisch: true });
    await meldung(`Automatisch gestartet: ${titel || 'Tab'}`);
  } catch (fehler) {
    await chrome.storage.session.set({ gesperrt: tabId });
    await meldung(`Automatik: ${fehler.message || fehler}`);
  }
}

async function automatikSetzen({ an, tabId, titel }) {
  await chrome.storage.local.set({ automatik: Boolean(an) });
  await chrome.storage.session.set({ autoTabId: an ? tabId : null, gesperrt: null,
    letzteMeldung: an ? 'Automatik an – wartet auf Ton in diesem Tab' : '' });
  abzeichen(false);
  if (an) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.audible) await automatischStarten(tabId, titel || tab.title);
  }
  return {};
}

chrome.tabs.onUpdated.addListener(async (tabId, aenderung, tab) => {
  if (!('audible' in aenderung)) return;
  if (!aenderung.audible) {
    const { gesperrt } = await chrome.storage.session.get('gesperrt');
    if (gesperrt === tabId) await chrome.storage.session.set({ gesperrt: null });
    return;
  }
  await automatischStarten(tabId, tab && tab.title);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { autoTabId } = await chrome.storage.session.get('autoTabId');
  if (autoTabId === tabId) await chrome.storage.session.set({ autoTabId: null });
});

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
      case 'status': {
        const z = await automatikZustand();
        const auto = { automatikVerfuegbar: 'tab', automatik: z.automatik, autoTabId: z.autoTabId,
          letzteMeldung: z.letzteMeldung };
        return { ...((await anOffscreen({ typ: 'status' })) || { laeuft: false }), ...auto };
      }
      case 'automatik':
        return automatikSetzen(nachricht);
      case 'pausieren':
      case 'fortsetzen':
        return anOffscreen({ typ: nachricht.typ });
      case 'stoppen': {
        // von Hand beendet: diesen Tab erst nach Stille wieder automatisch aufnehmen
        const st = await anOffscreen({ typ: 'status' });
        if (st && st.tabId != null) await chrome.storage.session.set({ gesperrt: st.tabId });
        const antwort = await anOffscreen({ typ: 'stoppen' });
        abzeichen(false);
        return antwort;
      }
      case 'fertig': // vom Offscreen-Dokument: Datei liegt bereit
        abzeichen(false);
        if (nachricht.automatisch) {
          await chrome.storage.session.set({ gesperrt: nachricht.tabId });
          await meldung(`Automatisch gespeichert: ${nachricht.dateiname}`);
        }
        return { downloadId: await speichern(nachricht) };
      case 'verworfen': // vom Offscreen-Dokument: automatische Aufnahme zu kurz
        abzeichen(false);
        await chrome.storage.session.set({ gesperrt: nachricht.tabId });
        await meldung(`Kurzer Ton (unter ${nachricht.mindest} s) verworfen`);
        // erst nach der Antwort schließen
        setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 200);
        return {};
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
