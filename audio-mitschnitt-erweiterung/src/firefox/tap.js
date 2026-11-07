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
 *
 * Wichtig: Der AudioContext läuft mit der Standardrate von Firefox. Mit fest
 * vorgegebener Rate verweigert Firefox das Anschließen von Medienelementen
 * (Bug 1725336/937718); die Umrechnung erledigt die Hintergrundseite.
 */
(() => {
  'use strict';

  const SCHLUESSEL = '__audioMitschnittAbgriff';
  if (window[SCHLUESSEL]) {
    window[SCHLUESSEL].verbinden();
    return;
  }

  // aus lib/abgriff.js (vorher eingefügt): bevorzugt AudioWorklet (kein Datenverlust,
  // wenn die Seite den Hauptthread auslastet), sonst ScriptProcessor
  const erstelleAbgriff = globalThis.erstelleAbgriff;
  const erstelleAbgriffWorklet = globalThis.erstelleAbgriffWorklet;

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
    behandelt: new WeakMap(), // Element -> 'erfasst' | 'fremd' | 'blockiert' | 'fehler'
    quellen: new WeakMap(), // Element -> AudioNode (bleibt bestehen)
    angeschlossen: new Set(), // AudioNodes, die am aktuellen Abgriff hängen
    inArbeit: new WeakSet(),
    zaehler: { erfasst: 0, fremd: 0, blockiert: 0, fehler: 0 },
    fehlertext: '',
    beobachter: null,
    // Diagnose (Popup -> "Diagnose"): was passiert wirklich in dieser Seite?
    diag: { gesendet: 0, fehler: [] },
    diagTimer: null,
  };

  function protokoll(fehler) {
    const text = `${fehler && fehler.name ? `${fehler.name}: ` : ''}${fehler && fehler.message ? fehler.message : fehler}`;
    zustand.diag.fehler.push(text);
    if (zustand.diag.fehler.length > 5) zustand.diag.fehler.shift();
  }

  function diagnose() {
    const elemente = Array.from(document.querySelectorAll('audio, video')).map((el) => {
      let art = '?';
      try { art = herkunft(el); } catch (e) { art = `Fehler ${e}`; }
      return `${el.tagName.toLowerCase()} ${art} ${zustand.behandelt.get(el) || 'unbehandelt'}` +
        `${el.paused ? ' pausiert' : ' spielt'}${el.muted ? ' stumm' : ''}`;
    });
    return {
      typ: 'diag',
      seite: location.host + location.pathname.slice(0, 30),
      oben: window.top === window,
      abgriffFunktion: typeof erstelleAbgriff,
      ctx: zustand.ctx ? `${zustand.ctx.state} ${zustand.ctx.sampleRate} Hz` : 'keiner',
      abgriff: zustand.abgriff ? zustand.abgriff.art || 'ja' : false,
      elemente,
      gesendet: zustand.diag.gesendet,
      fehler: zustand.diag.fehler.slice(),
    };
  }

  function senden(nachricht) {
    if (!zustand.port) return;
    try { zustand.port.postMessage(nachricht); } catch (_) { trennen(); }
  }

  function info() {
    senden({ typ: 'info', ...zustand.zaehler, fehlertext: zustand.fehlertext });
  }

  async function kontext() {
    if (!zustand.ctx) {
      zustand.ctx = new AudioContext(); // bewusst ohne sampleRate, s. o.
    }
    if (zustand.ctx.state !== 'running') {
      await Promise.race([zustand.ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
    }
    if (!zustand.abgriff && zustand.port) {
      if (!zustand.abgriffWird) {
        const rate = zustand.ctx.sampleRate;
        const beiDaten = (l, r) => {
          if (zustand.zaehler.erfasst <= 0 || !zustand.port) return;
          try {
            senden({ typ: 'pcm', l, r, rate });
            zustand.diag.gesendet++;
          } catch (fehler) {
            protokoll(fehler);
          }
        };
        zustand.abgriffWird = (erstelleAbgriffWorklet
          ? erstelleAbgriffWorklet(zustand.ctx, beiDaten, browser.runtime.getURL('lib/abgriff-worklet.js'))
          : Promise.resolve(erstelleAbgriff(zustand.ctx, beiDaten)))
          .finally(() => { zustand.abgriffWird = null; });
      }
      const neu = await zustand.abgriffWird;
      if (!zustand.abgriff) zustand.abgriff = neu;
      else if (neu !== zustand.abgriff) neu.trennen();
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
    if (bisher === 'erfasst' || bisher === 'fremd' || bisher === 'fehler') return;
    const art = herkunft(el);
    if (art === 'leer') return; // später beim Abspielen erneut versuchen
    if (art === 'fremd') { zaehlen(el, 'fremd'); return; }
    zustand.inArbeit.add(el);
    try {
      await anschliessen(el, art);
    } catch (fehler) {
      // Fehler sichtbar machen (Popup), statt ihn zu verschlucken
      zustand.fehlertext = `${fehler && fehler.name ? `${fehler.name}: ` : ''}${fehler && fehler.message ? fehler.message : fehler}`;
      protokoll(fehler);
      zaehlen(el, 'fehler');
    } finally {
      zustand.inArbeit.delete(el);
    }
  }

  async function anschliessen(el, art) {
    const ctx = await kontext();
    if (!ctx || !zustand.abgriff) { zaehlen(el, 'blockiert'); return; } // Autoplay-Sperre: nichts anfassen
    let knoten = zustand.quellen.get(el);
    if (!knoten) {
      if (art === 'stream') {
        if (!el.srcObject.getAudioTracks().length) return;
        knoten = ctx.createMediaStreamSource(el.srcObject);
      } else {
        // wirft z. B., wenn die Seite das Element schon selbst mit Web Audio nutzt
        knoten = ctx.createMediaElementSource(el);
        knoten.connect(ctx.destination); // weiterhin hörbar
      }
      zustand.quellen.set(el, knoten);
    }
    knoten.connect(zustand.abgriff.eingang);
    zustand.angeschlossen.add(knoten);
    zaehlen(el, 'erfasst');
  }

  function alleSuchen() {
    try {
      document.querySelectorAll('audio, video').forEach((el) => { erfassen(el).catch(protokoll); });
    } catch (fehler) {
      protokoll(fehler);
    }
  }

  function beiMedienEreignis(e) {
    const el = e.target;
    if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) erfassen(el).catch(protokoll);
  }

  function verbinden() {
    if (zustand.port) return;
    zustand.port = browser.runtime.connect({ name: 'audio-mitschnitt-abgriff' });
    zustand.port.onMessage.addListener((m) => { if (m.typ === 'stopp') trennen(); });
    zustand.port.onDisconnect.addListener(trennen);
    zustand.zaehler = { erfasst: 0, fremd: 0, blockiert: 0, fehler: 0 };
    zustand.fehlertext = '';
    zustand.behandelt = new WeakMap();
    document.addEventListener('play', beiMedienEreignis, true);
    document.addEventListener('playing', beiMedienEreignis, true);
    document.addEventListener('loadedmetadata', beiMedienEreignis, true);
    document.addEventListener('click', alleSuchen, true); // hebt ggf. Autoplay-Sperre auf
    zustand.beobachter = new MutationObserver(alleSuchen);
    zustand.beobachter.observe(document.documentElement, { childList: true, subtree: true });
    alleSuchen();
    info();
    zustand.diagTimer = setInterval(() => {
      try { senden(diagnose()); } catch (fehler) { protokoll(fehler); }
    }, 1000);
  }

  function trennen() {
    if (zustand.diagTimer) clearInterval(zustand.diagTimer);
    zustand.diagTimer = null;
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
