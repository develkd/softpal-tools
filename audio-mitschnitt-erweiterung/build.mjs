#!/usr/bin/env node
// Baut dist/chrome und dist/firefox (entpackt) sowie je eine .zip zum Hochladen.
// Ohne Abhängigkeiten: node build.mjs
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const wurzel = dirname(fileURLToPath(import.meta.url));
const src = join(wurzel, 'src');
const dist = join(wurzel, 'dist');
const version = JSON.parse(readFileSync(join(wurzel, 'package.json'), 'utf8')).version;

const ZIELE = {
  chrome: { manifest: 'manifest.chrome.json', ohne: ['firefox'] },
  firefox: { manifest: 'manifest.firefox.json', ohne: ['chrome'] },
};

function dateien(ordner) {
  return readdirSync(ordner).flatMap((name) => {
    const pfad = join(ordner, name);
    return statSync(pfad).isDirectory() ? dateien(pfad) : [pfad];
  }).sort();
}

// --- minimaler ZIP-Schreiber (Deflate) ------------------------------------
const CRC_TABELLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(eintraege) {
  const teile = [];
  const verzeichnis = [];
  let versatz = 0;
  // feste Zeit -> reproduzierbare Archive (1.1.2026 00:00)
  const dosZeit = 0;
  const dosDatum = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const { name, daten } of eintraege) {
    const nameBuf = Buffer.from(name, 'utf8');
    const komprimiert = deflateRawSync(daten, { level: 9 });
    const crc = crc32(daten);
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0);
    lokal.writeUInt16LE(20, 4);
    lokal.writeUInt16LE(0x0800, 6); // UTF-8-Namen
    lokal.writeUInt16LE(8, 8);
    lokal.writeUInt16LE(dosZeit, 10);
    lokal.writeUInt16LE(dosDatum, 12);
    lokal.writeUInt32LE(crc, 14);
    lokal.writeUInt32LE(komprimiert.length, 18);
    lokal.writeUInt32LE(daten.length, 22);
    lokal.writeUInt16LE(nameBuf.length, 26);
    teile.push(lokal, nameBuf, komprimiert);

    const zentral = Buffer.alloc(46);
    zentral.writeUInt32LE(0x02014b50, 0);
    zentral.writeUInt16LE(20, 4);
    zentral.writeUInt16LE(20, 6);
    zentral.writeUInt16LE(0x0800, 8);
    zentral.writeUInt16LE(8, 10);
    zentral.writeUInt16LE(dosZeit, 12);
    zentral.writeUInt16LE(dosDatum, 14);
    zentral.writeUInt32LE(crc, 16);
    zentral.writeUInt32LE(komprimiert.length, 20);
    zentral.writeUInt32LE(daten.length, 24);
    zentral.writeUInt16LE(nameBuf.length, 28);
    zentral.writeUInt32LE(versatz, 42);
    verzeichnis.push(zentral, nameBuf);
    versatz += lokal.length + nameBuf.length + komprimiert.length;
  }
  const verzeichnisBuf = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(eintraege.length, 8);
  ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(verzeichnisBuf.length, 12);
  ende.writeUInt32LE(versatz, 16);
  return Buffer.concat([...teile, verzeichnisBuf, ende]);
}

// --- Bauen -----------------------------------------------------------------
rmSync(dist, { recursive: true, force: true });
for (const [ziel, { manifest, ohne }] of Object.entries(ZIELE)) {
  const aus = join(dist, ziel);
  mkdirSync(aus, { recursive: true });
  cpSync(src, aus, {
    recursive: true,
    filter: (pfad) => !ohne.some((o) => relative(src, pfad).split(sep)[0] === o),
  });
  const m = JSON.parse(readFileSync(join(wurzel, manifest), 'utf8'));
  m.version = version;
  writeFileSync(join(aus, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);

  const eintraege = dateien(aus).map((pfad) => ({
    name: relative(aus, pfad).split(sep).join('/'),
    daten: readFileSync(pfad),
  }));
  const archiv = zip(eintraege);
  const zipName = `audio-mitschnitt-${ziel}-${version}.zip`;
  writeFileSync(join(dist, zipName), archiv);
  const sha = createHash('sha256').update(archiv).digest('hex').slice(0, 12);
  console.log(`${ziel.padEnd(8)} dist/${ziel}/  dist/${zipName}  (${eintraege.length} Dateien, ${(archiv.length / 1024).toFixed(0)} KB, ${sha})`);
}
