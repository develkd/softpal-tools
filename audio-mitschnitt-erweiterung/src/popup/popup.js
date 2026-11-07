/* Popup – für Chrome und Firefox gleich; spricht nur mit dem Hintergrund. */
'use strict';

const api = globalThis.browser || globalThis.chrome;
const $ = (id) => document.getElementById(id);

let aktiverTab = null;
let letzterStatus = { laeuft: false };
let beschaeftigt = false;

function zeitText(sekunden) {
  const s = Math.floor(sekunden || 0);
  const z = (n) => String(n).padStart(2, '0');
  return `${z(Math.floor(s / 3600))}:${z(Math.floor((s % 3600) / 60))}:${z(s % 60)}`;
}

function groesseText(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function hinweis(text, fehler = false) {
  $('hinweis').textContent = text || '';
  $('hinweis').classList.toggle('fehler', Boolean(fehler));
}

async function senden(typ, daten = {}) {
  const antwort = await api.runtime.sendMessage({ ziel: 'hintergrund', typ, ...daten });
  if (antwort && antwort.fehler) throw new Error(antwort.fehler);
  return antwort || {};
}

function anzeigen(st) {
  letzterStatus = st;
  const laeuft = Boolean(st.laeuft);
  const andererTab = laeuft && aktiverTab && st.tabId != null && st.tabId !== aktiverTab.id;

  $('punkt').className = `punkt${laeuft ? (st.pausiert ? ' pause' : st.wartetAufTon ? ' wartet' : ' an') : ''}`;
  if (laeuft) {
    $('zeit').textContent = zeitText(st.sekunden);
    $('groesse').textContent = groesseText(st.bytes);
    const db = st.pegelDb;
    const prozent = db == null || st.pausiert ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    $('pegel-balken').style.width = `${prozent}%`;
  } else {
    $('pegel-balken').style.width = '0';
  }

  $('quelle-beschriftung').textContent = andererTab ? 'Aufnahme läuft in anderem Tab' : 'Ton dieses Tabs';
  $('tab-titel').textContent = andererTab ? (st.titel || 'anderer Tab') : (aktiverTab ? aktiverTab.title || 'aktueller Tab' : '…');

  const start = $('start');
  start.textContent = laeuft ? '■ Beenden & speichern' : '● Aufnahme starten';
  start.classList.toggle('stopp', laeuft);
  start.disabled = beschaeftigt;
  $('pause').disabled = !laeuft || beschaeftigt;
  $('pause').textContent = st.pausiert ? '▶ Weiter' : '❚❚ Pause';
  $('bitrate').disabled = laeuft;
  if (laeuft && st.info && !$('hinweis').classList.contains('fehler')) hinweis(st.info);
  automatikAnzeigen(st);
  if (st.diagnose) {
    $('diagnose').hidden = false;
    $('diagnose-text').textContent = st.diagnose;
  }
}

function automatikAnzeigen(st) {
  if (!st.automatikVerfuegbar) return;
  const kasten = $('automatik');
  const fuerDiesenTab = st.automatikVerfuegbar === 'alle' || (aktiverTab && st.autoTabId === aktiverTab.id);
  if (!beschaeftigt) kasten.checked = Boolean(st.automatik && fuerDiesenTab);
  let text;
  if (st.automatikVerfuegbar === 'alle') {
    text = 'in allen Tabs: startet bei Ton, neue Datei nach jeder Stille';
  } else if (st.automatik && !fuerDiesenTab) {
    text = 'ist für einen anderen Tab aktiv – hier anhaken, um zu diesem Tab zu wechseln';
  } else {
    text = 'in diesem Tab: startet bei Ton, neue Datei nach jeder Stille';
  }
  $('automatik-text').textContent = text;
  if (st.laeuft && st.wartetAufTon && !$('hinweis').classList.contains('fehler')) {
    hinweis(st.letzteMeldung && st.letzteMeldung.includes('wartet auf Ton')
      ? st.letzteMeldung : 'Automatik bereit – wartet auf Ton …');
  } else if (!st.laeuft && st.letzteMeldung && !$('hinweis').classList.contains('fehler')
      && !$('hinweis').textContent.startsWith('Gespeichert')) {
    hinweis(st.letzteMeldung);
  }
}

async function automatikUmschalten() {
  beschaeftigt = true;
  try {
    hinweis('');
    anzeigen(await senden('automatik', {
      an: $('automatik').checked, tabId: aktiverTab.id, titel: aktiverTab.title || '',
    }));
  } catch (fehler) {
    hinweis(fehler.message, true);
  } finally {
    beschaeftigt = false;
    await aktualisieren();
  }
}

async function aktualisieren() {
  try {
    anzeigen(await senden('status'));
  } catch (fehler) {
    // Hintergrund startet evtl. gerade – beim nächsten Durchlauf erneut
  }
}

async function startStopp() {
  beschaeftigt = true;
  anzeigen(letzterStatus);
  try {
    if (letzterStatus.laeuft) {
      const erg = await senden('stoppen');
      hinweis(erg.gespeichert ? `Gespeichert: ${erg.gespeichert}` : 'Aufnahme beendet.');
      $('zeit').textContent = zeitText(erg.sekunden);
      $('groesse').textContent = groesseText(erg.bytes);
    } else {
      hinweis('');
      const bitrate = Number($('bitrate').value);
      await senden('starten', { tabId: aktiverTab.id, titel: aktiverTab.title || '', bitrate });
      hinweis('Aufnahme läuft …');
    }
  } catch (fehler) {
    hinweis(fehler.message, true);
  } finally {
    beschaeftigt = false;
    await aktualisieren();
  }
}

async function pauseUmschalten() {
  try {
    anzeigen(await senden(letzterStatus.pausiert ? 'fortsetzen' : 'pausieren'));
  } catch (fehler) {
    hinweis(fehler.message, true);
  }
}

/** Zahlenfeld (Komma oder Punkt) mit Untergrenze speichern. */
function zahlFeld(id, schluessel, minimum) {
  const feld = $(id);
  // beim Tippen nur speichern, erst beim Verlassen des Feldes sichtbar korrigieren
  const speichern = (korrigieren) => {
    const wert = Number(String(feld.value).replace(',', '.'));
    if (!Number.isFinite(wert) || feld.value === '') return;
    const begrenzt = Math.max(minimum, Math.min(600, wert));
    if (korrigieren && begrenzt !== wert) feld.value = String(begrenzt);
    api.storage.local.set({ [schluessel]: begrenzt });
  };
  feld.addEventListener('input', () => speichern(false));
  feld.addEventListener('change', () => speichern(true));
}

async function einstellungenLaden() {
  const { bitrate = 192, fragen = false, nachStille = 5, mindestTon = 3 } =
    await api.storage.local.get(['bitrate', 'fragen', 'nachStille', 'mindestTon']);
  $('bitrate').value = String(bitrate);
  $('fragen').checked = Boolean(fragen);
  $('nach-stille').value = String(nachStille);
  $('mindest-ton').value = String(mindestTon);
  zahlFeld('nach-stille', 'nachStille', 0.5);
  zahlFeld('mindest-ton', 'mindestTon', 0);
  $('bitrate').addEventListener('change', () => api.storage.local.set({ bitrate: Number($('bitrate').value) }));
  $('fragen').addEventListener('change', () => api.storage.local.set({ fragen: $('fragen').checked }));
}

async function init() {
  $('version').textContent = `Version ${api.runtime.getManifest().version}`;
  const parameter = new URLSearchParams(location.search);
  if (parameter.has('tab')) {
    // für automatische Tests: Popup als Tab für einen bestimmten Ziel-Tab öffnen
    aktiverTab = await api.tabs.get(Number(parameter.get('tab')));
  } else {
    [aktiverTab] = await api.tabs.query({ active: true, currentWindow: true });
  }
  $('start').addEventListener('click', startStopp);
  $('pause').addEventListener('click', pauseUmschalten);
  $('automatik').addEventListener('change', automatikUmschalten);
  $('diagnose-kopieren').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('diagnose-text').textContent);
      $('diagnose-kopieren').textContent = 'Kopiert ✓';
    } catch (_) {
      // Fallback: Text markieren, damit er mit Strg+C kopiert werden kann
      const auswahl = window.getSelection();
      auswahl.selectAllChildren($('diagnose-text'));
      $('diagnose-kopieren').textContent = 'Markiert – mit Strg+C kopieren';
    }
  });
  await einstellungenLaden();
  await aktualisieren();
  setInterval(aktualisieren, 250);
}

init().catch((fehler) => hinweis(fehler.message, true));
