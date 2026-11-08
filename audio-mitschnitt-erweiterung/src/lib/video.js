/*
 * Video-Aufnahme in der Webseite (Inhaltsskript, Chrome und Firefox).
 *
 * Nimmt das größte sichtbare <video>-Element der Seite als MP4 auf:
 *  - Bild: Element -> Canvas -> VideoFrame -> VideoEncoder (H.264, sonst VP9)
 *  - Ton:  Element -> Web Audio (bleibt hörbar) -> AudioWorklet-Abgriff ->
 *          AudioEncoder (AAC, sonst Opus)
 *  - MP4:  mp4-muxer, fragmentiert; die Daten gehen laufend per Port an die
 *          Erweiterung (kaum Speicher in der Seite, bei Abbruch bleibt das
 *          Bisherige erhalten).
 *
 * Benötigt vorher eingefügt: lib/mp4-muxer.js, lib/mp4-bloecke.js, lib/abgriff.js,
 * lib/resampler.js, lib/medienquelle.js.
 *
 * Port "audio-mitschnitt-video":
 *   -> {typ:'kandidat', flaeche, spielt, breite, hoehe, seite}
 *   <- {typ:'start'} | {typ:'stopp'} (speichern) | {typ:'abbruch'}
 *   -> {typ:'gestartet', breite, hoehe, video, audio} | {typ:'daten', b64}
 *      {typ:'status', sekunden, bilder, verworfen} | {typ:'fehler', text} | {typ:'ende'}
 */
