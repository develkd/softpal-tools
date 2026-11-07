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
      trennen() {
        aktiv = false;
        prozessor.onaudioprocess = null;
        try { eingang.disconnect(); } catch (_) { /* schon getrennt */ }
        try { prozessor.disconnect(); } catch (_) { /* schon getrennt */ }
        try { stumm.disconnect(); } catch (_) { /* schon getrennt */ }
      },
    };
  }

  wurzel.erstelleAbgriff = erstelleAbgriff;
})(typeof globalThis !== 'undefined' ? globalThis : this);
