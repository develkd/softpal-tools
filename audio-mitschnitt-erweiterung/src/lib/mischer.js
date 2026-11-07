/*
 * Mischer: sammelt PCM-Blöcke aus einer oder mehreren Quellen und gibt sie
 * im Takt der echten Uhrzeit als ein Stereo-Signal aus.
 *
 * - Fehlen Daten (Quelle stumm, Seite lädt neu, Element pausiert), wird
 *   Stille eingefügt. Die Aufnahme bleibt synchron zur realen Zeit.
 * - Mehrere Quellen (z. B. mehrere <video>-Elemente/Frames in Firefox)
 *   werden addiert.
 * - Ein kleiner Latenzpuffer verhindert, dass leicht verspätete Blöcke als
 *   Stille gewertet werden; driftet eine Quelle davon, wird gekürzt.
 *
 * Läuft als klassisches Skript (setzt globalThis.Mischer) und unter Node.
 */
(function (wurzel) {
  'use strict';

  // Abrunden mit Toleranz gegen Gleitkomma-Reste (999.9999999 -> 1000)
  function abrunden(x) {
    return Math.floor(x + 1e-6);
  }

  class Fifo {
    constructor() {
      this.links = [];
      this.rechts = [];
      this.versatz = 0; // bereits gelesene Frames im ersten Block
      this.laenge = 0;
    }

    anhaengen(l, r) {
      if (!l || l.length === 0) return;
      this.links.push(l);
      this.rechts.push(r || l);
      this.laenge += l.length;
    }

    /** Addiert bis zu n Frames in ziel (ab Position 0) und entfernt sie. */
    entnehmenAddieren(n, zielL, zielR) {
      let pos = 0;
      while (pos < n && this.links.length) {
        const l = this.links[0];
        const r = this.rechts[0];
        const anzahl = Math.min(n - pos, l.length - this.versatz);
        for (let i = 0; i < anzahl; i++) {
          zielL[pos + i] += l[this.versatz + i];
          zielR[pos + i] += r[this.versatz + i];
        }
        pos += anzahl;
        this.versatz += anzahl;
        this.laenge -= anzahl;
        if (this.versatz >= l.length) {
          this.links.shift();
          this.rechts.shift();
          this.versatz = 0;
        }
      }
      return pos;
    }

    verwerfen(n) {
      while (n > 0 && this.links.length) {
        const rest = this.links[0].length - this.versatz;
        const anzahl = Math.min(n, rest);
        this.versatz += anzahl;
        this.laenge -= anzahl;
        n -= anzahl;
        if (this.versatz >= this.links[0].length) {
          this.links.shift();
          this.rechts.shift();
          this.versatz = 0;
        }
      }
    }

    leeren() {
      this.verwerfen(this.laenge);
    }
  }

  class Mischer {
    /**
     * @param {object} o
     * @param {number} [o.sampleRate=48000]
     * @param {number} [o.latenz=0.3]     Sekunden Vorlauf für verspätete Blöcke
     * @param {number} [o.maxPuffer=1.0]  ab so viel Rückstand wird gekürzt
     * @param {() => number} [o.jetzt]    Uhr in Sekunden (für Tests austauschbar)
     */
    constructor(o = {}) {
      this.sampleRate = o.sampleRate || 48000;
      this.latenz = o.latenz ?? 0.3;
      this.maxPuffer = o.maxPuffer ?? 1.0;
      this.jetzt = o.jetzt || (() => performance.now() / 1000);
      this.quellen = new Map();
      this.sollFrames = 0;
      this.geschrieben = 0;
      this.letzte = null;
    }

    starten() {
      this.letzte = this.jetzt();
      this.sollFrames = 0;
      this.geschrieben = 0;
    }

    hinzufuegen(id, links, rechts) {
      let fifo = this.quellen.get(id);
      if (!fifo) {
        fifo = new Fifo();
        this.quellen.set(id, fifo);
      }
      fifo.anhaengen(links, rechts);
    }

    entfernen(id) {
      this.quellen.delete(id);
    }

    _uhr(pausiert) {
      const t = this.jetzt();
      if (!pausiert) this.sollFrames += (t - this.letzte) * this.sampleRate;
      this.letzte = t;
    }

    _mischen(n) {
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      for (const fifo of this.quellen.values()) fifo.entnehmenAddieren(n, l, r);
      if (this.quellen.size > 1) {
        for (let i = 0; i < n; i++) {
          l[i] = Math.max(-1, Math.min(1, l[i]));
          r[i] = Math.max(-1, Math.min(1, r[i]));
        }
      }
      this.geschrieben += n;
      return { links: l, rechts: r };
    }

    /** Regelmäßig aufrufen; liefert die jetzt fälligen Frames. */
    takt(pausiert = false) {
      this._uhr(pausiert);
      if (pausiert) {
        for (const fifo of this.quellen.values()) fifo.leeren();
        return { links: new Float32Array(0), rechts: new Float32Array(0) };
      }
      const faellig = abrunden(this.sollFrames - this.latenz * this.sampleRate - this.geschrieben);
      const block = this._mischen(Math.max(0, faellig));
      // Drift: läuft eine Quelle schneller als die Uhr, nicht endlos puffern
      const grenze = this.maxPuffer * this.sampleRate;
      for (const fifo of this.quellen.values()) {
        if (fifo.laenge > grenze) fifo.verwerfen(fifo.laenge - Math.floor(this.latenz * this.sampleRate));
      }
      return block;
    }

    /** Beim Stoppen: alles bis jetzt ausgeben (inkl. Latenzpuffer). */
    abschliessen(pausiert = false) {
      this._uhr(pausiert);
      const faellig = abrunden(this.sollFrames - this.geschrieben);
      return this._mischen(Math.max(0, faellig));
    }

    get sekunden() {
      return this.geschrieben / this.sampleRate;
    }
  }

  wurzel.Mischer = Mischer;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Mischer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
