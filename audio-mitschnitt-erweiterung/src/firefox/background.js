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
// Diagnose: was kommt von den Abgriffen an?
const diag = { eingefuegt: '', abgewiesen: [], frames: new Map() }; // id -> {diag, pcm}

// Automatik: startet, sobald ein Tab Ton abspielt; endet nach Stille
// nachStille: Datei nach so viel Stille beenden; mindestTon: kürzere verwerfen
const einst = { automatik: false, nachStille: 5, mindestTon: 3, bitrate: 192 };
const gesperrt = new Set(); // Tabs, deren automatische Aufnahme gerade verworfen/beendet wurde
let letzteMeldung = '';

function abzeichen(an) {
  // während die Automatik auf Ton wartet: AUTO statt REC
  const aktiv = an && !(aufnahme && aufnahme.automatik && aufnahme.tonSekunden === 0);
  const text = aktiv ? 'REC' : einst.automatik ? 'AUTO' : '';
  an = aktiv;
  browser.browserAction.setBadgeText({ text });
  browser.browserAction.setBadgeBackgroundColor({ color: an ? '#c62828' : '#555555' });
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
    for (const file of ['/lib/abgriff.js', '/lib/medienquelle.js', '/firefox/tap.js']) {
      const ergebnisse = await browser.tabs.executeScript(tabId, {
        file, allFrames: true, matchAboutBlank: true, runAt: 'document_idle',
      });
      diag.eingefuegt = `${file.split('/').pop()} in ${ergebnisse.length} Frame(s)`;
    }
    return true;
  } catch (fehler) {
    diag.eingefuegt = `Fehler: ${fehler && fehler.message ? fehler.message : fehler}`;
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

async function starten({ tabId: tab, bitrate, titel, automatisch = false }) {
  if (aufnahme && aufnahme.laeuft) throw new Error('Es läuft bereits eine Aufnahme.');
  tabId = tab;
  quellenInfo.clear();
  diag.eingefuegt = '';
  diag.abgewiesen = [];
  diag.frames.clear();
  aufnahme = neueAufnahme({ bitrate, titel, automatisch });
  aufnahme.info = 'Suche Audio-/Videoelemente …';
  // Erst starten, dann einfügen: Der Abgriff verbindet sich schon während
  // executeScript und würde sonst als "keine Aufnahme aktiv" abgewiesen.
  aufnahme.starten();
  const ergebnis = await abgriffEinfuegen();
  if (ergebnis !== true) {
    aufnahme.stoppen();
    for (const port of ports.values()) {
      try { port.postMessage({ typ: 'stopp' }); port.disconnect(); } catch (_) { /* Frame weg */ }
    }
    ports.clear();
    aufnahme = null;
    tabId = null;
    throw new Error(/Missing host permission|about:|moz-extension|Cannot access/i.test(String(ergebnis))
      ? 'Diese Seite kann nicht aufgenommen werden (Browser-interne Seite).'
      : String(ergebnis.message || ergebnis));
  }
  abzeichen(true);
  return status();
}

function neueAufnahme({ bitrate, titel, automatisch, sampleRate = aufnahmeRate() }) {
  const a = new Aufnahme({
    bitrate, titel, sampleRate,
    automatik: automatisch ? { nachStille: einst.nachStille } : null,
  });
  if (automatisch) {
    a.beiStille = () => automatischTeilen().catch(console.error);
    a.beiErstemTon = () => {
      if (aufnahme === a) abzeichen(true);
      // Playlist: Datei nach dem Titel benennen, der beim ersten Ton im Tab steht
      if (tabId != null) {
        browser.tabs.get(tabId).then((t) => { if (t && t.title) a.titel = t.title; }).catch(() => {});
      }
    };
  }
  return a;
}

/** Speichert unter dem ersten Namen, den der Browser akzeptiert (Titel, ASCII-Titel, Datum). */
async function blobSpeichern(blob, namen) {
  const url = URL.createObjectURL(blob);
  const { fragen = false, unterordner = 'Mitschnitte' } = await browser.storage.local.get(['fragen', 'unterordner']);
  const pfad = (name) => (unterordner ? `${unterordner}/${name}` : name);
  let letzterFehler = null;
  for (const name of namen) {
    try {
      const id = await browser.downloads.download({
        url, filename: pfad(name), saveAs: Boolean(fragen), conflictAction: 'uniquify',
      });
      offeneDownloads.set(id, url);
      return name;
    } catch (fehler) {
      if (/canceled/i.test(String(fehler))) { letzterFehler = null; break; }
      letzterFehler = fehler; // Name abgelehnt -> nächsten probieren
    }
  }
  URL.revokeObjectURL(url);
  if (letzterFehler) throw letzterFehler;
  return null;
}

async function stoppen({ stilleVerwerfen = false, verwerfen = false } = {}) {
  if (!aufnahme || !aufnahme.laeuft) return { laeuft: false };
  for (const port of ports.values()) {
    try { port.postMessage({ typ: 'stopp' }); port.disconnect(); } catch (_) { /* Frame weg */ }
  }
  ports.clear();
  const blob = aufnahme.stoppen({ stilleVerwerfen });
  abzeichen(false);
  if (verwerfen) {
    tabId = null;
    return { ...aufnahme.status(), verworfen: true };
  }
  const name = await blobSpeichern(blob, aufnahme.dateinamen);
  const ergebnis = { ...aufnahme.status(), gespeichert: name || aufnahme.dateiname };
  tabId = null;
  return ergebnis;
}

function diagnoseText() {
  const zeilen = [
    `Audio-Mitschnitt ${browser.runtime.getManifest().version} · Firefox · ${navigator.userAgent.match(/Firefox\/[\d.]+/)?.[0] || ''}`,
    `Aufnahme: ${aufnahme ? `${aufnahme.laeuft ? 'läuft' : 'beendet'}, ${aufnahme.sampleRate} Hz, ${aufnahme.mischer.sekunden.toFixed(1)} s` : 'keine'} · Tab ${tabId}`,
    `Eingefügt: ${diag.eingefuegt || '–'} · verbundene Frames: ${ports.size}`,
  ];
  if (diag.abgewiesen.length) zeilen.push(`Abgewiesen: ${diag.abgewiesen.join('; ')}`);
  for (const [id, f] of diag.frames) {
    const d = f.diag || {};
    zeilen.push(`Frame ${id.split(':')[0]}${d.oben ? ' (oben)' : ''} ${d.seite || ''}: ` +
      `Kontext ${d.ctx || '?'}, Abgriff ${d.abgriff ? (d.abgriff === true ? 'ja' : d.abgriff) : 'nein'} (${d.abgriffFunktion || '?'}), ` +
      `Blöcke gesendet ${d.gesendet ?? '?'} / empfangen ${f.pcm}`);
    for (const e of d.elemente || []) zeilen.push(`  · ${e}`);
    for (const e of d.fehler || []) zeilen.push(`  ! ${e}`);
  }
  return zeilen.join('\n');
}

function status() {
  const auto = { automatikVerfuegbar: 'alle', automatik: einst.automatik, letzteMeldung,
    video: { ...video.status(), letztes: video.letztes || null } };
  if (!aufnahme) return { laeuft: false, ...auto, diagnose: diagnoseText() };
  if (aufnahme.laeuft) aufnahme.info = infoText();
  return { ...aufnahme.status(), tabId, ...auto, diagnose: diagnoseText() };
}

// ---- Automatik ------------------------------------------------------------
function aufnehmbar(tab) {
  return tab && /^(https?|file):/.test(tab.url || '');
}

async function automatischStarten(tab) {
  if (!einst.automatik || (aufnahme && aufnahme.laeuft) || gesperrt.has(tab.id) || !aufnehmbar(tab)) return;
  try {
    await starten({ tabId: tab.id, bitrate: einst.bitrate, titel: tab.title || '', automatisch: true });
    letzteMeldung = `Automatisch gestartet: ${tab.title || 'Tab'}`;
  } catch (fehler) {
    gesperrt.add(tab.id);
    letzteMeldung = `Automatik: ${fehler.message || fehler}`;
  }
}

/** Automatische Aufnahme ohne Ton oder kürzer als die Mindestlänge? */
function zuKurz(a) {
  return a.tonSekunden === 0 || a.tonSekunden < einst.mindestTon;
}

/** Automatische Aufnahme beenden (speichern oder verwerfen) – Abgriffe lösen. */
async function automatischAbschliessen() {
  if (!aufnahme || !aufnahme.laeuft || !aufnahme.automatik) return null;
  const kurz = zuKurz(aufnahme);
  const ohneTon = aufnahme.tonSekunden === 0;
  const erg = await stoppen({ stilleVerwerfen: true, verwerfen: kurz });
  if (!ohneTon) {
    letzteMeldung = kurz ? `Kurzer Ton (unter ${einst.mindestTon} s) verworfen` : `Automatisch gespeichert: ${erg.gespeichert}`;
  }
  return erg;
}

/**
 * Nach Stille: aktuelle Datei abschließen und sofort eine neue beginnen, die
 * auf den nächsten Ton wartet. Die Abgriffe in der Seite bleiben verbunden,
 * so beginnt die nächste Datei ohne Verzögerung (auch bei kurzer Stille).
 */
async function automatischTeilen() {
  const alt = aufnahme;
  if (!alt || !alt.laeuft || !alt.automatik) return;
  if (!einst.automatik) {
    await automatischAbschliessen();
    return;
  }
  aufnahme = neueAufnahme({ bitrate: alt.bitrate, titel: alt.titel, automatisch: true, sampleRate: alt.sampleRate });
  aufnahme.starten();
  abzeichen(true);
  const kurz = zuKurz(alt);
  const blob = alt.stoppen({ stilleVerwerfen: true });
  if (kurz) {
    letzteMeldung = `Kurzer Ton (unter ${einst.mindestTon} s) verworfen – wartet auf Ton`;
    return;
  }
  const name = await blobSpeichern(blob, alt.dateinamen);
  letzteMeldung = `Automatisch gespeichert: ${name || alt.dateiname} – wartet auf Ton`;
}

async function naechstenHoerbarenTabStarten() {
  if (!einst.automatik || (aufnahme && aufnahme.laeuft)) return;
  const tabs = await browser.tabs.query({ audible: true });
  const tab = tabs.find((t) => !gesperrt.has(t.id) && aufnehmbar(t));
  if (tab) await automatischStarten(tab);
}

async function hoerbarGeaendert(tab, hoerbar) {
  if (!hoerbar) {
    gesperrt.delete(tab.id);
    return;
  }
  // wartet die Automatik in einem anderen Tab noch auf Ton? -> zu diesem wechseln
  if (einst.automatik && aufnahme && aufnahme.laeuft && aufnahme.automatik
      && aufnahme.tonSekunden === 0 && tab.id !== tabId && aufnehmbar(tab) && !gesperrt.has(tab.id)) {
    await stoppen({ verwerfen: true });
  }
  await automatischStarten(tab);
}

function zahl(wert, standard, minimum) {
  const n = Number(wert);
  return Number.isFinite(n) && wert !== '' && wert != null ? Math.max(minimum, n) : standard;
}

async function einstellungenLaden() {
  const gespeichert = await browser.storage.local.get(['automatik', 'nachStille', 'mindestTon', 'bitrate']);
  einst.automatik = Boolean(gespeichert.automatik);
  einst.nachStille = zahl(gespeichert.nachStille, 5, 0.5);
  einst.mindestTon = zahl(gespeichert.mindestTon, 3, 0);
  einst.bitrate = Number(gespeichert.bitrate) || 192;
  if (!aufnahme || !aufnahme.laeuft) abzeichen(false);
}

browser.storage.onChanged.addListener(async (aenderung, bereich) => {
  if (bereich !== 'local') return;
  const warAn = einst.automatik;
  await einstellungenLaden();
  if (einst.automatik && !warAn) {
    gesperrt.clear();
    letzteMeldung = 'Automatik an – wartet auf Ton';
    await naechstenHoerbarenTabStarten();
  } else if (!einst.automatik && warAn) {
    letzteMeldung = '';
    // laufende automatische Aufnahme abschließen (speichern, wenn lang genug)
    await automatischAbschliessen();
  }
  // geänderte Stille-Dauer gilt ab sofort
  if (aufnahme && aufnahme.laeuft && aufnahme.automatik) aufnahme.automatik.nachStille = einst.nachStille;
});
einstellungenLaden();

browser.downloads.onChanged.addListener((delta) => {
  if (!offeneDownloads.has(delta.id) || !delta.state) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    URL.revokeObjectURL(offeneDownloads.get(delta.id));
    offeneDownloads.delete(delta.id);
  }
});

