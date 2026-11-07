import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mischer, testUhr } from './hilfen.mjs';

const SR = 48000;

test('ohne Quellen: Stille nach der Uhr, abzüglich Latenzpuffer', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr, latenz: 0.3 });
  m.starten();
  uhr.vor(0.2);
  assert.equal(m.takt().links.length, 0); // noch innerhalb der Latenz
  uhr.vor(0.8);
  assert.equal(m.takt().links.length, Math.floor(0.7 * SR));
  uhr.vor(0.1);
  assert.equal(m.takt().links.length, Math.round(0.1 * SR));
  assert.equal(m.abschliessen().links.length, Math.round(0.3 * SR));
  assert.equal(m.sekunden, 1.1);
});

test('Regression Knistern: verspätete, unregelmäßige Blöcke ergeben exakt die Eingangsdaten', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr });
  m.starten();
  const eingang = [];
  const ausgang = [];
  let wert = 0;
  // Blöcke à 2048 Frames; Uhr läuft unregelmäßig, mit Hängern bis 0,45 s
  const schritte = [0.04, 0.05, 0.45, 0.01, 0.01, 0.3, 0.02, 0.4, 0.04, 0.04, 0.2, 0.06];
  for (let runde = 0; runde < 20; runde++) {
    for (const dt of schritte) {
      uhr.vor(dt);
      const block = Float32Array.from({ length: 2048 }, () => (wert = (wert + 0.001) % 1));
      eingang.push(...block);
      m.hinzufuegen('tab', block, block);
      if (runde % 3 === 0) uhr.vor(0.1); // Takt kommt mal später
      ausgang.push(...m.takt().links);
    }
  }
  ausgang.push(...m.abschliessen().links);
  assert.equal(ausgang.length, eingang.length, 'Länge weicht ab (Stille eingefügt oder Daten verworfen)');
  for (let i = 0; i < eingang.length; i++) {
    if (Math.abs(ausgang[i] - eingang[i]) > 1e-6) assert.fail(`Abweichung bei Sample ${i}`);
  }
});

test('Quelle verstummt: Lücke wird mit Stille passender Länge gefüllt, danach geht es weiter', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr, latenz: 0.3, luecke: 0.5 });
  m.starten();
  const aus = [];
  for (let i = 0; i < 10; i++) { // 1 s Daten in Echtzeit
    m.hinzufuegen('a', new Float32Array(4800).fill(0.5), null);
    uhr.vor(0.1);
    aus.push(...m.takt().links);
  }
  for (let i = 0; i < 20; i++) { // 2 s keine Daten (Video pausiert)
    uhr.vor(0.1);
    aus.push(...m.takt().links);
  }
  for (let i = 0; i < 10; i++) { // 1 s Daten
    m.hinzufuegen('a', new Float32Array(4800).fill(0.25), null);
    uhr.vor(0.1);
    aus.push(...m.takt().links);
  }
  aus.push(...m.abschliessen().links);
  const sek = aus.length / SR;
  assert.ok(Math.abs(sek - 4) < 0.35, `Gesamtdauer ${sek}`);
  const stille = aus.filter((v) => v === 0).length / SR;
  assert.ok(Math.abs(stille - 2) < 0.35, `Stille ${stille}`);
  assert.equal(aus[0], 0.5);
  assert.equal(aus.at(-1), 0.25);
});

test('Blöcke werden über Taktgrenzen hinweg lückenlos zerteilt', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr, latenz: 0 });
  m.starten();
  const daten = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
  m.hinzufuegen('a', daten.slice(0, 400), daten.slice(0, 400));
  m.hinzufuegen('a', daten.slice(400), daten.slice(400));
  const aus = [];
  for (const schritt of [123, 456, 421]) {
    uhr.vor(schritt / SR);
    aus.push(...m.takt().links);
  }
  assert.equal(aus.length, 1000);
  assert.deepEqual(aus, Array.from(daten));
});

test('mehrere Quellen werden addiert und begrenzt; es wird auf die langsamere gewartet', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr, latenz: 0 });
  m.starten();
  m.hinzufuegen('a', new Float32Array([0.2, 0.7, 0.1]), new Float32Array([0.1, -0.7, 0]));
  m.hinzufuegen('b', new Float32Array([0.3, 0.7]), new Float32Array([0.1, -0.7]));
  uhr.vor(0.01);
  const { links, rechts } = m.takt();
  assert.equal(links.length, 2); // b hat erst 2 Frames geliefert
  assert.ok(Math.abs(links[0] - 0.5) < 1e-6);
  assert.equal(links[1], 1);
  assert.equal(rechts[1], -1);
});

test('Pause: Zeit zählt nicht, Daten werden verworfen', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr, latenz: 0 });
  m.starten();
  uhr.vor(1);
  assert.equal(m.takt().links.length, SR);
  m.hinzufuegen('a', new Float32Array(SR).fill(0.5), null);
  uhr.vor(5);
  assert.equal(m.takt(true).links.length, 0);
  uhr.vor(0.5);
  const nach = m.takt();
  assert.equal(nach.links.length, SR / 2);
  assert.equal(nach.links[0], 0); // Daten aus der Pause wurden verworfen
  assert.equal(m.sekunden, 1.5);
});
