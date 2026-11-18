// End-to-End-Test im echten Browser (Chromium über Playwright).
// Startet den Server auf einer Kopie von beispiel/ und klickt die wichtigsten Abläufe durch.
//   npm install --no-save playwright && npx playwright install chromium
//   node tests/e2e_browser.mjs
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "ticket-board-e2e-"));
cpSync(join(wurzel, "beispiel"), tmp, { recursive: true });
const projekt = join(tmp, "Webshop");
const eintraege = join(projekt, "eintraege");
const datei = (id) => join(eintraege, readdirSync(eintraege).find((n) => n.startsWith(id + "-")));
const lesen = (id) => readFileSync(datei(id), "utf8");

const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const server = spawn(python, ["-u", "-m", "ticket_board", tmp, "--port", "0", "--kein-browser"], { cwd: wurzel });
const url = await new Promise((ok, fehler) => {
  let puffer = "";
  server.stdout.on("data", (d) => {
    puffer += d;
    const m = /Adresse: (http\S+)/.exec(puffer);
    if (m) ok(m[1]);
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
  server.on("exit", (c) => fehler(new Error("Server beendet: " + c)));
  setTimeout(() => fehler(new Error("Server startet nicht")), 10000);
});

const browser = await chromium.launch();
const seite = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const fehler = [];
seite.on("pageerror", (e) => fehler.push(e.message));
// Der 409 aus dem Konflikt-Schritt ist gewollt und wird nicht als Fehler gezählt.
seite.on("console", (m) => m.type() === "error" && !/status of 409/.test(m.text()) && fehler.push(m.text()));
seite.on("dialog", (d) => d.accept());

let schritte = 0;
async function schritt(name, fn) {
  await fn();
  schritte++;
  console.log("✔", name);
}

try {
  await seite.goto(url);
  await seite.waitForSelector(".abschnitt");

  await schritt("Backlog zeigt aktiven Sprint, geplanten Sprint und Backlog", async () => {
    assert.equal(await seite.locator(".abschnitt").count(), 3);
    assert.match(await seite.locator(".abschnitt.aktiv h2").innerText(), /Sprint 1/);
  });

  await schritt("Schnell anlegen im Backlog", async () => {
    const form = seite.locator('form.schnell[data-sprint=""]');
    await form.locator("select").selectOption("bug");
    await form.locator("input").fill("E2E: Fehler beim Speichern");
    await form.locator("input").press("Enter");
    await seite.waitForSelector('.zeile[data-id="WS-15"]');
    assert.match(lesen("WS-15"), /typ: bug\n/);
  });

  await schritt("Per Drag & Drop in den Sprint ziehen", async () => {
    await seite.locator('.zeile[data-id="WS-15"]').dragTo(seite.locator('.liste[data-abschnitt="sprint-01"] .zeile[data-id="WS-3"]'));
    await seite.waitForFunction(() => document.querySelector('.liste[data-abschnitt="sprint-01"] .zeile[data-id="WS-15"]'));
    assert.match(lesen("WS-15"), /sprint: sprint-01\n/);
    const ids = await seite.locator('.liste[data-abschnitt="sprint-01"] > .zeile').evaluateAll((l) => l.map((x) => x.dataset.id));
    assert.equal(ids[0], "WS-15");
  });

  await schritt("Auf dem Board in eine andere Spalte ziehen", async () => {
    await seite.keyboard.press("s");
    await seite.waitForSelector(".spalten");
    await seite.locator('.karte[data-id="WS-15"]').dragTo(seite.locator('.karten[data-status="review"]'));
    await seite.waitForSelector('.karten[data-status="review"] .karte[data-id="WS-15"]');
    assert.match(lesen("WS-15"), /status: review\n/);
  });

  await schritt("Filter nach Typ", async () => {
    await seite.locator('.chip[data-typ="bug"]').click();
    const ids = await seite.locator(".karte").evaluateAll((l) => l.map((x) => x.dataset.id).sort());
    assert.deepEqual(ids, ["WS-15", "WS-4"]);
    await seite.locator("[data-filter-weg]").click();
  });

  await schritt("Eintrag bearbeiten, Hervorhebung setzen, speichern", async () => {
    await seite.locator('.karte[data-id="WS-15"]').click();
    await seite.waitForSelector("#dialog[open]");
    await seite.fill("#f-titel", "E2E: Fehler beim Speichern behoben");
    await seite.locator('.farbwahl [data-farbe="#ca8a04"]').click();
    await seite.fill('input[name="version"]', "1.0.1");
    await seite.fill('input[name="faellig"]', "2026-12-24");
    await seite.locator("#dialog button[type=submit]").click();
    await seite.waitForSelector("#dialog[open]", { state: "detached" });
    const inhalt = lesen("WS-15");
    assert.match(inhalt, /titel: "E2E: Fehler beim Speichern behoben"\n/);
    assert.match(inhalt, /farbe: "#ca8a04"\n/);
    assert.match(inhalt, /version: "1.0.1"\n/);
    assert.match(inhalt, /faellig: 2026-12-24\n/);
    await seite.waitForSelector('.karte.hervorgehoben[data-id="WS-15"]');
  });

  await schritt("Checkliste in der Vorschau abhaken", async () => {
    await seite.locator('.karte[data-id="WS-3"]').click();
    await seite.locator('#d-vorschau input[data-aufgabe="2"]').check();
    await seite.locator("#dialog button[type=submit]").click();
    await seite.waitForSelector("#dialog[open]", { state: "detached" });
    assert.match(lesen("WS-3"), /- \[x\] Sperre nach 5 Fehlversuchen/);
  });

  await schritt("Änderung von außen wird live übernommen", async () => {
    const pfad = datei("WS-8");
    writeFileSync(pfad, readFileSync(pfad, "utf8").replace(/titel: .*\n/, "titel: Von außen geändert\n"));
    await seite.waitForSelector('.karte[data-id="WS-8"] >> text=Von außen geändert', { timeout: 6000 });
  });

  await schritt("Konflikt beim Speichern wird erkannt", async () => {
    await seite.locator('.karte[data-id="WS-9"]').click();
    await seite.fill("#f-titel", "Meine Fassung");
    const pfad = datei("WS-9");
    writeFileSync(pfad, readFileSync(pfad, "utf8") + "\nZeile von außen\n");
    await seite.locator("#dialog button[type=submit]").click();
    await seite.waitForSelector("#k-trotzdem");
    await seite.locator("#k-trotzdem").click();
    await seite.waitForSelector("#dialog[open]", { state: "detached" });
    const inhalt = lesen("WS-9");
    assert.match(inhalt, /titel: Meine Fassung\n/);
  });

  await schritt("Unteraufgabe anlegen folgt dem Sprint des Elternteils", async () => {
    await seite.locator('.karte[data-id="WS-15"]').click();
    await seite.locator("[data-neu-unter]").click();
    await seite.fill("#f-titel", "Test schreiben");
    await seite.locator("#dialog button[type=submit]").click();
    await seite.waitForSelector('#dialog[open] .unterliste >> text=Test schreiben');
    await seite.locator("#dialog [data-schliessen]").first().click();
    assert.match(lesen("WS-16"), /sprint: sprint-01\n/);
    assert.match(lesen("WS-16"), /eltern: WS-15\n/);
  });

  await schritt("Sprint abschließen, Offenes wandert in Sprint 2, Sprint 2 starten", async () => {
    await seite.locator('.sprint-kopf [data-sprint-aktion="abschliessen"]').click();
    await seite.locator('#dialog-klein select[name="ziel"]').selectOption("sprint-02");
    await seite.locator("#dialog-klein button[type=submit]").click();
    await seite.waitForSelector('.abschnitt h2 >> text=Sprint 2');
    assert.equal(await seite.locator(".abschnitt").count(), 2);
    assert.match(lesen("WS-4"), /sprint: sprint-02\n/);
    assert.match(lesen("WS-5"), /sprint: sprint-01\n/); // erledigt bleibt
    await seite.locator('[data-sprint-aktion="starten"]').click();
    await seite.locator("#dialog-klein button[type=submit]").click();
    await seite.waitForSelector(".spalten");
    assert.match(readFileSync(join(projekt, "sprints", "sprint-02.md"), "utf8"), /status: aktiv\n/);
  });

  await schritt("Kaputte Datei erscheint unter Probleme", async () => {
    writeFileSync(join(eintraege, "kaputt.md"), "kein Frontmatter");
    await seite.waitForSelector("#reiter-probleme:not([hidden])", { timeout: 6000 });
    await seite.locator("#reiter-probleme").click();
    await seite.waitForSelector(".probleme >> text=kaputt.md");
  });

  await schritt("Neues Projekt anlegen und wechseln", async () => {
    await seite.locator("#menue-knopf").click();
    await seite.locator('[data-aktion="projekt-neu"]').click();
    await seite.fill('#dialog-klein input[name="name"]', "Interne Tools");
    await seite.locator("#dialog-klein button[type=submit]").click();
    await seite.waitForFunction(() => document.querySelector("#projektwahl").value === "Interne Tools");
    await seite.keyboard.press("b");
    await seite.waitForSelector(".abschnitt h2 >> text=Backlog");
    await seite.keyboard.press("c");
    await seite.fill("#f-titel", "Erstes Ticket");
    await seite.keyboard.press("Control+Enter");
    await seite.waitForSelector('.zeile[data-id="IT-1"]');
  });

  await schritt("Keine Fehler in der Browser-Konsole", async () => {
    assert.deepEqual(fehler, []);
  });
  console.log(`\n${schritte} Schritte erfolgreich.`);
} catch (e) {
  await seite.screenshot({ path: join(tmpdir(), "ticket-board-e2e-fehler.png"), fullPage: true }).catch(() => {});
  console.error("✘", e);
  if (fehler.length) console.error("Browser-Fehler:", fehler);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
}