// Abgriffe aus den Frames des aufgenommenen Tabs
// ---- Video-Aufnahme (MP4) -------------------------------------------------
const VIDEO_SKRIPTE = ['/lib/mp4-muxer.js', '/lib/abgriff.js', '/lib/resampler.js', '/lib/medienquelle.js', '/lib/video.js'];
const video = new VideoSammler({
  beiFertig: (blob, info) => blobSpeichern(blob, dateinamenFuer(info.titel, new Date(info.startzeit), '.mp4', 'Video')),
});

async function videoStarten({ tabId: tab, titel }) {
  const bereit = video.vorbereiten({ titel, tabId: tab });
  try {
    for (const file of VIDEO_SKRIPTE) {
      await browser.tabs.executeScript(tab, { file, allFrames: true, matchAboutBlank: true, runAt: 'document_idle' });
    }
  } catch (fehler) {
    await video.stoppen();
    throw new Error(/Missing host permission|about:|Cannot access/i.test(String(fehler))
      ? 'Auf dieser Seite kann kein Video aufgenommen werden (Browser-interne Seite).'
      : String(fehler.message || fehler));
  }
  return bereit;
}

browser.runtime.onConnect.addListener((port) => {
  if (video.portAnnehmen(port)) return;
  if (port.name !== 'audio-mitschnitt-abgriff') return;
  const absenderTab = port.sender && port.sender.tab ? port.sender.tab.id : null;
  if (!aufnahme || !aufnahme.laeuft || absenderTab !== tabId) {
    diag.abgewiesen.push(`Frame ${port.sender && port.sender.frameId} (Tab ${absenderTab}, ` +
      `${!aufnahme ? 'keine Aufnahme' : !aufnahme.laeuft ? 'Aufnahme läuft nicht' : `erwartet Tab ${tabId}`})`);
    if (diag.abgewiesen.length > 5) diag.abgewiesen.shift();
    port.postMessage({ typ: 'stopp' });
    port.disconnect();
    return;
  }
  const id = `${port.sender.frameId}:${Math.random().toString(36).slice(2)}`;
  ports.set(id, port);
  const frameDiag = { diag: null, pcm: 0 };
  diag.frames.set(id, frameDiag);
  port.onMessage.addListener((m) => {
    if (!aufnahme || !aufnahme.laeuft) return;
    if (m.typ === 'pcm') {
      frameDiag.pcm++;
      aufnahme.hinzufuegen(id, m.l, m.r, m.rate);
    } else if (m.typ === 'info') quellenInfo.set(id, m);
    else if (m.typ === 'diag') frameDiag.diag = m;
  });
  port.onDisconnect.addListener(() => {
    ports.delete(id);
    quellenInfo.delete(id);
    if (aufnahme) aufnahme.entfernen(id);
  });
});