(() => {
  'use strict';

  const api = globalThis.browser || globalThis.chrome;
  const SCHLUESSEL = '__audioMitschnittVideo';
  if (window[SCHLUESSEL]) {
    window[SCHLUESSEL].verbinden();
    return;
  }

  const Muxer = globalThis.Mp4Muxer;
  const BILDRATE = 30;
  const AUDIO_RATE = 48000;
  const medien = globalThis.__audioMitschnittMedien;

  // ---- Hilfen --------------------------------------------------------------
  function sichtbareFlaeche(el) {
    const r = el.getBoundingClientRect();
    const b = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return b * h;
  }

  function bestesVideo() {
    const videos = Array.from(document.querySelectorAll('video')).filter((v) => v.videoWidth > 0);
    videos.sort((a, b) => (Number(!b.paused) - Number(!a.paused)) || (sichtbareFlaeche(b) - sichtbareFlaeche(a)));
    return videos[0] || null;
  }

  function base64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  /** Zielgröße: höchstens 1920×1080, Seitenverhältnis bleibt, gerade Maße. */
  function zielgroesse(w, h) {
    const f = Math.min(1, 1920 / w, 1080 / h);
    const gerade = (x) => Math.max(2, Math.round((x * f) / 2) * 2);
    return [gerade(w), gerade(h)];
  }

  const warte = (ms) => new Promise((_, nein) => setTimeout(() => nein(new Error('Zeitüberschreitung')), ms));

  /**
   * Probelauf: Encoder mit dieser Einstellung anlegen, ein Testbild bzw. kurze
   * Stille kodieren und auf Ausgabe warten. Firefox meldet bei
   * isConfigSupported teils "unterstützt" und scheitert erst beim Kodieren
   * ("The given encoding is not supported") – daher echt ausprobieren.
   */
  async function probelauf(art, config) {
    let ausgaben = 0;
    let fehler = null;
    const init = { output: () => { ausgaben++; }, error: (f) => { fehler = f; } };
    const enc = art === 'video' ? new VideoEncoder(init) : new AudioEncoder(init);
    try {
      enc.configure(config);
      if (art === 'video') {
        const c = new OffscreenCanvas(config.width, config.height);
        c.getContext('2d').fillRect(0, 0, 2, 2);
        const bild = new VideoFrame(c, { timestamp: 0, duration: 33333 });
        enc.encode(bild, { keyFrame: true });
        bild.close();
      } else {
        const n = 2048;
        const daten = new AudioData({
          format: 'f32-planar', sampleRate: config.sampleRate, numberOfFrames: n,
          numberOfChannels: config.numberOfChannels, timestamp: 0, data: new Float32Array(n * config.numberOfChannels),
        });
        enc.encode(daten);
        daten.close();
      }
      await Promise.race([enc.flush(), warte(4000)]);
    } catch (f) {
      fehler = fehler || f;
    }
    try { enc.close(); } catch (_) { /* schon zu */ }
    return fehler ? `${fehler.name || 'Fehler'}: ${fehler.message || fehler}` : ausgaben > 0 ? null : 'keine Ausgabe';
  }

  /** Erste Einstellung, die isConfigSupported bejaht UND im Probelauf funktioniert. */
  async function ersteFunktionierende(art, kandidaten) {
    const Enc = art === 'video' ? VideoEncoder : AudioEncoder;
    const versucht = [];
    for (const k of kandidaten) {
      try {
        const antwort = await Enc.isConfigSupported(k.config);
        if (!antwort.supported) { versucht.push(`${k.config.codec}: nicht unterstützt`); continue; }
      } catch (f) {
        versucht.push(`${k.config.codec}: ${f.message || f}`);
        continue;
      }
      const problem = await probelauf(art, k.config);
      if (!problem) return { ...k, versucht };
      versucht.push(`${k.config.codec}: ${problem}`);
    }
    return { versucht };
  }

  async function videoCodec(breite, hoehe, bitrate) {
    const basis = { width: breite, height: hoehe, bitrate, framerate: BILDRATE };
    const kandidaten = [];
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42001f', 'avc1.42e01f']) {
      kandidaten.push({ config: { ...basis, codec, avc: { format: 'avc' }, latencyMode: 'quality' }, mux: 'avc', name: 'H.264' });
      kandidaten.push({ config: { ...basis, codec, avc: { format: 'avc' } }, mux: 'avc', name: 'H.264' });
    }
    for (const codec of ['vp09.00.40.08', 'vp09.00.10.08']) kandidaten.push({ config: { ...basis, codec }, mux: 'vp9', name: 'VP9' });
    kandidaten.push({ config: { ...basis, codec: 'av01.0.08M.08' }, mux: 'av1', name: 'AV1' });
    return ersteFunktionierende('video', kandidaten);
  }

  async function audioCodec() {
    const basis = { sampleRate: AUDIO_RATE, numberOfChannels: 2 };
    return ersteFunktionierende('audio', [
      { config: { ...basis, codec: 'mp4a.40.2', bitrate: 160000 }, mux: 'aac', name: 'AAC' },
      { config: { ...basis, codec: 'opus', bitrate: 128000 }, mux: 'opus', name: 'Opus' },
      { config: { ...basis, codec: 'opus' }, mux: 'opus', name: 'Opus' },
    ]);
  }

  // ---- Aufnahme --------------------------------------------------------------
  let port = null;
  let aufnahme = null;
  let schritt = ''; // aktueller Arbeitsschritt, für verständliche Fehlermeldungen

  function senden(m) {
    if (!port) return;
    try { port.postMessage(m); } catch (_) { /* Port weg */ }
  }

  const blockHinzufuegen = globalThis.__audioMitschnittBlockHinzufuegen; // lib/mp4-bloecke.js

  function fehlerText(fehler, schritt) {
    const name = fehler && fehler.name && fehler.name !== 'Error' ? `${fehler.name}: ` : '';
    return `${schritt ? `[${schritt}] ` : ''}${name}${fehler && fehler.message ? fehler.message : fehler}`;
  }

  async function starten() {
    if (aufnahme) return;
    schritt = 'Prüfen';
    if (!Muxer || !blockHinzufuegen) throw new Error('MP4-Bibliothek nicht geladen (lib/mp4-muxer.js, lib/mp4-bloecke.js).');
    if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      throw new Error('Dieser Browser kann keine Videos kodieren (WebCodecs fehlt). Firefox ab Version 130 bzw. Chrome ab 94 nötig.');
    }
    const el = bestesVideo();
    if (!el) throw new Error('Kein Video auf der Seite gefunden.');
    const [breite, hoehe] = zielgroesse(el.videoWidth, el.videoHeight);
    const leinwand = new OffscreenCanvas(breite, hoehe);
    const zeichner = leinwand.getContext('2d');

    // Fremde Domain / geschützt? Ein Probebild zeigt es (SecurityError).
    schritt = 'Probebild';
    try {
      zeichner.drawImage(el, 0, 0, breite, hoehe);
      new VideoFrame(leinwand, { timestamp: 0 }).close();
    } catch (fehler) {
      if (fehler && fehler.name === 'SecurityError') throw new Error('Dieses Video ist gegen Aufnahme geschützt (fremde Domain).');
      throw fehler;
    }

    const bitrate = Math.max(1e6, Math.min(8e6, Math.round(breite * hoehe * BILDRATE * 0.1)));
    schritt = 'Video-Encoder';
    const vCodec = await videoCodec(breite, hoehe, bitrate);
    if (!vCodec.config) throw new Error(`Kein funktionierender Video-Encoder (H.264/VP9/AV1). Versucht: ${vCodec.versucht.join('; ')}`);
    schritt = 'Ton-Encoder';
    const ton = await audioCodec();
    const aCodec = ton.config ? ton : null;

    // Ton anschließen (falls möglich)
    schritt = 'Ton';
    let ctx = null;
    let tonQuelle = null;
    let tonHinweis = '';
    if (aCodec && medien) {
      try {
        ctx = await medien.kontext();
        if (ctx.state !== 'running') throw new Error('Ton blockiert – einmal in die Seite klicken');
        tonQuelle = medien.quelle(ctx, el);
      } catch (fehler) {
        tonHinweis = `ohne Ton (${fehler.message || fehler})`;
        tonQuelle = null;
      }
    } else if (!aCodec) {
      tonHinweis = `ohne Ton (kein Audio-Encoder: ${ton.versucht.join('; ')})`;
    }

    const a = {
      el, breite, hoehe, leinwand, zeichner, t0: performance.now(), aktiv: true,
      bilder: 0, verworfen: 0, letzterKey: -Infinity, letzterPlatz: -1, neuesBild: true, puffer: [], pufferBytes: 0,
      position: 0, audioTs: null, uhrProben: [], uhrVersatz: null, mitTon: false, abgriff: null, timer: null, statusTimer: null, fehler: null,
    };
    aufnahme = a;

    const fehlerMelden = (fehler, herkunft) => {
      if (a.fehler) return;
      a.fehler = fehler;
      senden({ typ: 'fehler', text: fehlerText(fehler, herkunft) });
    };

    schritt = 'MP4';
    a.muxer = new Muxer.Muxer({
      target: new Muxer.StreamTarget({
        onData: (daten, position) => {
          if (position !== a.position) fehlerMelden(new Error(`MP4-Daten nicht fortlaufend (${position} ≠ ${a.position})`));
          a.position = position + daten.length;
          a.puffer.push(daten.slice());
          a.pufferBytes += daten.length;
          if (a.pufferBytes > 512 * 1024) pufferSenden(a);
        },
      }),
      video: { codec: vCodec.mux, width: breite, height: hoehe },
      audio: tonQuelle ? { codec: aCodec.mux, numberOfChannels: 2, sampleRate: AUDIO_RATE } : undefined,
      fastStart: 'fragmented',
      minFragmentDuration: 1,
      firstTimestampBehavior: 'cross-track-offset',
    });

    schritt = 'Video-Encoder starten';
    a.videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        try { blockHinzufuegen(a.muxer, 'video', chunk, meta, Math.round(1e6 / BILDRATE)); } catch (f) { fehlerMelden(f, 'MP4 Video'); }
      },
      error: (f) => fehlerMelden(f, `Video-Encoder ${vCodec.config.codec}`),
    });
    a.videoEncoder.configure(vCodec.config);

    if (tonQuelle) {
      schritt = 'Ton-Encoder starten';
      a.audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          // Ersatzdauer: AAC-Rahmen 1024 Samples (Opus meist 20 ms)
          try { blockHinzufuegen(a.muxer, 'audio', chunk, meta, Math.round((1024 / AUDIO_RATE) * 1e6)); } catch (f) { fehlerMelden(f, 'MP4 Ton'); }
        },
        error: (f) => fehlerMelden(f, `Ton-Encoder ${aCodec.config.codec}`),
      });
      a.audioEncoder.configure(aCodec.config);
      const resampler = ctx.sampleRate !== AUDIO_RATE ? new Resampler(ctx.sampleRate, AUDIO_RATE) : null;
      const beiTon = (l, r) => {
        if (!a.aktiv || a.fehler) return;
        if (resampler) ({ links: l, rechts: r } = resampler.verarbeiten(l, r));
        const n = l.length;
        if (!n) return;
        if (a.audioTs === null) a.audioTs = Math.max(0, (performance.now() - a.t0) * 1000 - (n / AUDIO_RATE) * 1e6);
        const planar = new Float32Array(2 * n);
        planar.set(l, 0);
        planar.set(r, n);
        const daten = new AudioData({
          format: 'f32-planar', sampleRate: AUDIO_RATE, numberOfFrames: n, numberOfChannels: 2,
          timestamp: Math.round(a.audioTs), data: planar,
        });
        a.audioTs += (n / AUDIO_RATE) * 1e6;
        // Tonuhr: Die Bilder werden auf die Uhr des Tons gestempelt, damit Bild und
        // Ton nicht auseinanderlaufen (Soundkarte und Rechneruhr gehen nie exakt
        // gleich: gemessen bis 0,27 %, also ~10 s/Stunde). Versatz Rechneruhr –
        // Tonuhr = Minimum über die letzten Blöcke: verspätet zugestellte Blöcke
        // (z. B. während die Encoder starten) verfälschen ihn so nicht.
        a.uhrProben.push(performance.now() - a.audioTs / 1000);
        if (a.uhrProben.length > 64) a.uhrProben.shift();
        a.uhrVersatz = Math.min(...a.uhrProben);
        try { a.audioEncoder.encode(daten); } catch (f) { fehlerMelden(f); }
        daten.close();
      };
      a.abgriff = globalThis.erstelleAbgriffWorklet
        ? await erstelleAbgriffWorklet(ctx, beiTon, api.runtime.getURL('lib/abgriff-worklet.js'))
        : erstelleAbgriff(ctx, beiTon);
      tonQuelle.connect(a.abgriff.eingang);
      a.tonQuelle = tonQuelle;
      a.mitTon = true;
    }

    // Bilder: im Takt von 30/s; ist das Bild sichtbar, nur wenn wirklich ein
    // neues Videobild kam (requestVideoFrameCallback), sonst bei laufendem Video.
    if (el.requestVideoFrameCallback) {
      const neu = () => { if (!a.aktiv) return; a.neuesBild = true; el.requestVideoFrameCallback(neu); };
      el.requestVideoFrameCallback(neu);
    }
    a.timer = setInterval(() => bildAufnehmen(a, fehlerMelden), 1000 / BILDRATE);
    a.statusTimer = setInterval(() => {
      senden({
        typ: 'status', sekunden: (performance.now() - a.t0) / 1000, bilder: a.bilder, verworfen: a.verworfen,
        tonSekunden: a.audioTs != null ? a.audioTs / 1e6 : null, letztesBildSek: a.letzterPlatz / BILDRATE,
        uhrStreuung: a.uhrProben.length ? Math.round(Math.max(...a.uhrProben) - Math.min(...a.uhrProben)) : null,
      });
      pufferSenden(a);
    }, 1000);

    schritt = 'läuft';
    senden({
      typ: 'gestartet', breite, hoehe,
      video: `${vCodec.name} (${vCodec.config.codec})`, audio: tonQuelle ? `${aCodec.name} (${aCodec.config.codec})` : tonHinweis || 'ohne Ton',
      versucht: [...vCodec.versucht, ...(ton.versucht || [])],
    });
  }

  function bildAufnehmen(a, fehlerMelden) {
    if (!a.aktiv || a.fehler) return;
    const el = a.el;
    if (el.paused || el.readyState < 2) return;
    const sichtbarMitRvfc = el.requestVideoFrameCallback && !document.hidden;
    if (sichtbarMitRvfc && !a.neuesBild) return; // kein neues Videobild seit dem letzten Mal
    a.neuesBild = false;
    // erst bei ~1 s Rückstand Bilder auslassen (Anlaufen des Encoders soll nichts kosten)
    if (a.videoEncoder.encodeQueueSize > BILDRATE) { a.verworfen++; return; } // Rechner kommt nicht hinterher
    // Zeit nach der Tonuhr (ohne Ton: Rechneruhr), dann auf das 30-fps-Raster
    // legen, höchstens ein Bild je Rasterplatz (gleichmäßige Wiedergabe)
    const jetzt = performance.now();
    // mit Ton: erst Bilder, wenn die Tonuhr läuft (sonst Sprung beim Wechsel der Uhr);
    // kommt nach 1,5 s kein Ton, auf die Rechneruhr ausweichen
    if (a.mitTon && a.uhrVersatz === null && jetzt - a.t0 < 1500) return;
    const sekunden = a.uhrVersatz !== null ? (jetzt - a.uhrVersatz) / 1000 : (jetzt - a.t0) / 1000;
    const platz = Math.round(sekunden * BILDRATE);
    if (platz <= a.letzterPlatz) return;
    a.letzterPlatz = platz;
    const ts = Math.round((platz * 1e6) / BILDRATE);
    try {
      a.zeichner.drawImage(el, 0, 0, a.breite, a.hoehe);
      const bild = new VideoFrame(a.leinwand, { timestamp: ts, duration: Math.round(1e6 / BILDRATE) });
      const schluessel = ts - a.letzterKey >= 2e6; // alle 2 s ein Schlüsselbild
      if (schluessel) a.letzterKey = ts;
      a.videoEncoder.encode(bild, { keyFrame: schluessel });
      bild.close();
      a.bilder++;
    } catch (fehler) {
      fehlerMelden(fehler);
    }
  }

  function pufferSenden(a) {
    if (!a.puffer.length) return;
    const gesamt = new Uint8Array(a.pufferBytes);
    let pos = 0;
    for (const teil of a.puffer) { gesamt.set(teil, pos); pos += teil.length; }
    a.puffer = [];
    a.pufferBytes = 0;
    senden({ typ: 'daten', b64: base64(gesamt) });
  }

  async function beenden(speichern) {
    const a = aufnahme;
    if (!a) return;
    a.aktiv = false;
    clearInterval(a.timer);
    clearInterval(a.statusTimer);
    if (a.abgriff) {
      try { a.tonQuelle.disconnect(a.abgriff.eingang); } catch (_) { /* schon getrennt */ }
      a.abgriff.trennen(); // Ton bleibt über die gemeinsame Quelle hörbar
    }
    if (speichern && !a.fehler) {
      try {
        await a.videoEncoder.flush();
        if (a.audioEncoder) await a.audioEncoder.flush();
        a.muxer.finalize();
      } catch (fehler) {
        senden({ typ: 'fehler', text: String(fehler.message || fehler) });
      }
      pufferSenden(a);
      senden({ typ: 'ende', bilder: a.bilder, sekunden: (performance.now() - a.t0) / 1000 });
    }
    try { a.videoEncoder.close(); } catch (_) { /* schon zu */ }
    try { if (a.audioEncoder) a.audioEncoder.close(); } catch (_) { /* schon zu */ }
    aufnahme = null;
  }

  function verbinden() {
    if (port) return;
    port = api.runtime.connect({ name: 'audio-mitschnitt-video' });
    port.onMessage.addListener((m) => {
      if (m.typ === 'start') {
        starten().catch((fehler) => {
          if (aufnahme) beenden(false);
          senden({ typ: 'fehler', text: fehlerText(fehler, schritt) });
        });
      } else if (m.typ === 'stopp') {
        beenden(true).finally(trennen);
      } else if (m.typ === 'abbruch') {
        beenden(false).finally(trennen);
      }
    });
    port.onDisconnect.addListener(() => { port = null; beenden(false); });
    const el = bestesVideo();
    senden({
      typ: 'kandidat',
      faehig: {
        webcodecs: typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined',
        muxer: Boolean(Muxer),
        abgriff: typeof globalThis.erstelleAbgriff,
        medien: Boolean(medien),
        videos: document.querySelectorAll('video').length,
      },
      flaeche: el ? Math.max(1, sichtbareFlaeche(el)) : 0,
      spielt: Boolean(el && !el.paused),
      breite: el ? el.videoWidth : 0,
      hoehe: el ? el.videoHeight : 0,
      seite: location.host,
    });
  }

  function trennen() {
    const p = port;
    port = null;
    if (p) { try { p.disconnect(); } catch (_) { /* schon getrennt */ } }
  }

  window[SCHLUESSEL] = { verbinden };
  verbinden();
})();
