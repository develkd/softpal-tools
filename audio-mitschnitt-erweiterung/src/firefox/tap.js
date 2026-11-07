/*
 * Firefox – Abgriff in der Webseite (wird in jeden Frame des Tabs eingefügt).
 *
 * Erfasst <audio>/<video>-Elemente:
 *  - Elemente mit srcObject (z. B. WebRTC-Anrufe): Stream wird nur angezapft.
 *  - Elemente mit Datei/Stream derselben Herkunft (inkl. blob:/MSE, also
 *    YouTube & Co.): Ton wird über createMediaElementSource umgeleitet,
 *    weiterhin an die Lautsprecher und zusätzlich an die Aufnahme.
 *  - Elemente von fremder Domain ohne CORS werden NICHT angefasst: Web Audio
 *    würde sie stumm schalten. Sie spielen normal weiter, fehlen aber in der
 *    Aufnahme.
 */
(() => {
  'use strict';

  const SCHLUESSEL = '__audioMitschnittAbgriff';
  if (window[SCHLUESSEL]) {
    window[SCHLUESSEL].verbinden();
    return;
  }

  const SAMPLERATE = 48000;
  const erstelleAbgriff = globalThis.erstelleAbgriff; // aus lib/abgriff.js (vorher eingefügt)

  function herkunft(el) {
    if (el.srcObject) return 'stream';
    const src = el.currentSrc || el.src;
    if (!src) return 'leer';
    let url;
    try { url = new URL(src, location.href); } catch (_) { return 'fremd'; }
    if (url.protocol === 'blob:' || url.protocol === 'data:' || url.protocol === 'mediasource:') return 'eigen';
    if (url.origin === location.origin) return 'eigen';
    if (el.crossOrigin !== null && el.crossOrigin !== undefined) return 'eigen'; // lädt nur mit CORS
    return 'fremd';
  }

  const zustand = {
    ctx: null,
    abgriff: null,
    port: null,
    behandelt: new WeakMap(), // Element -> 'erfasst' | 'fremd' | 'blockiert'
    quellen: new WeakMap(), // Element -> AudioNode (bleibt bestehen)
    angeschlossen: new Set(), // AudioNodes, die am aktuellen Abgriff hängen
    inArbeit: new WeakSet(),
    zaehler: { erfasst: 0, fremd: 0, blockiert: 0 },
    beobachter: null,
  };

  function senden(nachricht) {
    if (!zustand.port) return;
    try { zustand.port.postMessage(nachricht); } catch (_) { trennen(); }
  }

  function info() {
    senden({ typ: 'info', ...zustand.zaehler });
  }

  async function kontext() {
    if (!zustand.ctx) {
      zustand.ctx = new AudioContext({ sampleRate: SAMPLERATE });
    }
    if (zustand.ctx.state !== 'running') {
      await Promise.race([zustand.ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
    }
    if (!zustand.abgriff && zustand.port) {
      zustand.abgriff = erstelleAbgriff(zustand.ctx, (l, r) => {
        if (zustand.zaehler.erfasst > 0) senden({ typ: 'pcm', l, r });
      });
    }
    return zustand.ctx.state === 'running' ? zustand.ctx : null;
  }

  function zaehlen(el, art) {
    const vorher = zustand.behandelt.get(el);
    if (vorher === art) return;
    if (vorher) zustand.zaehler[vorher]--;
    zustand.behandelt.set(el, art);
    zustand.zaehler[art]++;
    info();
  }

  async function erfassen(el) {
    if (!zustand.port || zustand.inArbeit.has(el)) return;
    const bisher = zustand.behandelt.get(el);
    if (bisher === 'erfasst' || bisher === 'fremd') return;
    const art = herkunft(el);
    if (art === 'leer') return; // später beim Abspielen erneut versuchen
    if (art === 'fremd') { zaehlen(el, 'fremd'); return; }
    zustand.inArbeit.add(el);
    try {
      await anschliessen(el, art);
    } finally {
      zustand.inArbeit.delete(el);
    }
  }

  async function anschliessen(el, art) {
    const ctx = await kontext();
    if (!ctx || !zustand.abgriff) { zaehlen(el, 'blockiert'); return; } // Autoplay-Sperre: nichts anfassen
    let knoten = zustand.quellen.get(el);
    try {
      if (!knoten) {
        if (art === 'stream') {
          if (!el.srcObject.getAudioTracks().length) return;
          knoten = ctx.createMediaStreamSource(el.srcObject);
        } else {
          knoten = ctx.createMediaElementSource(el);
          knoten.connect(ctx.destination); // weiterhin hörbar
        }
        zustand.quellen.set(el, knoten);
      }
      knoten.connect(zustand.abgriff.eingang);
      zustand.angeschlossen.add(knoten);
      zaehlen(el, 'erfasst');
    } catch (fehler) {
      // z. B. Seite nutzt das Element schon selbst mit Web Audio
      zaehlen(el, 'fremd');
    }
  }

  function alleSuchen() {
    document.querySelectorAll('audio, video').forEach((el) => { erfassen(el); });
  }

  function beiMedienEreignis(e) {
    if (e.target instanceof HTMLMediaElement) erfassen(e.target);
  }

  function verbinden() {
    if (zustand.port) return;
    zustand.port = browser.runtime.connect({ name: 'audio-mitschnitt-abgriff' });
    zustand.port.onMessage.addListener((m) => { if (m.typ === 'stopp') trennen(); });
    zustand.port.onDisconnect.addListener(trennen);
    zustand.zaehler = { erfasst: 0, fremd: 0, blockiert: 0 };
    zustand.behandelt = new WeakMap();
    document.addEventListener('play', beiMedienEreignis, true);
    document.addEventListener('playing', beiMedienEreignis, true);
    document.addEventListener('loadedmetadata', beiMedienEreignis, true);
    document.addEventListener('click', alleSuchen, true); // hebt ggf. Autoplay-Sperre auf
    zustand.beobachter = new MutationObserver(alleSuchen);
    zustand.beobachter.observe(document.documentElement, { childList: true, subtree: true });
    alleSuchen();
    info();
  }

  function trennen() {
    if (zustand.abgriff) {
      for (const knoten of zustand.angeschlossen) {
        try { knoten.disconnect(zustand.abgriff.eingang); } catch (_) { /* schon getrennt */ }
      }
      zustand.abgriff.trennen(); // umgeleitete Elemente bleiben über ctx.destination hörbar
    }
    zustand.angeschlossen.clear();
    zustand.abgriff = null;
    if (zustand.beobachter) zustand.beobachter.disconnect();
    zustand.beobachter = null;
    document.removeEventListener('play', beiMedienEreignis, true);
    document.removeEventListener('playing', beiMedienEreignis, true);
    document.removeEventListener('loadedmetadata', beiMedienEreignis, true);
    document.removeEventListener('click', alleSuchen, true);
    const port = zustand.port;
    zustand.port = null;
    if (port) { try { port.disconnect(); } catch (_) { /* schon getrennt */ } }
  }

  window[SCHLUESSEL] = { verbinden };
  verbinden();
})();
