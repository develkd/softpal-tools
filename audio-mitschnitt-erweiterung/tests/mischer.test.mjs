import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mischer, testUhr } from './hilfen.mjs';

const SR = 48000;

test('liefert nach Ablauf der Latenz genau die verstrichene Zeit', () => {
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

test('ohne Daten entsteht Stille, vorhandene Daten kommen unverändert durch', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr, latenz: 0 });
  m.starten();
  m.hinzufuegen('a', new Float32Array(100).fill(0.25), new Float32Array(100).fill(-0.25));
  uhr.vor(300 / SR);
  const { links, rechts } = m.takt();
  assert.equal(links.length, 300);
  assert.equal(links[0], 0.25);
  assert.equal(rechts[99], -0.25);
  assert.equal(links[100], 0);
  assert.equal(links[299], 0);
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

test('mehrere Quellen werden addiert und begrenzt', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr, latenz: 0 });
  m.starten();
  m.hinzufuegen('a', new Float32Array([0.2, 0.7]), new Float32Array([0.1, -0.7]));
  m.hinzufuegen('b', new Float32Array([0.3, 0.7]), new Float32Array([0.1, -0.7]));
  uhr.vor(2 / SR);
  const { links, rechts } = m.takt();
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

test('Quelle schneller als die Uhr: Puffer wird gekürzt statt endlos zu wachsen', () => {
  const uhr = testUhr();
  const m = new Mischer({ jetzt: uhr, latenz: 0.3, maxPuffer: 1 });
  m.starten();
  m.hinzufuegen('a', new Float32Array(3 * SR), null);
  uhr.vor(0.5);
  m.takt();
  assert.ok(m.quellen.get('a').laenge <= 0.3 * SR + 1);
});
