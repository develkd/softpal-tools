/*
 * Aufnahme = Mischer + MP3-Kodierung (lamejs) + Takt.
 * Benötigt globalThis.lamejs (lib/lame.min.js) und globalThis.Mischer.
 */
(function (wurzel) {
  'use strict';

  const ERLAUBTE_BITRATEN = [96, 128, 160, 192, 256, 320];

  function floatZuInt16(f32) {
    const aus = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = f32[i] > 1 ? 1 : f32[i] < -1 ? -1 : f32[i];
      aus[i] = Math.round(s * 32767);
    }
    return aus;
  }

  function zweistellig(n) {
    return String(n).padStart(2, '0');
  }

  function dateiname(datum = new Date(), praefix = 'Mitschnitt') {
    const d = datum;
    return `${praefix}_${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}` +
      `_${zweistellig(d.getHours())}-${zweistellig(d.getMinutes())}-${zweistellig(d.getSeconds())}.mp3`;
  }

  function pegelDb(l, r) {
    let spitze = 0;
    for (let i = 0; i < l.length; i++) {
      const a = Math.abs(l[i]);
      const b = Math.abs(r[i]);
      if (a > spitze) spitze = a;
      if (b > spitze) spitze = b;
    }
    return spitze > 0 ? 20 * Math.log10(Math.min(spitze, 1)) : -Infinity;
  }

  class Mp3Kodierer {
    constructor({ sampleRate = 48000, bitrate = 192, lame = wurzel.lamejs } = {}) {
      if (!ERLAUBTE_BITRATEN.includes(bitrate)) throw new Error(`Bitrate ${bitrate} nicht unterstützt`);
      if (!lame) throw new Error('lamejs nicht geladen');
      this._enc = new lame.Mp3Encoder(2, sampleRate, bitrate);
      this.teile = [];
      this.bytes = 0;
    }

    kodieren(links, rechts) {
      if (!links.length) return;
      // lamejs verarbeitet große Blöcke am zuverlässigsten in Stücken
      const STUECK = 1152 * 20;
      for (let i = 0; i < links.length; i += STUECK) {
        const l = floatZuInt16(links.subarray(i, i + STUECK));
        const r = floatZuInt16(rechts.subarray(i, i + STUECK));
        this._ablegen(this._enc.encodeBuffer(l, r));
      }
    }

    abschliessen() {
      this._ablegen(this._enc.flush());
    }

    _ablegen(daten) {
      if (daten && daten.length) {
        const kopie = new Uint8Array(daten.buffer, daten.byteOffset, daten.length).slice();
        this.teile.push(kopie);
        this.bytes += kopie.length;
      }
    }

    blob() {
      return new Blob(this.teile, { type: 'audio/mpeg' });
    }
  }

  class Aufnahme {
    constructor({ bitrate = 192, sampleRate = 48000, titel = '', jetzt, lame, taktMs = 100 } = {}) {
      this.mischer = new wurzel.Mischer({ sampleRate, jetzt });
      this.kodierer = new Mp3Kodierer({ sampleRate, bitrate, lame });
      this.titel = titel;
      this.bitrate = bitrate;
      this.taktMs = taktMs;
      this.dateiname = dateiname();
      this.pausiert = false;
      this.laeuft = false;
      this.pegel = -Infinity;
      this.info = '';
      this._timer = null;
    }

    starten() {
      this.mischer.starten();
      this.laeuft = true;
      if (this.taktMs) this._timer = setInterval(() => this.takt(), this.taktMs);
    }

    takt() {
      if (!this.laeuft) return;
      const { links, rechts } = this.mischer.takt(this.pausiert);
      if (links.length) {
        this.kodierer.kodieren(links, rechts);
        this.pegel = pegelDb(links, rechts);
      } else if (this.pausiert) {
        this.pegel = -Infinity;
      }
    }

    pausieren() {
      this.takt();
      this.pausiert = true;
    }

    fortsetzen() {
      this.mischer.takt(true); // Uhr nachziehen, Pausenzeit nicht zählen
      this.pausiert = false;
    }

    /** Beendet die Aufnahme und liefert die MP3-Datei als Blob. */
    stoppen() {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      if (this.laeuft) {
        const { links, rechts } = this.mischer.abschliessen(this.pausiert);
        this.kodierer.kodieren(links, rechts);
        this.kodierer.abschliessen();
      }
      this.laeuft = false;
      return this.kodierer.blob();
    }

    status() {
      return {
        laeuft: this.laeuft,
        pausiert: this.pausiert,
        sekunden: this.mischer.sekunden,
        bytes: this.kodierer.bytes,
        pegelDb: Number.isFinite(this.pegel) ? this.pegel : null,
        titel: this.titel,
        dateiname: this.dateiname,
        info: this.info,
      };
    }
  }

  const api = { Aufnahme, Mp3Kodierer, floatZuInt16, dateiname, pegelDb, ERLAUBTE_BITRATEN };
  Object.assign(wurzel, { Aufnahme, Mp3Kodierer, ERLAUBTE_BITRATEN });
  wurzel.audioMitschnitt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
