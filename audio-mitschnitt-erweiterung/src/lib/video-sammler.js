/*
 * VideoSammler: Gegenstück zu lib/video.js auf Seiten der Erweiterung
 * (Firefox-Hintergrundseite, Chrome-Offscreen-Dokument).
 *
 * - nimmt die Ports der eingefügten Video-Skripte an (einer je Frame),
 *   wählt das beste Video (spielt, größte sichtbare Fläche) und startet es
 * - sammelt die MP4-Daten als Blob-Teile und liefert am Ende die Datei
 * - bricht die Seite ab (Tab zu, Seite neu geladen), wird das bis dahin
 *   Aufgenommene trotzdem gespeichert (fragmentiertes MP4 bleibt abspielbar)
 */
(function (wurzel) {
  'use strict';

  const PORT_NAME = 'audio-mitschnitt-video';

  function ausBase64(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  class VideoSammler {
    /**
     * @param {object} o
     * @param {(blob: Blob, info: object) => Promise<any>|any} o.beiFertig Datei speichern
     * @param {number} [o.wartezeit=400] ms, so lange werden Kandidaten gesammelt
     * @param {number} [o.startTimeout=10000]
     */
    constructor({ beiFertig, wartezeit = 400, startTimeout = 10000, endeTimeout = 20000 } = {}) {
      this.beiFertig = beiFertig;
      this.wartezeit = wartezeit;
      this.startTimeout = startTimeout;
      this.endeTimeout = endeTimeout;
      this._leeren();
    }

    _leeren() {
      if (this._auswahlTimer) clearTimeout(this._auswahlTimer);
      this._auswahlTimer = null;
      this.aktiv = null;
      this.zustand = 'aus'; // aus | suche | startet | laeuft | endet
      this.kandidaten = [];
      this.port = null;
      this.teile = [];
      this.bytes = 0;
      this.info = {};
      this.sekunden = 0;
      this.fehler = null;
      this._start = null;
      this._ende = null;
    }

    get laeuft() {
      return this.zustand !== 'aus';
    }

    status() {
      return {
        laeuft: this.laeuft,
        zustand: this.zustand,
        sekunden: this.sekunden,
        bytes: this.bytes,
        fehler: this.fehler,
        ...this.info,
      };
    }

    /** Vor dem Einfügen der Skripte aufrufen: wartet auf deren Ports. */
    vorbereiten({ titel = '', tabId = null } = {}) {
      if (this.laeuft) throw new Error('Es läuft bereits eine Video-Aufnahme.');
      this._leeren();
      this.zustand = 'suche';
      this.info = { titel, tabId, startzeit: Date.now() };
      this._start = {};
      this._start.versprechen = new Promise((ja, nein) => { this._start.ja = ja; this._start.nein = nein; });
      this._start.versprechen.catch(() => {});
      this._start.timer = setTimeout(() => this._startFehler('Kein Video gefunden (die Seite hat nicht geantwortet).'),
        this.startTimeout);
      return this._start.versprechen;
    }

    /** Wartet, bis die Aufnahme läuft (oder wirft mit verständlicher Meldung). */
    warteAufStart() {
      if (!this._start) return Promise.reject(new Error('Keine Video-Aufnahme vorbereitet.'));
      return this._start.versprechen;
    }

    _startFehler(text) {
      if (!this._start) return;
      clearTimeout(this._start.timer);
      const nein = this._start.nein;
      this._start = null;
      for (const k of this.kandidaten) { try { k.port.postMessage({ typ: 'abbruch' }); k.port.disconnect(); } catch (_) { /* weg */ } }
      this._leeren();
      this.letzterFehler = text;
      nein(new Error(text));
    }

    /** runtime.onConnect weiterreichen; gibt true zurück, wenn der Port hierher gehört. */
    portAnnehmen(port) {
      if (port.name !== PORT_NAME) return false;
      if (this.zustand !== 'suche') {
        try { port.postMessage({ typ: 'abbruch' }); port.disconnect(); } catch (_) { /* weg */ }
        return true;
      }
      const eintrag = { port, kandidat: null };
      this.kandidaten.push(eintrag);
      port.onMessage.addListener((m) => this._nachricht(eintrag, m));
      port.onDisconnect.addListener(() => this._getrennt(eintrag));
      return true;
    }

    _nachricht(eintrag, m) {
      if (m.typ === 'kandidat') {
        eintrag.kandidat = m;
        if (!this._auswahlTimer) this._auswahlTimer = setTimeout(() => this._auswaehlen(), this.wartezeit);
      } else if (eintrag !== this.aktiv) {
        // nur das ausgewählte Video darf Daten schicken
      } else if (m.typ === 'gestartet') {
        this.zustand = 'laeuft';
        Object.assign(this.info, { breite: m.breite, hoehe: m.hoehe, video: m.video, audio: m.audio });
        if (this._start) { clearTimeout(this._start.timer); this._start.ja(this.status()); this._start = null; }
      } else if (m.typ === 'daten') {
        const bytes = ausBase64(m.b64);
        this.teile.push(bytes);
        this.bytes += bytes.length;
      } else if (m.typ === 'status') {
        this.sekunden = m.sekunden;
        this.info.bilder = m.bilder;
        this.info.verworfen = m.verworfen;
        this.info.tonSekunden = m.tonSekunden;
        this.info.letztesBildSek = m.letztesBildSek;
      } else if (m.typ === 'fehler') {
        this.letzterFehler = m.text;
        if (this.zustand === 'startet') this._startFehler(m.text);
        else this.fehler = m.text;
      } else if (m.typ === 'ende') {
        if (m.sekunden) this.sekunden = m.sekunden;
        this._abschliessen(false);
      }
    }

    _auswaehlen() {
      this._auswahlTimer = null;
      this.auswahlInfo = this.kandidaten.map((k) => (k.kandidat
        ? `${k.kandidat.seite || '?'}: ${k.kandidat.flaeche > 0 ? `${k.kandidat.breite}×${k.kandidat.hoehe}${k.kandidat.spielt ? ' spielt' : ' pausiert'}` : 'kein Video'}` +
          (k.kandidat.faehig ? ` [WebCodecs ${k.kandidat.faehig.webcodecs ? 'ja' : 'NEIN'}, MP4 ${k.kandidat.faehig.muxer ? 'ja' : 'NEIN'}, ` +
            `<video> ${k.kandidat.faehig.videos}]` : '')
        : '(keine Antwort)'));
      const mitVideo = this.kandidaten.filter((k) => k.kandidat && k.kandidat.flaeche > 0);
      mitVideo.sort((a, b) => (Number(b.kandidat.spielt) - Number(a.kandidat.spielt)) || (b.kandidat.flaeche - a.kandidat.flaeche));
      const bester = mitVideo[0];
      for (const k of this.kandidaten) {
        if (k !== bester) { try { k.port.postMessage({ typ: 'abbruch' }); k.port.disconnect(); } catch (_) { /* weg */ } }
      }
      if (!bester) {
        this._startFehler('Kein Video auf der Seite gefunden.');
        return;
      }
      this.aktiv = bester;
      this.kandidaten = [bester];
      this.zustand = 'startet';
      bester.port.postMessage({ typ: 'start' });
    }

    _getrennt(eintrag) {
      if (eintrag !== this.aktiv) return;
      if (this.zustand === 'startet') { this._startFehler('Die Seite hat die Video-Aufnahme abgebrochen.'); return; }
      if (this.zustand === 'laeuft' || this.zustand === 'endet') this._abschliessen(this.zustand === 'laeuft');
    }

    /** Aufnahme beenden und speichern lassen. */
    stoppen() {
      if (this.zustand === 'suche' || this.zustand === 'startet') {
        this._startFehler('Video-Aufnahme abgebrochen.');
        return Promise.resolve({ laeuft: false });
      }
      if (this.zustand !== 'laeuft') return Promise.resolve({ laeuft: false });
      this.zustand = 'endet';
      this._ende = {};
      const versprechen = new Promise((ja) => { this._ende.ja = ja; });
      this._ende.timer = setTimeout(() => this._abschliessen(true), this.endeTimeout);
      try { this.aktiv.port.postMessage({ typ: 'stopp' }); } catch (_) { this._abschliessen(true); }
      return versprechen;
    }

    async _abschliessen(abgebrochen) {
      if (this.zustand === 'aus' || this._fertig) return;
      this._fertig = true;
      const ende = this._ende;
      if (ende) clearTimeout(ende.timer);
      const info = { ...this.status(), abgebrochen, laeuft: false };
      const blob = new Blob(this.teile, { type: 'video/mp4' });
      const port = this.aktiv && this.aktiv.port;
      this.aktiv = null;
      this._leeren();
      this._fertig = false;
      if (port) { try { port.disconnect(); } catch (_) { /* weg */ } }
      let ergebnis = { ...info, gespeichert: null };
      if (blob.size > 0) {
        try {
          const name = await this.beiFertig(blob, info);
          ergebnis = { ...info, gespeichert: name };
        } catch (fehler) {
          ergebnis = { ...info, fehler: String(fehler.message || fehler) };
        }
      }
      this.letztes = ergebnis;
      if (ende) ende.ja(ergebnis);
    }
  }

  VideoSammler.PORT_NAME = PORT_NAME;
  wurzel.VideoSammler = VideoSammler;
  if (typeof module !== 'undefined' && module.exports) module.exports = { VideoSammler };
})(typeof globalThis !== 'undefined' ? globalThis : this);
