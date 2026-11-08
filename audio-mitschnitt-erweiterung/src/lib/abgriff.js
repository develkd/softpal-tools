/*
 * Abgriff: zapft ein Audiosignal in einem AudioContext an und liefert
 * Stereo-Blöcke (Float32Array links/rechts) an einen Rückruf.
 *
 * Bewusst ScriptProcessorNode statt AudioWorklet: funktioniert ohne
 * Modul-URL auch in Firefox-Inhaltsskripten und überall gleich.
 */
(function (wurzel) {
  'use strict';

  function erstelleAbgriff(ctx, beiDaten, blockgroesse = 4096) {
    const eingang = ctx.createGain();
    const prozessor = ctx.createScriptProcessor(blockgroesse, 2, 2);
    const stumm = ctx.createGain();
    stumm.gain.value = 0; // Prozessor muss am Ausgang hängen, darf aber nichts ausgeben
    eingang.channelCount = 2;
    eingang.channelCountMode = 'explicit';
    eingang.channelInterpretation = 'speakers'; // Mono -> beide Seiten
    let aktiv = true;
    prozessor.onaudioprocess = (e) => {
      if (!aktiv) return;
      const ein = e.inputBuffer;
      const l = new Float32Array(ein.getChannelData(0));
      const r = ein.numberOfChannels > 1 ? new Float32Array(ein.getChannelData(1)) : l;
      beiDaten(l, r);
    };
    eingang.connect(prozessor);
    prozessor.connect(stumm);
    stumm.connect(ctx.destination);
    return {
      eingang,
      art: 'ScriptProcessor',
      trennen() {
        aktiv = false;
        prozessor.onaudioprocess = null;
        try { eingang.disconnect(); } catch (_) { /* schon getrennt */ }
        try { prozessor.disconnect(); } catch (_) { /* schon getrennt */ }
        try { stumm.disconnect(); } catch (_) { /* schon getrennt */ }
      },
    };
  }

  /**
   * Wie erstelleAbgriff, aber mit AudioWorklet (verlustfrei auch bei
   * beschäftigtem Hauptthread). Fällt auf ScriptProcessor zurück, wenn
   * AudioWorklet nicht verfügbar ist.
   */
  async function erstelleAbgriffWorklet(ctx, beiDaten, modulUrl) {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return erstelleAbgriff(ctx, beiDaten);
    try {
      // manche Seiten verbieten das Laden (CSP) oder es hängt: nach 2 s aufgeben
      await Promise.race([
        ctx.audioWorklet.addModule(modulUrl),
        new Promise((_, nein) => setTimeout(() => nein(new Error('Zeitüberschreitung')), 2000)),
      ]);
    } catch (_) {
      return erstelleAbgriff(ctx, beiDaten);
    }
    const knoten = new AudioWorkletNode(ctx, 'audio-mitschnitt-abgriff', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers', // Mono -> beide Seiten
    });
    const stumm = ctx.createGain();
    stumm.gain.value = 0; // am Ausgang hängen, damit sicher verarbeitet wird
    knoten.connect(stumm);
    stumm.connect(ctx.destination);
    let aktiv = true;
    knoten.port.onmessage = (e) => { if (aktiv) beiDaten(e.data.l, e.data.r); };
    return {
      eingang: knoten,
      art: 'AudioWorklet',
      trennen() {
        aktiv = false;
        knoten.port.postMessage('stopp');
        knoten.port.onmessage = null;
        try { knoten.disconnect(); } catch (_) { /* schon getrennt */ }
        try { stumm.disconnect(); } catch (_) { /* schon getrennt */ }
      },
    };
  }

  /**
   * Abgriff direkt an einer MediaStream-Tonspur (MediaStreamTrackProcessor):
   * liefert die Daten im Takt der Quelle, ganz ohne AudioContext. So gibt es
   * keine zweite Uhr, deren Abweichung Chrome mit Aussetzern ausgleichen
   * müsste. Gibt null zurück, wenn der Browser das nicht kann.
   * beiDaten(links, rechts, sampleRate)
   */
  function erstelleSpurAbgriff(spur, beiDaten) {
    if (typeof MediaStreamTrackProcessor === 'undefined') return null;
    let leser;
    try {
      leser = new MediaStreamTrackProcessor({ track: spur }).readable.getReader();
    } catch (_) {
      return null;
    }
    let aktiv = true;
    (async () => {
      while (aktiv) {
        let ergebnis;
        try {
          ergebnis = await leser.read();
        } catch (_) {
          break;
        }
        if (ergebnis.done) break;
        const daten = ergebnis.value;
        try {
          const n = daten.numberOfFrames;
          const l = new Float32Array(n);
          daten.copyTo(l, { planeIndex: 0, format: 'f32-planar' });
          let r = l;
          if (daten.numberOfChannels > 1) {
            r = new Float32Array(n);
            daten.copyTo(r, { planeIndex: 1, format: 'f32-planar' });
          }
          if (aktiv) beiDaten(l, r, daten.sampleRate);
        } finally {
          daten.close();
        }
      }
    })();
    return {
      art: 'MediaStreamTrackProcessor',
      trennen() {
        aktiv = false;
        leser.cancel().catch(() => {});
      },
    };
  }

  wurzel.erstelleAbgriff = erstelleAbgriff;
  wurzel.erstelleAbgriffWorklet = erstelleAbgriffWorklet;
  wurzel.erstelleSpurAbgriff = erstelleSpurAbgriff;
})(typeof globalThis !== 'undefined' ? globalThis : this);
