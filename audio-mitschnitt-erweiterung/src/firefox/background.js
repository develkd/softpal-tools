/*
 * Firefox (Manifest V2, dauerhafte Hintergrundseite).
 *
 * Firefox bietet Erweiterungen keine Tab-Aufnahme (kein tabCapture).
 * Stattdessen wird ein Abgriff-Skript (tap.js) in alle Frames des Tabs
 * eingefügt. Es leitet den Ton der <audio>/<video>-Elemente über Web Audio
 * und schickt die PCM-Daten hierher. Hier wird gemischt und als MP3 kodiert.
 */
'use strict';

let aufnahme = null;
let tabId = null;
const ports = new Map(); // Quelle-ID -> Port
const quellenInfo = new Map(); // Quelle-ID -> {erfasst, fremd, blockiert}
const offeneDownloads = new Map();

function abzeichen(an) {
  browser.browserAction.setBadgeText({ text: an ? 'REC' : '' });
  if (an) browser.browserAction.setBadgeBackgroundColor({ color: '#c62828' });
}

// Aufnahme mit der Standardrate des Audiosystems (meist 44,1 oder 48 kHz),
// damit die Abgriffe in den Seiten in der Regel nichts umrechnen müssen.
function aufnahmeRate() {
  try {
    const ctx = new AudioContext();
    const rate = ctx.sampleRate;
    ctx.close();
    return [32000, 44100, 48000].includes(rate) ? rate : 48000;
  } catch (_) {
    return 48000;
  }
}

async function abgriffEinfuegen() {
  try {
    for (const file of ['/lib/abgriff.js', '/firefox/tap.js']) {
      await browser.tabs.executeScript(tabId, {
        file, allFrames: true, matchAboutBlank: true, runAt: 'document_idle',
      });
    }
    return true;
  } catch (fehler) {
    return fehler;
  }
}

function infoText() {
  let erfasst = 0;
  let fremd = 0;
  let blockiert = 0;
  let fehler = 0;
  let fehlertext = '';
  for (const i of quellenInfo.values()) {
    erfasst += i.erfasst || 0;
    fremd += i.fremd || 0;
    blockiert += i.blockiert || 0;
    fehler += i.fehler || 0;
    if (i.fehlertext) fehlertext = i.fehlertext;
  }
  const teile = [erfasst === 1 ? '1 Medienquelle' : `${erfasst} Medienquellen`];
  if (fremd) teile.push(`${fremd} von fremder Domain nicht aufnehmbar`);
  if (blockiert) teile.push(`${blockiert} warten auf einen Klick in die Seite`);
  if (fehler) teile.push(`${fehler} nicht aufnehmbar: ${fehlertext}`);
  return teile.join(' · ');
}

async function starten({ tabId: tab, bitrate, titel }) {
  if (aufnahme && aufnahme.laeuft) throw new Error('Es läuft bereits eine Aufnahme.');
  tabId = tab;
  quellenInfo.clear();
  aufnahme = new Aufnahme({ bitrate, titel, sampleRate: aufnahmeRate() });
  aufnahme.info = 'Suche Audio-/Videoelemente …';
  const ergebnis = await abgriffEinfuegen();
  if (ergebnis !== true) {
    aufnahme = null;
    tabId = null;
    throw new Error(/Missing host permission|about:|moz-extension|Cannot access/i.test(String(ergebnis))
      ? 'Diese Seite kann nicht aufgenommen werden (Browser-interne Seite).'
      : String(ergebnis.message || ergebnis));
  }
  aufnahme.starten();
  abzeichen(true);
  return status();
}

async function stoppen() {
  if (!aufnahme || !aufnahme.laeuft) return { laeuft: false };
  for (const port of ports.values()) {
    try { port.postMessage({ typ: 'stopp' }); port.disconnect(); } catch (_) { /* Frame weg */ }
  }
  ports.clear();
  const blob = aufnahme.stoppen();
  const ergebnis = { ...aufnahme.status(), gespeichert: aufnahme.dateiname };
  abzeichen(false);
  const url = URL.createObjectURL(blob);
  const { fragen = false, unterordner = 'Mitschnitte' } = await browser.storage.local.get(['fragen', 'unterordner']);
  try {
    const id = await browser.downloads.download({
      url,
      filename: unterordner ? `${unterordner}/${aufnahme.dateiname}` : aufnahme.dateiname,
      saveAs: Boolean(fragen),
      conflictAction: 'uniquify',
    });
    offeneDownloads.set(id, url);
  } catch (fehler) {
    URL.revokeObjectURL(url);
    if (!/canceled/i.test(String(fehler))) throw fehler;
  }
  tabId = null;
  return ergebnis;
}

function status() {
  if (!aufnahme) return { laeuft: false };
  if (aufnahme.laeuft) aufnahme.info = infoText();
  return { ...aufnahme.status(), tabId };
}

browser.downloads.onChanged.addListener((delta) => {
  if (!offeneDownloads.has(delta.id) || !delta.state) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    URL.revokeObjectURL(offeneDownloads.get(delta.id));
    offeneDownloads.delete(delta.id);
  }
});

// Abgriffe aus den Frames des aufgenommenen Tabs
browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'audio-mitschnitt-abgriff') return;
  const absenderTab = port.sender && port.sender.tab ? port.sender.tab.id : null;
  if (!aufnahme || !aufnahme.laeuft || absenderTab !== tabId) {
    port.postMessage({ typ: 'stopp' });
    port.disconnect();
    return;
  }
  const id = `${port.sender.frameId}:${Math.random().toString(36).slice(2)}`;
  ports.set(id, port);
  port.onMessage.addListener((m) => {
    if (!aufnahme || !aufnahme.laeuft) return;
    if (m.typ === 'pcm') aufnahme.hinzufuegen(id, m.l, m.r, m.rate);
    else if (m.typ === 'info') quellenInfo.set(id, m);
  });
  port.onDisconnect.addListener(() => {
    ports.delete(id);
    quellenInfo.delete(id);
    if (aufnahme) aufnahme.entfernen(id);
  });
});

// Neu geladene Seite im aufgenommenen Tab: Abgriff erneut einfügen
browser.tabs.onUpdated.addListener((tab, aenderung) => {
  if (tab === tabId && aufnahme && aufnahme.laeuft && aenderung.status === 'complete') {
    abgriffEinfuegen();
  }
});

browser.tabs.onRemoved.addListener((tab) => {
  if (tab === tabId && aufnahme && aufnahme.laeuft) stoppen().catch(console.error);
});

browser.runtime.onMessage.addListener(async (nachricht) => {
  if (nachricht.ziel !== 'hintergrund') return undefined;
  try {
    switch (nachricht.typ) {
      case 'starten': return await starten(nachricht);
      case 'stoppen': return await stoppen();
      case 'status': return status();
      case 'pausieren': if (aufnahme) aufnahme.pausieren(); return status();
      case 'fortsetzen': if (aufnahme) aufnahme.fortsetzen(); return status();
      default: throw new Error(`Unbekannte Nachricht: ${nachricht.typ}`);
    }
  } catch (fehler) {
    return { fehler: fehler.message || String(fehler) };
  }
});