// Neu geladene Seite im aufgenommenen Tab: Abgriff erneut einfügen
browser.tabs.onUpdated.addListener((tab, aenderung, tabInfo) => {
  if (tab === tabId && aufnahme && aufnahme.laeuft && aenderung.status === 'complete') {
    abgriffEinfuegen();
  }
  if ('audible' in aenderung) hoerbarGeaendert(tabInfo || { id: tab }, aenderung.audible);
});

browser.tabs.onRemoved.addListener((tab) => {
  gesperrt.delete(tab);
  if (tab === tabId && aufnahme && aufnahme.laeuft) {
    const auto = Boolean(aufnahme.automatik);
    const kurz = auto && zuKurz(aufnahme);
    stoppen({ stilleVerwerfen: auto, verwerfen: kurz })
      .then(() => naechstenHoerbarenTabStarten())
      .catch(console.error);
  }
});

browser.runtime.onMessage.addListener(async (nachricht) => {
  if (nachricht.ziel !== 'hintergrund') return undefined;
  try {
    switch (nachricht.typ) {
      case 'starten': return await starten(nachricht);
      case 'stoppen': {
        // von Hand beendet: Tab erst nach Stille wieder automatisch aufnehmen
        if (tabId != null) gesperrt.add(tabId);
        if (aufnahme && aufnahme.automatik) {
          const kurz = zuKurz(aufnahme);
          return await stoppen({ stilleVerwerfen: true, verwerfen: kurz });
        }
        return await stoppen();
      }
      case 'status': return status();
      case 'videoStarten': return await videoStarten(nachricht);
      case 'videoStoppen': return await video.stoppen();
      case 'automatik':
        await browser.storage.local.set({ automatik: Boolean(nachricht.an) });
        await einstellungenLaden();
        return status();
      case 'pausieren': if (aufnahme) aufnahme.pausieren(); return status();
      case 'fortsetzen': if (aufnahme) aufnahme.fortsetzen(); return status();
      default: throw new Error(`Unbekannte Nachricht: ${nachricht.typ}`);
    }
  } catch (fehler) {
    return { fehler: fehler.message || String(fehler) };
  }
});
