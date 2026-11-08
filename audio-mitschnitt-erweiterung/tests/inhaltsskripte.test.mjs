// Firefox gibt den Wert der letzten Anweisung eines per tabs.executeScript
// eingefügten Skripts an die Erweiterung zurück und bricht ab, wenn er sich
// nicht kopieren lässt (z. B. ein Objekt mit Funktionen). Alle eingefügten
// Skripte müssen daher mit "undefined" enden.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const DATEIEN = ['lib/mp4-muxer.js', 'lib/abgriff.js', 'lib/resampler.js', 'lib/medienquelle.js', 'lib/video.js', 'firefox/tap.js'];

test('eingefügte Inhaltsskripte liefern undefined und teilen ihre Namen über globalThis', () => {
  const port = { postMessage() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} };
  const kontext = createContext({
    browser: { runtime: { connect: () => port, getURL: (p) => p } },
    document: { querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, documentElement: {} },
    location: { host: 'test', pathname: '/' },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
    innerWidth: 1000, innerHeight: 800,
  });
  runInContext('globalThis.window = globalThis;', kontext);
  for (const datei of DATEIEN) {
    const code = readFileSync(new URL(`../src/${datei}`, import.meta.url), 'utf8');
    const ergebnis = runInContext(code, kontext, { filename: datei });
    assert.equal(ergebnis, undefined, `${datei} liefert ${typeof ergebnis} statt undefined`);
  }
  const globalNamen = JSON.parse(runInContext('[typeof globalThis.Mp4Muxer, typeof globalThis.erstelleAbgriff, typeof globalThis.Resampler, typeof globalThis.__audioMitschnittMedien].join()', kontext).replace(/^/, '["').replace(/$/, '"]').replace(/,/g, '","'));
  assert.deepEqual(globalNamen, ['object', 'function', 'function', 'object']);
});
