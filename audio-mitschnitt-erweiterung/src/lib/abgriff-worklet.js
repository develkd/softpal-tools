/*
 * AudioWorklet-Prozessor für den Abgriff: läuft im Audio-Thread und schickt
 * Stereo-Blöcke über den MessagePort. Anders als ScriptProcessorNode gehen
 * so keine Blöcke verloren, wenn der Hauptthread kurz beschäftigt ist
 * (MP3-Kodierung, Speicherbereinigung, langsamer Rechner) – das war die
 * Ursache von Knistern in der Chrome-Aufnahme.
 */
const BLOCK = 2048; // ca. 43 ms bei 48 kHz

class AbgriffProzessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.neu();
    this.port.onmessage = (e) => { if (e.data === 'stopp') this.aktiv = false; };
    this.aktiv = true;
  }

  neu() {
    this.l = new Float32Array(BLOCK);
    this.r = new Float32Array(BLOCK);
    this.pos = 0;
  }

  process(inputs) {
    if (!this.aktiv) return false;
    const ein = inputs[0];
    const anzahl = ein && ein.length ? ein[0].length : 128;
    const l = ein && ein.length ? ein[0] : null;
    const r = ein && ein.length > 1 ? ein[1] : l;
    for (let i = 0; i < anzahl; i++) {
      // ohne Eingang (kein Signal angeschlossen): Stille, damit die Zeit stimmt
      this.l[this.pos] = l ? l[i] : 0;
      this.r[this.pos] = r ? r[i] : 0;
      this.pos++;
      if (this.pos === BLOCK) {
        this.port.postMessage({ l: this.l, r: this.r }, [this.l.buffer, this.r.buffer]);
        this.neu();
      }
    }
    return true;
  }
}

registerProcessor('audio-mitschnitt-abgriff', AbgriffProzessor);
