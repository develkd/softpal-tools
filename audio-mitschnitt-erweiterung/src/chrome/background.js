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

function zahl(wert, standard, minimum) {
  const n = Number(wert);
  return Number.isFinite(n) && wert !== '' && wert != null ? Math.max(minimum, n) : standard;
}

async function autoEinstellungen() {
  const { nachStille, mindestTon } = await chrome.storage.local.get(['nachStille', 'mindestTon']);
  return { nachStille: zahl(nachStille, 5, 0.5), mindestTon: zahl(mindestTon, 3, 0) };
}

/** true: REC · 'wartet': Automatik wartet auf Ton · false: AUTO bzw. leer */
function abzeichen(aufnahme) {
  if (aufnahme === true) {
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
  const antwort = await chrome.runtime.sendMessage({
    ziel: 'offscreen', typ: 'starten', streamId, tabId, bitrate, titel,
    automatik: automatisch ? await autoEinstellungen() : null,
  });
  if (antwort && antwort.fehler) throw new Error(antwort.fehler);
  abzeichen(automatisch ? 'wartet' : true);
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
  if (!an || tabId !== (await automatikZustand()).autoTabId) {
    // laufende automatische Aufnahme abschließen (speichern, wenn lang genug)
    const st = await anOffscreen({ typ: 'status' });
    if (st && st.laeuft && st.automatisch) await anOffscreen({ typ: 'automatikAus' });
  }
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

// geänderte Werte gelten sofort auch für die laufende Aufnahme
chrome.storage.onChanged.addListener(async (aenderung, bereich) => {
  if (bereich !== 'local' || !('nachStille' in aenderung || 'mindestTon' in aenderung)) return;
  await anOffscreen({ typ: 'einstellungen', ...(await autoEinstellungen()) });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { autoTabId } = await chrome.storage.session.get('autoTabId');
  if (autoTabId === tabId) await chrome.storage.session.set({ autoTabId: null });
});

// ---- Video-Aufnahme (MP4) ---------------------------------------------------
const VIDEO_SKRIPTE = ['lib/mp4-muxer.js', 'lib/abgriff.js', 'lib/resampler.js', 'lib/medienquelle.js', 'lib/video.js'];

async function videoStarten({ tabId, titel }) {
  await offscreenSicherstellen();
  const vorbereitet = await anOffscreen({ typ: 'videoVorbereiten', tabId, titel });
  if (vorbereitet && vorbereitet.fehler) throw new Error(vorbereitet.fehler);
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: VIDEO_SKRIPTE });
  } catch (fehler) {
    await anOffscreen({ typ: 'videoStoppen' });
    throw new Error(uebersetzen(fehler));
  }
  const ergebnis = await anOffscreen({ typ: 'videoWarteStart' });
  if (ergebnis && ergebnis.fehler) throw new Error(ergebnis.fehler);
  return ergebnis;
}

/** Offscreen-Dokument schließen, wenn nichts mehr läuft. */
async function offscreenAufraeumen() {
  const status = await anOffscreen({ typ: 'status' });
  if (status && !status.laeuft && !status.offeneDateien && !(status.video && status.video.laeuft)) {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

// Download, sobald das Offscreen-Dokument die Datei fertig hat
const offeneDownloads = new Map(); // downloadId -> blob-URL

/** Speichert unter dem ersten Namen, den Chrome akzeptiert (Titel, ASCII-Titel, Datum). */
async function speichern({ url, dateinamen }) {
  const { fragen = false, unterordner = 'Mitschnitte' } = await chrome.storage.local.get(['fragen', 'unterordner']);
  const pfad = (name) => (unterordner ? `${unterordner}/${name}` : name);
  let letzterFehler = null;
  for (const name of dateinamen) {
    try {
      const id = await chrome.downloads.download({
        url, filename: pfad(name), saveAs: Boolean(fragen), conflictAction: 'uniquify',
      });
      offeneDownloads.set(id, url);
      return { id, name };
    } catch (fehler) {
      letzterFehler = fehler; // z. B. "Invalid filename" -> nächsten Namen probieren
    }
  }
  throw letzterFehler;
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!offeneDownloads.has(delta.id) || !delta.state) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    const url = offeneDownloads.get(delta.id);
    offeneDownloads.delete(delta.id);
    await anOffscreen({ typ: 'freigeben', url });
    await offscreenAufraeumen();
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
        return { video: { laeuft: false }, ...((await anOffscreen({ typ: 'status' })) || { laeuft: false }), ...auto };
      }
      case 'automatik':
        return automatikSetzen(nachricht);
      case 'videoStarten':
        return videoStarten(nachricht);
      case 'videoStoppen':
        return (await anOffscreen({ typ: 'videoStoppen' })) || { laeuft: false };
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
      case 'ton': { // vom Offscreen-Dokument: automatische Aufnahme hat Ton
        if (nachricht.aktuell !== false) abzeichen(true);
        const tab = nachricht.tabId != null ? await chrome.tabs.get(nachricht.tabId).catch(() => null) : null;
        return { titel: tab && tab.title ? tab.title : '' };
      }
      case 'fertig': // vom Offscreen-Dokument: Datei liegt bereit
        // weiter: Automatik teilt nur die Datei, Tab-Aufnahme läuft weiter
        if (!nachricht.video) abzeichen(nachricht.weiter ? 'wartet' : false);
        {
          const { id, name } = await speichern(nachricht);
          if (nachricht.automatisch) {
            await meldung(`Automatisch gespeichert: ${name}${nachricht.weiter ? ' – wartet auf Ton' : ''}`);
          }
          return { downloadId: id, name };
        }
      case 'verworfen': // vom Offscreen-Dokument: automatische Aufnahme ohne/zu kurzer Ton
        abzeichen(nachricht.weiter ? 'wartet' : false);
        if (nachricht.mitTon) {
          await meldung(`Kurzer Ton (unter ${nachricht.mindest} s) verworfen${nachricht.weiter ? ' – wartet auf Ton' : ''}`);
        }
        if (!nachricht.weiter) {
          // Aufnahme ganz beendet: Dokument nach der Antwort schließen
          setTimeout(() => offscreenAufraeumen().catch(() => {}), 200);
        }
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
