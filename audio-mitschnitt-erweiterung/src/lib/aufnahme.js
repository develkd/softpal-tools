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

  /**
   * Dateiname aus dem Tabtitel, z. B. "(3) Mein Lied - YouTube" -> "Mein Lied.mp3".
   * Ohne verwertbaren Titel: Datum/Uhrzeit wie dateiname().
   */
  function dateinameAusTitel(titel, datum = new Date()) {
    let t = String(titel || '')
      .replace(/^\(\d+\+?\)\s*/, '') // Benachrichtigungszähler "(3) "
      .replace(/\s+[-–—|]\s+YouTube( Music)?\s*$/i, '')
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '') // Steuer-/Richtungszeichen
      .replace(/[<>:"/\\|?*]+/g, ' ') // in Dateinamen verboten
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.~\s]+|[.\s]+$/g, ''); // nicht mit Punkt/Tilde beginnen, nicht mit Punkt enden
    if ([...t].length > 120) t = [...t].slice(0, 120).join('').trim().replace(/[.\s]+$/, '');
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t)) t = `_${t}`; // reservierte Windows-Namen
    return t ? `${t}.mp3` : dateiname(datum);
  }

  /** Nur ASCII: "Künstler – Titel" -> "Kuenstler - Titel" (falls Umlaute abgelehnt werden). */
  function dateinameAscii(titel, datum = new Date()) {
    const umschrift = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '', '”': '', '„': '' };
    const ascii = String(titel || '')
      .replace(/[äöüÄÖÜß–—’‘“”„]/g, (z) => umschrift[z])
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '') // Akzente (é -> e)
      .replace(/[^\x20-\x7e]/g, ''); // übrige Nicht-ASCII-Zeichen (Emoji usw.)
    return dateinameAusTitel(ascii, datum);
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
    /**
     * @param {object} [o.automatik]  Automatik-Modus: {nachStille: Sekunden,
     *   schwelleDb = -60}. Stille wird zurückgehalten und nur geschrieben, wenn
     *   danach wieder Ton kommt; nach `nachStille` Sekunden ruft die Aufnahme
     *   einmal `beiStille()` auf (dort beenden). Solange noch kein Ton kam,
     *   wird nur ein kurzer Vorlauf behalten und `beiStille` nicht ausgelöst
     *   ("wartet auf Ton"); beim ersten Ton kommt einmal `beiErstemTon()`.
     */
    constructor({ bitrate = 192, sampleRate = 48000, titel = '', jetzt, lame, taktMs = 100, automatik = null } = {}) {
      this.sampleRate = sampleRate;
      this.mischer = new wurzel.Mischer({ sampleRate, jetzt });
      this._resampler = new Map(); // Quelle -> Resampler (falls andere Rate)
      this.kodierer = new Mp3Kodierer({ sampleRate, bitrate, lame });
      this.titel = titel;
      this.bitrate = bitrate;
      this.taktMs = taktMs;
      this.startzeit = new Date();
      this.pausiert = false;
      this.laeuft = false;
      this.pegel = -Infinity;
      this.info = '';
      this._timer = null;
      this.automatik = automatik ? { schwelleDb: -60, ...automatik } : null;
      this.beiStille = null;
      this.beiErstemTon = null;
      this._stille = []; // zurückgehaltene stille Blöcke [links, rechts]
      this._stilleFrames = 0;
      this._tonFrames = 0;
      this._stilleGemeldet = false;
    }

    /** Dateiname aus dem (aktuellen) Tabtitel, sonst Datum/Uhrzeit des Starts. */
    get dateiname() {
      return dateinameAusTitel(this.titel, this.startzeit);
    }

    /** Ausweichname, falls der Browser den Titel-Dateinamen ablehnt. */
    get ersatzname() {
      return dateiname(this.startzeit);
    }

    /** Namen in der Reihenfolge, in der sie beim Speichern probiert werden. */
    get dateinamen() {
      return [...new Set([this.dateiname, dateinameAscii(this.titel, this.startzeit), this.ersatzname])];
    }

    /** Sekunden mit hörbarem Ton (Automatik: entscheidet über Verwerfen). */
    get tonSekunden() {
      return this._tonFrames / this.sampleRate;
    }

    _kodieren(links, rechts) {
      if (!this.automatik) {
        this.kodierer.kodieren(links, rechts);
        return;
      }
      if (pegelDb(links, rechts) < this.automatik.schwelleDb) {
        this._stille.push([links, rechts]);
        this._stilleFrames += links.length;
        if (this._tonFrames === 0) {
          // wartet auf Ton: nur kurzen Vorlauf (0,2 s) behalten
          const vorlauf = 0.2 * this.sampleRate;
          while (this._stille.length > 1 && this._stilleFrames - this._stille[0][0].length >= vorlauf) {
            this._stilleFrames -= this._stille.shift()[0].length;
          }
          return;
        }
        if (!this._stilleGemeldet && this._stilleFrames >= this.automatik.nachStille * this.sampleRate) {
          this._stilleGemeldet = true;
          if (this.beiStille) setTimeout(() => this.beiStille(), 0);
        }
        // nicht unbegrenzt zurückhalten (z. B. wenn niemand beendet)
        if (this._stilleFrames > 120 * this.sampleRate) this._stilleSchreiben();
      } else {
        const erster = this._tonFrames === 0;
        this._stilleSchreiben();
        this._stilleGemeldet = false;
        this.kodierer.kodieren(links, rechts);
        this._tonFrames += links.length;
        if (erster && this.beiErstemTon) setTimeout(() => this.beiErstemTon(), 0);
      }
    }

    _stilleSchreiben() {
      for (const [l, r] of this._stille) this.kodierer.kodieren(l, r);
      this._stille = [];
      this._stilleFrames = 0;
    }

    starten() {
      this.mischer.starten();
      this.laeuft = true;
      if (this.taktMs) this._timer = setInterval(() => this.takt(), this.taktMs);
    }

    /**
     * PCM-Block einer Quelle annehmen; liefert die Quelle mit anderer
     * Abtastrate (rate), wird umgerechnet.
     */
    hinzufuegen(id, links, rechts, rate = this.sampleRate) {
      if (rate !== this.sampleRate) {
        let rs = this._resampler.get(id);
        if (!rs || rs.von !== rate) {
          rs = new wurzel.Resampler(rate, this.sampleRate);
          this._resampler.set(id, rs);
        }
        ({ links, rechts } = rs.verarbeiten(links, rechts));
      }
      this.mischer.hinzufuegen(id, links, rechts);
    }

    entfernen(id) {
      this.mischer.entfernen(id);
      this._resampler.delete(id);
    }

    takt() {
      if (!this.laeuft) return;
      const { links, rechts } = this.mischer.takt(this.pausiert);
      if (links.length) {
        this._kodieren(links, rechts);
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

    /**
     * Beendet die Aufnahme und liefert die MP3-Datei als Blob.
     * @param {object} [o]
     * @param {boolean} [o.stilleVerwerfen] zurückgehaltene Stille am Ende weglassen
     */
    stoppen({ stilleVerwerfen = false } = {}) {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      if (this.laeuft) {
        const { links, rechts } = this.mischer.abschliessen(this.pausiert);
        if (links.length) this._kodieren(links, rechts);
        if (stilleVerwerfen) {
          this._stille = [];
          this._stilleFrames = 0;
        } else {
          this._stilleSchreiben();
        }
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
        automatisch: Boolean(this.automatik),
        wartetAufTon: Boolean(this.automatik) && this._tonFrames === 0,
        tonSekunden: this.tonSekunden,
      };
    }
  }

  const api = { Aufnahme, Mp3Kodierer, floatZuInt16, dateiname, dateinameAusTitel, dateinameAscii, pegelDb, ERLAUBTE_BITRATEN };
  Object.assign(wurzel, { Aufnahme, Mp3Kodierer, ERLAUBTE_BITRATEN });
  wurzel.audioMitschnitt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
