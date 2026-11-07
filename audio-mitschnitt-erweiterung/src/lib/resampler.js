/*
 * Resampler: rechnet einen fortlaufenden Stereo-Datenstrom von einer
 * Abtastrate in eine andere um (lineare Interpolation, blockübergreifend).
 *
 * Wird gebraucht, weil Firefox Medienelemente nur in einen AudioContext mit
 * seiner Standardrate leiten kann; die Aufnahme läuft mit fester Rate.
 */
(function (wurzel) {
  'use strict';

  class Resampler {
    constructor(von, nach) {
      if (!(von > 0) || !(nach > 0)) throw new Error('ungültige Abtastrate');
      this.von = von;
      this.nach = nach;
      this.schritt = von / nach;
      this.pos = 0; // Position im Eingang relativ zum Anfang des nächsten Blocks (>= -1)
      this.letzteL = 0;
      this.letzteR = 0;
    }

    verarbeiten(links, rechts) {
      rechts = rechts || links; // Mono
      const n = links.length;
      if (n === 0) return { links: new Float32Array(0), rechts: new Float32Array(0) };
      const anzahl = Math.max(0, Math.ceil((n - 1 - this.pos) / this.schritt));
      const ausL = new Float32Array(anzahl);
      const ausR = new Float32Array(anzahl);
      let pos = this.pos;
      for (let k = 0; k < anzahl; k++) {
        const i = Math.floor(pos);
        const f = pos - i;
        const aL = i < 0 ? this.letzteL : links[i];
        const aR = i < 0 ? this.letzteR : rechts[i];
        ausL[k] = aL + (links[i + 1] - aL) * f;
        ausR[k] = aR + (rechts[i + 1] - aR) * f;
        pos += this.schritt;
      }
      this.pos = pos - n;
      this.letzteL = links[n - 1];
      this.letzteR = rechts[n - 1];
      return { links: ausL, rechts: ausR };
    }
  }

  wurzel.Resampler = Resampler;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Resampler };
})(typeof globalThis !== 'undefined' ? globalThis : this);
