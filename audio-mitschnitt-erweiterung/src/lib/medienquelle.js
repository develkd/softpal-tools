/*
 * Gemeinsamer AudioContext und Web-Audio-Quellen je Medienelement für alle
 * Inhaltsskripte der Erweiterung in einer Seite (Ton- und Video-Aufnahme).
 *
 * createMediaElementSource darf je Element nur EINMAL aufgerufen werden;
 * Ton- und Video-Aufnahme müssen sich die Quelle daher teilen. Die Quelle
 * bleibt dauerhaft an die Lautsprecher angeschlossen (Ton bleibt hörbar).
 */
(function (wurzel) {
  'use strict';

  const SCHLUESSEL = '__audioMitschnittMedien';
  if (wurzel[SCHLUESSEL]) return;

  const zustand = { ctx: null, quellen: new WeakMap() };

  /** AudioContext mit Standardrate (Firefox verlangt das für Medienelemente). */
  async function kontext() {
    if (!zustand.ctx) zustand.ctx = new AudioContext();
    if (zustand.ctx.state !== 'running') {
      await Promise.race([zustand.ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
    }
    return zustand.ctx;
  }

  /**
   * Web-Audio-Quelle für ein <audio>/<video>-Element (einmalig angelegt).
   * Wirft, wenn die Seite das Element schon selbst an Web Audio hängt.
   */
  function quelle(ctx, el) {
    let knoten = zustand.quellen.get(el);
    if (!knoten) {
      if (el.srcObject && el.srcObject.getAudioTracks) {
        knoten = ctx.createMediaStreamSource(el.srcObject);
      } else {
        knoten = ctx.createMediaElementSource(el);
        knoten.connect(ctx.destination); // weiterhin hörbar
      }
      zustand.quellen.set(el, knoten);
    }
    return knoten;
  }

  wurzel[SCHLUESSEL] = { kontext, quelle, zustand };
})(typeof globalThis !== 'undefined' ? globalThis : this);
