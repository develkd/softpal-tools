import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aufnahmeModul, mp3Frames, sinus, testUhr } from './hilfen.mjs';

const { Aufnahme } = aufnahmeModul;
const SR = 48000;
const warten = (ms) => new Promise((r) => setTimeout(r, ms));

/** Liefert `sek` Sekunden Ton (oder Stille) in 100-ms-Schritten. */
function liefern(a, uhr, sek, ton = true) {
  for (let n = 0; n < Math.round(sek * 10); n++) {
    const block = ton ? sinus(SR / 10) : new Float32Array(SR / 10);
    a.mischer.hinzufuegen('q', block, block);
    uhr.vor(0.1);
    a.takt();
  }
}

async function dauer(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  return buf.length ? (mp3Frames(buf).length * 1152) / SR : 0;
}

test('Stille am Ende wird verworfen, Pausen dazwischen bleiben', async () => {
  const uhr = testUhr();
  const a = new Aufnahme({ jetzt: uhr, taktMs: 0, automatik: { nachStille: 3 } });
  let gemeldet = 0;
  a.beiStille = () => { gemeldet++; };
  a.starten();
  liefern(a, uhr, 2); // Ton
  liefern(a, uhr, 1, false); // kurze Pause (bleibt)
  liefern(a, uhr, 2); // Ton
  liefern(a, uhr, 2, false); // Stille, noch unter 3 s
  await warten(5);
  assert.equal(gemeldet, 0);
  liefern(a, uhr, 1.5, false); // jetzt > 3 s Stille
  await warten(5);
  assert.equal(gemeldet, 1, 'beiStille genau einmal');
  liefern(a, uhr, 1, false);
  await warten(5);
  assert.equal(gemeldet, 1);
  assert.ok(Math.abs(a.tonSekunden - 4) < 0.35, `Ton ${a.tonSekunden}`);
  const d = await dauer(a.stoppen({ stilleVerwerfen: true }));
  // 2 s Ton + 1 s Pause + 2 s Ton (+ Latenzpuffer des Mischers am Anfang)
  assert.ok(d > 4.6 && d < 5.6, `Dauer ${d}`);
});

test('ohne stilleVerwerfen bleibt die Stille in der Datei', async () => {
  const uhr = testUhr();
  const a = new Aufnahme({ jetzt: uhr, taktMs: 0, automatik: { nachStille: 30 } });
  a.starten();
  liefern(a, uhr, 1);
  liefern(a, uhr, 2, false);
  const d = await dauer(a.stoppen());
  assert.ok(d > 2.8 && d < 3.5, `Dauer ${d}`);
});

test('nach erneutem Ton kann beiStille wieder ausgelöst werden', async () => {
  const uhr = testUhr();
  const a = new Aufnahme({ jetzt: uhr, taktMs: 0, automatik: { nachStille: 1 } });
  let gemeldet = 0;
  a.beiStille = () => { gemeldet++; };
  a.starten();
  liefern(a, uhr, 1);
  liefern(a, uhr, 1.5, false);
  liefern(a, uhr, 1);
  liefern(a, uhr, 1.5, false);
  await warten(5);
  assert.equal(gemeldet, 2);
  a.stoppen({ stilleVerwerfen: true });
});

test('nur Stille: leere Datei, kein Absturz', async () => {
  const uhr = testUhr();
  const a = new Aufnahme({ jetzt: uhr, taktMs: 0, automatik: { nachStille: 1 } });
  a.starten();
  liefern(a, uhr, 2, false);
  const blob = a.stoppen({ stilleVerwerfen: true });
  assert.equal(a.tonSekunden, 0);
  assert.ok((await dauer(blob)) < 0.1);
});

test('wartet auf Ton: Stille davor fällt weg (bis auf kurzen Vorlauf), kein beiStille ohne Ton', async () => {
  const uhr = testUhr();
  const a = new Aufnahme({ jetzt: uhr, taktMs: 0, automatik: { nachStille: 0.5 } });
  let stille = 0;
  let ersterTon = 0;
  a.beiStille = () => { stille++; };
  a.beiErstemTon = () => { ersterTon++; };
  a.starten();
  liefern(a, uhr, 3, false); // 3 s warten
  await warten(5);
  assert.equal(stille, 0, 'beiStille ohne Ton ausgelöst');
  assert.equal(a.status().wartetAufTon, true);
  liefern(a, uhr, 2); // Ton
  await warten(5);
  assert.equal(ersterTon, 1);
  assert.equal(a.status().wartetAufTon, false);
  liefern(a, uhr, 0.9, false); // 0,5 s + 0,3 s Latenzpuffer des Mischers
  await warten(5);
  assert.equal(stille, 1, 'nach 0,5 s Stille nicht gemeldet');
  const d = await dauer(a.stoppen({ stilleVerwerfen: true }));
  assert.ok(d > 1.9 && d < 2.6, `Dauer ${d} (Stille vor dem Ton nicht entfernt?)`);
});
