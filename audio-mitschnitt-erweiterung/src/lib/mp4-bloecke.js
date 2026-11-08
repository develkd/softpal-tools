/*
 * Kodierte Blöcke (WebCodecs) an mp4-muxer übergeben – robust für alle Browser.
 *
 * - Manche Chrome-Versionen liefern Blöcke ohne Dauer (chunk.duration null);
 *   mp4-muxer bricht dann ab ("fourth argument (duration) must be a
 *   non-negative real number") -> Ersatzdauer verwenden.
 * - In Firefox stammen die Blöcke aus dem Seitenbereich, das Inhaltsskript
 *   läuft in einer Sandbox: mp4-muxers "instanceof EncodedVideoChunk" schlägt
 *   dort fehl -> Daten selbst kopieren und die "Raw"-Funktionen nutzen; die
 *   Codec-Beschreibung (meta) ebenfalls in eigenen Speicher holen.
 */
(function (wurzel) {
  'use strict';

  function blockHinzufuegen(muxer, art, block, meta, ersatzDauer) {
    const daten = new Uint8Array(block.byteLength);
    block.copyTo(daten);
    const dauer = Number.isFinite(block.duration) && block.duration >= 0 ? block.duration : ersatzDauer;
    let metaKopie;
    if (meta) {
      try { metaKopie = structuredClone(meta); } catch (_) { metaKopie = meta; }
    }
    const ts = Math.max(0, block.timestamp);
    if (art === 'video') muxer.addVideoChunkRaw(daten, block.type, ts, dauer, metaKopie);
    else muxer.addAudioChunkRaw(daten, block.type, ts, dauer, metaKopie);
  }

  wurzel.__audioMitschnittBlockHinzufuegen = blockHinzufuegen;
  if (typeof module !== 'undefined' && module.exports) module.exports = { blockHinzufuegen };
})(typeof globalThis !== 'undefined' ? globalThis : this);
