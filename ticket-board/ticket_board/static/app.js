/* Ticket-Board – Oberfläche (ohne Framework). */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const h = (s) => Markdown.esc(s == null ? "" : s);

const TYP_NAMEN = { epic: "Epic", story: "Story", aufgabe: "Aufgabe", bug: "Bug", unteraufgabe: "Unteraufgabe" };
const TYP_KURZ = { epic: "E", story: "S", aufgabe: "A", bug: "B", unteraufgabe: "U" };
const STATUS_NAMEN = { offen: "Offen", "in-arbeit": "In Arbeit", review: "Review", erledigt: "Erledigt" };
const PRIO_NAMEN = { niedrig: "Niedrig", mittel: "Mittel", hoch: "Hoch", kritisch: "Kritisch" };
const PRIO_SYMBOL = { niedrig: "↓", mittel: "=", hoch: "↑", kritisch: "⇈" };
const ANSICHTEN = ["backlog", "board", "epics", "probleme"];

const S = {
  info: null,
  pid: null,
  d: null,               // Projektdaten vom Server
  nachId: new Map(),
  ansicht: "backlog",
  filter: leererFilter(),
  dlg: null,             // offener Eintrags-Dialog
  zieh: null,            // laufendes Drag & Drop
};

function leererFilter() {
  return { text: "", typen: new Set(), epic: "", version: "", hervorhebung: "", ueberfaellig: false, erledigte: false };
}

/* ---------- Hilfen --------------------------------------------------------- */
const speicher = {
  lesen(k) { try { return localStorage.getItem("ticket-board:" + k); } catch { return null; } },
  schreiben(k, v) { try { localStorage.setItem("ticket-board:" + k, v); } catch { /* egal */ } },
};

function heute() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusTage(iso, tage) {
  const [j, m, t] = iso.split("-").map(Number);
  const d = new Date(j, m - 1, t + tage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function tageBis(iso) {
  const [j, m, t] = iso.split("-").map(Number);
  const [hj, hm, ht] = heute().split("-").map(Number);
  return Math.round((Date.UTC(j, m - 1, t) - Date.UTC(hj, hm - 1, ht)) / 86400000);
}
function datum(iso, kurz = false) {
  if (!iso) return "";
  const [j, m, t] = iso.split("-");
  return kurz ? `${t}.${m}.` : `${t}.${m}.${j}`;
}
const farbeOk = (f) => (/^#[0-9a-fA-F]{6}$/.test(f || "") ? f : "");

async function api(methode, pfad, daten) {
  const opt = { method: methode, headers: { "X-Ticket-Board": "1" } };
  if (daten !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(daten);
  }
  let r;
  try {
    r = await fetch("/api/" + pfad, opt);
  } catch {
    throw Object.assign(new Error("Keine Verbindung zum Ticket-Board-Server. Läuft er noch?"), { status: 0 });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.fehler || r.statusText), { status: r.status, aktuell: j.aktuell });
  return j;
}
const pp = (rest = "") => `p/${encodeURIComponent(S.pid)}${rest}`;

let meldungTimer = null;
function meldung(text, fehler = false) {
  const el = $("#meldung");
  el.textContent = text;
  el.classList.toggle("fehler", fehler);
  el.hidden = false;
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => { el.hidden = true; }, fehler ? 6000 : 2500);
}
async function versuche(fn) {
  try { return await fn(); } catch (e) { meldung(e.message, true); return undefined; }
}

/* ---------- Daten ------------------------------------------------------------ */
const eintraege = () => (S.d ? S.d.eintraege : []);
const sprints = () => (S.d ? S.d.sprints : []);
const aktiverSprint = () => sprints().find((s) => s.status === "aktiv");
const offeneSprints = () => {
  const l = sprints().filter((s) => s.status !== "abgeschlossen");
  return [...l.filter((s) => s.status === "aktiv"), ...l.filter((s) => s.status !== "aktiv")];
};
const epics = () => eintraege().filter((e) => e.typ === "epic");
const unteraufgaben = (id) => eintraege().filter((e) => e.eltern === id && e.typ === "unteraufgabe");
const imEpic = (id) => eintraege().filter((e) => e.epic === id && e.typ !== "epic" && e.typ !== "unteraufgabe");

/** Abschnitt im Backlog: offene Sprint-ID, "" = Backlog, null = in abgeschlossenem Sprint erledigt. */
function abschnittVon(e) {
  if (e.typ === "epic") return null;
  const s = sprints().find((x) => x.id === e.sprint);
  if (s && s.status !== "abgeschlossen") return s.id;
  if (s && e.status === "erledigt") return null;
  return "";
}

function hervorhebung(farbe) {
  if (!farbe || !S.d) return null;
  return S.d.projekt.hervorhebungen.find((x) => x.farbe === farbe) || { farbe, name: "Hervorgehoben" };
}

async function laden() {
  if (!S.pid) { S.d = null; S.nachId = new Map(); return; }
  S.d = await api("GET", pp());
  S.nachId = new Map(S.d.eintraege.map((e) => [e.id, e]));
}

/* ---------- Filter ------------------------------------------------------------ */
function ueberfaellig(e) {
  return e.faellig && e.status !== "erledigt" && tageBis(e.faellig) < 0;
}
function passt(e) {
  const f = S.filter;
  if (f.text) {
    const q = f.text.toLowerCase();
    const heu = [e.id, e.titel, e.version, ...(e.labels || []), e.text].join("\n").toLowerCase();
    if (!q.split(/\s+/).every((t) => heu.includes(t))) return false;
  }
  if (f.typen.size && !f.typen.has(e.typ)) return false;
  if (f.epic === "__ohne" ? e.epic : f.epic && e.epic !== f.epic) return false;
  if (f.version === "__ohne" ? e.version : f.version && e.version !== f.version) return false;
  if (f.hervorhebung === "__ohne" ? e.farbe : f.hervorhebung && e.farbe !== f.hervorhebung) return false;
  if (f.ueberfaellig && !ueberfaellig(e)) return false;
  return true;
}
function filterAktiv() {
  const f = S.filter;
  return !!(f.text || f.typen.size || f.epic || f.version || f.hervorhebung || f.ueberfaellig);
}

function filterRender() {
  const leiste = $("#filterleiste");
  if (!S.d || S.ansicht === "probleme") { leiste.innerHTML = ""; return; }
  const f = S.filter;
  const typen = S.ansicht === "epics" ? [] : ["story", "aufgabe", "bug", "unteraufgabe"];
  const versionen = [...new Set(eintraege().map((e) => e.version).filter(Boolean))].sort(versionVergleich);
  const opt = (wert, text, aktuell) => `<option value="${h(wert)}"${wert === aktuell ? " selected" : ""}>${h(text)}</option>`;
  let html = typen.map((t) => `<button class="chip" data-typ="${t}" aria-pressed="${f.typen.has(t)}">${typSymbol(t)} ${TYP_NAMEN[t]}</button>`).join("");
  if (typen.length) html += `<span class="trenner"></span>`;
  if (S.ansicht !== "epics") {
    html += `<select data-filter="epic" aria-label="Epic">${opt("", "Alle Epics", f.epic)}${opt("__ohne", "Ohne Epic", f.epic)}${epics().map((e) => opt(e.id, `${e.id} ${e.titel}`, f.epic)).join("")}</select>`;
  }
  html += `<select data-filter="version" aria-label="Version">${opt("", "Alle Versionen", f.version)}${opt("__ohne", "Ohne Version", f.version)}${versionen.map((v) => opt(v, v, f.version)).join("")}</select>`;
  html += `<select data-filter="hervorhebung" aria-label="Hervorhebung">${opt("", "Alle Farben", f.hervorhebung)}${opt("__ohne", "Ohne Hervorhebung", f.hervorhebung)}${S.d.projekt.hervorhebungen.map((x) => opt(x.farbe, x.name, f.hervorhebung)).join("")}</select>`;
  html += `<button class="chip" data-schalter="ueberfaellig" aria-pressed="${f.ueberfaellig}">⚠ Überfällig</button>`;
  if (S.ansicht !== "board") {
    html += `<button class="chip" data-schalter="erledigte" aria-pressed="${f.erledigte}">${S.ansicht === "epics" ? "Erledigte Epics zeigen" : "Erledigte im Backlog zeigen"}</button>`;
  }
  if (filterAktiv()) html += `<button class="knopf klein zuruecksetzen" data-filter-weg>Filter zurücksetzen</button>`;
  leiste.innerHTML = html;
}

function versionVergleich(a, b) {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

/* ---------- Bausteine ---------------------------------------------------------- */
const typSymbol = (t) => `<span class="typ t-${t}" title="${TYP_NAMEN[t]}" aria-label="${TYP_NAMEN[t]}">${TYP_KURZ[t]}</span>`;
const prioSymbol = (p) => `<span class="prio prio-${p}" title="Priorität: ${PRIO_NAMEN[p]}">${PRIO_SYMBOL[p]}</span>`;
const statusPille = (s) => `<span class="pille s-${s}">${STATUS_NAMEN[s]}</span>`;

function epicMarke(id) {
  const ep = S.nachId.get(id);
  if (!ep) return "";
  const farbe = farbeOk(ep.farbe) || "var(--typ-epic)";
  return `<span class="marke-epic" style="--epicfarbe:${farbe}" title="Epic ${h(ep.id)}: ${h(ep.titel)}">${h(ep.titel)}</span>`;
}
function faelligMarke(e) {
  if (!e.faellig) return "";
  const t = tageBis(e.faellig);
  let kl = "", titel = `Fällig am ${datum(e.faellig)}`;
  if (e.status !== "erledigt") {
    if (t < 0) { kl = "ueberfaellig"; titel += ` – seit ${-t} Tag${t === -1 ? "" : "en"} überfällig`; }
    else if (t <= 3) { kl = "bald"; titel += t === 0 ? " – heute" : ` – in ${t} Tag${t === 1 ? "" : "en"}`; }
  }
  return `<span class="faellig ${kl}" title="${titel}">${kl === "ueberfaellig" ? "⚠ " : "📅 "}${datum(e.faellig, true)}</span>`;
}
const versionMarke = (e) => (e.version ? `<span class="marke-version" title="Version">${h(e.version)}</span>` : "");
const labelMarken = (e) => (e.labels || []).map((l) => `<span class="marke-label">${h(l)}</span>`).join("");
function hervorhebungMarke(e) {
  const hv = hervorhebung(farbeOk(e.farbe));
  return hv ? `<span class="hervorhebung-name" style="--hfarbe:${hv.farbe}">${h(hv.name)}</span>` : "";
}
function hervorStil(e) {
  const f = farbeOk(e.farbe);
  return f ? { klasse: " hervorgehoben", stil: ` style="--hfarbe:${f}"` } : { klasse: "", stil: "" };
}

function zeileHtml(e, { ziehbar = true, unterZaehlen = true, elternZeigen = true } = {}) {
  const hv = hervorStil(e);
  const kinder = unterZaehlen ? unteraufgaben(e.id) : [];
  const kinderTxt = kinder.length
    ? `<span class="unter-zahl" title="Unteraufgaben">↳ ${kinder.filter((k) => k.status === "erledigt").length}/${kinder.length}</span>` : "";
  const eltern = elternZeigen && e.typ === "unteraufgabe" && S.nachId.get(e.eltern)
    ? `<span class="kennung" title="Unteraufgabe von ${h(e.eltern)}">↳ ${h(e.eltern)}</span>` : "";
  return `<li class="zeile t-${e.typ}${hv.klasse}"${hv.stil} data-id="${h(e.id)}" ${ziehbar ? 'draggable="true"' : ""} tabindex="0">
    ${typSymbol(e.typ)}<span class="kennung">${h(e.id)}</span>${eltern}
    <span class="titel${e.status === "erledigt" ? " erledigt-titel" : ""}">${h(e.titel)}</span>
    <span class="rechts">${hervorhebungMarke(e)}${labelMarken(e)}${epicMarke(e.epic)}${versionMarke(e)}${faelligMarke(e)}${kinderTxt}${prioSymbol(e.prioritaet)}${statusPille(e.status)}</span>
  </li>`;
}

function karteHtml(e) {
  const hv = hervorStil(e);
  const [an, alle] = Markdown.aufgabenZaehlen(e.text);
  const eltern = e.typ === "unteraufgabe" ? S.nachId.get(e.eltern) : null;
  const kinder = unteraufgaben(e.id);
  const oben = [hervorhebungMarke(e), epicMarke(e.epic), versionMarke(e), labelMarken(e)].join("");
  return `<div class="karte t-${e.typ}${hv.klasse}"${hv.stil} data-id="${h(e.id)}" draggable="true" tabindex="0">
    ${eltern ? `<div class="eltern">↳ ${h(eltern.id)} ${h(eltern.titel)}</div>` : ""}
    <div class="titel${e.status === "erledigt" ? " erledigt-titel" : ""}">${h(e.titel)}</div>
    ${oben ? `<div class="zeile-unten">${oben}</div>` : ""}
    <div class="zeile-unten">${typSymbol(e.typ)}${prioSymbol(e.prioritaet)}${faelligMarke(e)}
      ${alle ? `<span class="faellig" title="Checkliste">☑ ${an}/${alle}</span>` : ""}
      ${kinder.length ? `<span class="faellig" title="Unteraufgaben">↳ ${kinder.filter((k) => k.status === "erledigt").length}/${kinder.length}</span>` : ""}
      <span class="kennung">${h(e.id)}</span></div>
  </div>`;
}

function sprintZeitraum(s) {
  if (!s.start && !s.ende) return "";
  return `${datum(s.start, true) || "?"} – ${datum(s.ende) || "?"}`;
}
const mitPunkt = (...teile) => teile.filter(Boolean).join(" · ");

/* ---------- Ansichten ------------------------------------------------------------ */
function render() {
  $$(".reiter button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.ansicht === S.ansicht)));
  const probleme = S.d ? S.d.probleme.length : 0;
  $("#reiter-probleme").hidden = !probleme;
  $("#probleme-zahl").textContent = probleme || "";
  projektwahlRender();
  const mitProjekt = !!S.pid;
  [".reiter", "#suche", "#neu"].forEach((sel) => { $(sel).hidden = !mitProjekt; });
  filterRender();
  const inhalt = $("#inhalt");
  const scroll = window.scrollY;
  if (!S.info.projekte.length) inhalt.innerHTML = ersteSchritteHtml();
  else if (!S.d) inhalt.innerHTML = `<p class="hinweis">Projekt wird geladen …</p>`;
  else if (S.ansicht === "board") inhalt.innerHTML = boardHtml();
  else if (S.ansicht === "epics") inhalt.innerHTML = epicsHtml();
  else if (S.ansicht === "probleme") inhalt.innerHTML = problemeHtml();
  else inhalt.innerHTML = backlogHtml();
  window.scrollTo(0, scroll);
  document.title = S.d ? `${S.d.projekt.name} – Ticket-Board` : "Ticket-Board";
}

function projektwahlRender() {
  const sel = $("#projektwahl");
  sel.hidden = !S.info.projekte.length;
  sel.innerHTML = S.info.projekte.map((p) =>
    `<option value="${h(p.id)}"${p.id === S.pid ? " selected" : ""}>${h(p.name)}${p.kuerzel ? ` (${h(p.kuerzel)})` : ""}</option>`).join("");
}

function ersteSchritteHtml() {
  return `<div class="hinweis">
    <h2>Willkommen beim Ticket-Board</h2>
    <p>Noch gibt es hier kein Projekt. Lege das erste an – es wird als eigener Ordner in<br><code>${h(S.info.arbeitsbereich)}</code> gespeichert.</p>
    <form id="erstes-projekt" class="formular">
      <label class="feld"><span>Projektname</span><input type="text" name="name" required maxlength="80" placeholder="z. B. Webshop" autofocus></label>
      <label class="feld"><span>Kürzel für Ticket-IDs</span><input type="text" name="kuerzel" maxlength="10" placeholder="automatisch, z. B. WS" pattern="[A-Za-z][A-Za-z0-9]{0,9}"></label>
      <button class="knopf primaer" type="submit">Projekt anlegen</button>
    </form></div>`;
}

function backlogHtml() {
  const abschnitte = [...offeneSprints().map((s) => ({ id: s.id, sprint: s })), { id: "", sprint: null }];
  const aktiv = aktiverSprint();
  return abschnitte.map(({ id, sprint }) => {
    const alle = eintraege().filter((e) => abschnittVon(e) === id);
    const ids = new Set(alle.map((e) => e.id));
    let sichtbar = alle.filter((e) => !(e.typ === "unteraufgabe" && ids.has(e.eltern)));
    if (!sprint && !S.filter.erledigte) sichtbar = sichtbar.filter((e) => e.status !== "erledigt");
    const gefiltert = sichtbar.filter(passt);
    const zahl = filterAktiv() ? `${gefiltert.length} von ${sichtbar.length} Einträgen`
      : `${sichtbar.length} ${sichtbar.length === 1 ? "Eintrag" : "Einträge"}`;
    let kopf;
    if (sprint) {
      const erledigt = alle.filter((e) => e.status === "erledigt").length;
      const aktionen = sprint.status === "aktiv"
        ? `<button class="knopf klein" data-ansicht-wechsel="board">Zum Board</button>
           <button class="knopf klein" data-sprint-aktion="abschliessen" data-sprint="${sprint.id}">Sprint abschließen</button>`
        : `<button class="knopf klein primaer" data-sprint-aktion="starten" data-sprint="${sprint.id}" ${aktiv ? `disabled title="${h(aktiv.name)} läuft noch"` : ""}>Sprint starten</button>`;
      kopf = `<h2>${h(sprint.name)}</h2>
        ${sprint.status === "aktiv" ? `<span class="pille s-in-arbeit">aktiv</span>` : `<span class="pille">geplant</span>`}
        <span class="info">${mitPunkt(sprintZeitraum(sprint), h(sprint.ziel), zahl, sprint.status === "aktiv" ? `${erledigt} erledigt` : "")}</span>
        <span class="aktionen">${aktionen}<button class="knopf klein" data-sprint-aktion="bearbeiten" data-sprint="${sprint.id}">Bearbeiten</button></span>`;
    } else {
      kopf = `<h2>Backlog</h2><span class="info">${zahl}</span>
        <span class="aktionen"><button class="knopf klein" data-sprint-aktion="anlegen">+ Sprint anlegen</button></span>`;
    }
    const liste = gefiltert.length ? gefiltert.map((e) => zeileHtml(e)).join("")
      : `<li class="leer">${sprint ? "Einträge hierher ziehen, um sie für diesen Sprint einzuplanen" : "Backlog ist leer"}</li>`;
    return `<section class="abschnitt${sprint && sprint.status === "aktiv" ? " aktiv" : ""}">
      <div class="abschnitt-kopf">${kopf}</div>
      <ul class="liste" data-abschnitt="${h(id)}" data-art="liste">${liste}</ul>
      ${schnellAnlageHtml(id)}
    </section>`;
  }).join("");
}

function schnellAnlageHtml(sprint) {
  return `<form class="schnell" data-sprint="${h(sprint)}" style="display:flex;gap:6px;padding:4px 8px 10px">
    <select name="typ" aria-label="Typ">${["story", "aufgabe", "bug"].map((t) => `<option value="${t}"${t === "aufgabe" ? " selected" : ""}>${TYP_NAMEN[t]}</option>`).join("")}</select>
    <input type="text" name="titel" placeholder="+ Schnell anlegen: Titel eingeben und Enter" maxlength="200" style="flex:1" aria-label="Titel des neuen Eintrags">
  </form>`;
}

function boardHtml() {
  const s = aktiverSprint();
  if (!s) {
    return `<div class="hinweis"><h2>Kein aktiver Sprint</h2>
      <p>Plane im Backlog einen Sprint und starte ihn – dann erscheinen seine Einträge hier auf dem Board.</p>
      <button class="knopf primaer" data-ansicht-wechsel="backlog">Zum Backlog</button></div>`;
  }
  const alle = eintraege().filter((e) => e.sprint === s.id && e.typ !== "epic");
  const sichtbar = alle.filter(passt);
  const erledigt = alle.filter((e) => e.status === "erledigt").length;
  const prozent = alle.length ? Math.round((erledigt / alle.length) * 100) : 0;
  let rest = "";
  if (s.ende) {
    const t = tageBis(s.ende);
    rest = t > 0 ? `noch ${t} Tag${t === 1 ? "" : "e"}` : t === 0 ? "endet heute" : `<span class="fehlertext">${-t} Tag${t === -1 ? "" : "e"} über dem Ende</span>`;
  }
  const spalten = S.d.status.map((st) => {
    const karten = sichtbar.filter((e) => e.status === st);
    return `<div class="spalte"><h3><span>${STATUS_NAMEN[st]}</span><span>${karten.length}</span></h3>
      <div class="karten" data-status="${st}" data-abschnitt="${s.id}" data-art="board">${karten.map(karteHtml).join("")}</div></div>`;
  }).join("");
  return `<div class="sprint-kopf">
      <div><h1>${h(s.name)}</h1><p class="ziel">${s.ziel ? h(s.ziel) : "<em>Kein Sprintziel</em>"}</p></div>
      <div class="rechts">
        <span class="info">${sprintZeitraum(s)}${rest ? ` · ${rest}` : ""}</span>
        <span title="${erledigt} von ${alle.length} erledigt" style="display:flex;align-items:center;gap:6px">
          <span class="fortschritt"><span style="width:${prozent}%"></span></span>${prozent} %</span>
        <button class="knopf" data-sprint-aktion="bearbeiten" data-sprint="${s.id}">Bearbeiten</button>
        <button class="knopf primaer" data-sprint-aktion="abschliessen" data-sprint="${s.id}">Sprint abschließen</button>
      </div></div>
    <div class="spalten">${spalten}</div>`;
}

function epicsHtml() {
  let liste = epics().filter(passt);
  if (!S.filter.erledigte) liste = liste.filter((e) => e.status !== "erledigt");
  const karten = liste.map((ep) => {
    const kinder = imEpic(ep.id);
    const erledigt = kinder.filter((k) => k.status === "erledigt").length;
    const prozent = kinder.length ? Math.round((erledigt / kinder.length) * 100) : 0;
    const farbe = farbeOk(ep.farbe) || "var(--typ-epic)";
    const nachStatus = S.d.status.map((st) => [st, kinder.filter((k) => k.status === st).length])
      .filter(([, n]) => n).map(([st, n]) => `${n} ${STATUS_NAMEN[st]}`).join(" · ");
    return `<article class="epic-karte" data-id="${h(ep.id)}" tabindex="0" style="--epicfarbe:${farbe}">
      <div class="zeile-unten">${typSymbol("epic")}<span class="kennung">${h(ep.id)}</span>${statusPille(ep.status)}${hervorhebungMarke(ep)}</div>
      <h3${ep.status === "erledigt" ? ' class="erledigt-titel"' : ""}>${h(ep.titel)}</h3>
      <div class="fortschritt" title="${erledigt} von ${kinder.length} erledigt"><span style="width:${prozent}%"></span></div>
      <div class="zeile-unten"><span>${erledigt}/${kinder.length} erledigt (${prozent} %)</span>${nachStatus ? `<span>${nachStatus}</span>` : ""}</div>
      <div class="zeile-unten">${versionMarke(ep)}${faelligMarke(ep)}${labelMarken(ep)}${prioSymbol(ep.prioritaet)}</div>
    </article>`;
  }).join("");
  return `<div class="sprint-kopf"><div><h1>Epics</h1><p class="ziel">Große Vorhaben, die mehrere Einträge bündeln.</p></div>
    <div class="rechts"><button class="knopf primaer" data-neu-typ="epic">+ Epic</button></div></div>
    ${karten ? `<div class="epic-raster">${karten}</div>` : `<p class="leer">Keine Epics${filterAktiv() ? " für diesen Filter" : ""}.</p>`}`;
}

function problemeHtml() {
  const liste = S.d.probleme;
  if (!liste.length) return `<div class="hinweis"><h2>Keine Probleme</h2><p>Alle Dateien sind lesbar.</p></div>`;
  return `<section class="abschnitt"><div class="abschnitt-kopf"><h2>Probleme beim Lesen der Dateien</h2></div>
    <div style="padding:12px 16px"><p>Diese Dateien wurden ganz oder teilweise übersprungen. Korrigiere sie in einem Texteditor – die Ansicht aktualisiert sich automatisch.</p>
    <ul class="probleme">${liste.map((p) => `<li><code>${h(p.datei)}</code>: ${h(p.meldung)}</li>`).join("")}</ul></div></section>`;
}

/* ---------- Drag & Drop ------------------------------------------------------------ */
function abschnittsListe(abschnitt) {
  // Vollständige Reihenfolge eines Abschnitts (auch gefilterte / ausgeblendete Einträge)
  const aktiv = aktiverSprint();
  return eintraege().filter((e) => {
    if (e.typ === "epic") return false;
    if (aktiv && abschnitt === aktiv.id) return e.sprint === aktiv.id;
    return abschnittVon(e) === abschnitt;
  });
}

function dndEinrichten() {
  const inhalt = $("#inhalt");
  let platzhalter = null;

  const entfernen = () => {
    if (platzhalter) platzhalter.remove();
    platzhalter = null;
    $$(".ziel-aktiv").forEach((x) => x.classList.remove("ziel-aktiv"));
  };

  inhalt.addEventListener("dragstart", (ev) => {
    const el = ev.target.closest("[data-id][draggable]");
    if (!el) return;
    S.zieh = { id: el.dataset.id };
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", el.dataset.id);
    requestAnimationFrame(() => el.classList.add("zieht"));
  });
  inhalt.addEventListener("dragend", (ev) => {
    const el = ev.target.closest("[data-id]");
    if (el) el.classList.remove("zieht");
    entfernen();
    S.zieh = null;
  });
  inhalt.addEventListener("dragover", (ev) => {
    if (!S.zieh) return;
    const ziel = ev.target.closest("[data-art]");
    if (!ziel) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    $$(".ziel-aktiv").forEach((x) => x !== ziel && x.classList.remove("ziel-aktiv"));
    ziel.classList.add("ziel-aktiv");
    if (!platzhalter) {
      platzhalter = document.createElement(ziel.tagName === "UL" ? "li" : "div");
      platzhalter.className = "platzhalter";
    }
    const kinder = $$(":scope > [data-id]", ziel).filter((k) => k.dataset.id !== S.zieh.id);
    const danach = kinder.find((k) => {
      const r = k.getBoundingClientRect();
      return ev.clientY < r.top + r.height / 2;
    });
    if (danach) ziel.insertBefore(platzhalter, danach);
    else ziel.appendChild(platzhalter);
  });
  inhalt.addEventListener("dragleave", (ev) => {
    const ziel = ev.target.closest("[data-art]");
    if (ziel && !ziel.contains(ev.relatedTarget)) {
      ziel.classList.remove("ziel-aktiv");
      if (platzhalter && platzhalter.parentNode === ziel) platzhalter.remove();
    }
  });
  inhalt.addEventListener("drop", async (ev) => {
    if (!S.zieh) return;
    const ziel = ev.target.closest("[data-art]");
    if (!ziel) return;
    ev.preventDefault();
    const id = S.zieh.id;
    S.zieh = null;
    // Nachbarn um den Platzhalter herum bestimmen
    let nach = null, vor = null;
    if (platzhalter && platzhalter.parentNode === ziel) {
      let n = platzhalter.nextElementSibling;
      while (n && (!n.dataset.id || n.dataset.id === id)) n = n.nextElementSibling;
      let v = platzhalter.previousElementSibling;
      while (v && (!v.dataset.id || v.dataset.id === id)) v = v.previousElementSibling;
      nach = n ? n.dataset.id : null;
      vor = v ? v.dataset.id : null;
    }
    entfernen();
    const abschnitt = ziel.dataset.abschnitt;
    const liste = abschnittsListe(abschnitt).map((e) => e.id).filter((x) => x !== id);
    let pos = liste.length;
    if (nach && liste.includes(nach)) pos = liste.indexOf(nach);
    else if (vor && liste.includes(vor)) pos = liste.indexOf(vor) + 1;
    liste.splice(pos, 0, id);
    const daten = { sprint: abschnitt, ids: liste };
    if (ziel.dataset.art === "board") daten.status = { [id]: ziel.dataset.status };
    const e = S.nachId.get(id);
    const vorher = e ? { sprint: e.sprint, status: e.status } : null;
    // Sofort anzeigen, dann speichern
    if (e) {
      liste.forEach((x, i) => { const y = S.nachId.get(x); if (y) y.rang = (i + 1) * 1000; });
      e.sprint = abschnitt;
      if (daten.status) e.status = daten.status[id];
      S.d.eintraege.sort((a, b) => (a.rang ?? 1e12) - (b.rang ?? 1e12));
      render();
    }
    await versuche(async () => {
      await api("POST", pp("/reihenfolge"), daten);
      if (vorher && e && vorher.sprint !== abschnitt) {
        const s = sprints().find((x) => x.id === abschnitt);
        meldung(`${id} → ${s ? s.name : "Backlog"}`);
      }
    });
    await neuLaden();
  });
}

/* ---------- Eintrags-Dialog ---------------------------------------------------------- */
function optionen(liste, aktuell) {
  return liste.map(([wert, text]) => `<option value="${h(wert)}"${wert === aktuell ? " selected" : ""}>${h(text)}</option>`).join("");
}

function eintragOeffnen(id, zurueck = null) {
  const e = S.nachId.get(id);
  if (!e) { meldung(`${id} nicht gefunden`, true); return; }
  dialogZeigen(e, {}, zurueck);
}

function neuerEintrag(vorgaben = {}, zurueck = null) {
  const typ = vorgaben.typ || (S.ansicht === "epics" ? "epic" : "aufgabe");
  const aktiv = aktiverSprint();
  const basis = {
    id: null, typ, titel: "", status: "offen", prioritaet: "mittel",
    sprint: S.ansicht === "board" && aktiv && typ !== "epic" ? aktiv.id : "",
    epic: S.filter.epic && S.filter.epic !== "__ohne" && typ !== "epic" ? S.filter.epic : "",
    eltern: "", version: "", faellig: "", farbe: "", labels: [], text: null,
  };
  dialogZeigen(Object.assign(basis, vorgaben), vorgaben, zurueck);
}

function dialogZeigen(e, vorgaben, zurueck) {
  const neu = !e.id;
  const dlg = $("#dialog");
  const projekt = S.d.projekt;
  const text = e.text == null ? "" : e.text;
  const sprintOpt = [["", "Backlog"], ...sprints()
    .filter((s) => s.status !== "abgeschlossen" || s.id === e.sprint)
    .map((s) => [s.id, `${s.name}${s.status === "aktiv" ? " (aktiv)" : s.status === "abgeschlossen" ? " (abgeschlossen)" : ""}`])];
  const epicOpt = [["", "– kein Epic –"], ...epics().filter((x) => x.id !== e.id).map((x) => [x.id, `${x.id} ${x.titel}`])];
  const elternOpt = [["", "– wählen –"], ...eintraege().filter((x) => x.typ !== "epic" && x.typ !== "unteraufgabe" && x.id !== e.id)
    .map((x) => [x.id, `${x.id} ${x.titel}`])];
  const versionen = [...new Set(eintraege().map((x) => x.version).filter(Boolean))].sort(versionVergleich);
  const farben = [{ farbe: "", name: "Keine" }, ...projekt.hervorhebungen];
  if (e.farbe && !projekt.hervorhebungen.some((x) => x.farbe === e.farbe)) farben.push({ farbe: e.farbe, name: e.farbe });

  dlg.innerHTML = `<form class="dlg" id="eintrag-form" novalidate>
    <div class="dlg-kopf">
      <span id="d-typsymbol">${typSymbol(e.typ)}</span>
      <h2>${neu ? `Neuer Eintrag` : `<span class="kennung" style="font-size:14px">${h(e.id)}</span>`}</h2>
      ${zurueck ? `<button type="button" class="knopf klein" data-zurueck>← ${h(zurueck)}</button>` : ""}
      <button type="button" class="knopf symbol schliessen" data-schliessen title="Schließen (Esc)">✕</button>
    </div>
    <div class="dlg-rumpf">
      <div id="d-warnung"></div>
      <div class="eintrag-raster">
        <div>
          <label class="feld"><span>Titel</span><input id="f-titel" name="titel" type="text" required maxlength="200" value="${h(e.titel)}" placeholder="Kurz und eindeutig"></label>
          <div class="editor-reiter" role="tablist">
            <button type="button" role="tab" data-modus="bearbeiten">Bearbeiten</button>
            <button type="button" role="tab" data-modus="vorschau">Vorschau</button>
            <span class="hilfe">Markdown · Checklisten mit „- [ ]“ · Verweise wie ${h(projekt.kuerzel)}-1</span>
          </div>
          <textarea id="f-text" name="text" spellcheck="true">${h(text)}</textarea>
          <div class="vorschau" id="d-vorschau" hidden></div>
          <div id="d-unter"></div>
        </div>
        <div class="felder">
          <label class="feld"><span>Typ</span><select name="typ" id="f-typ">${optionen(S.d.typen.map((t) => [t, TYP_NAMEN[t]]), e.typ)}</select></label>
          <label class="feld"><span>Status</span><select name="status">${optionen(S.d.status.map((t) => [t, STATUS_NAMEN[t]]), e.status)}</select></label>
          <label class="feld"><span>Priorität</span><select name="prioritaet">${optionen(S.d.prioritaeten.map((t) => [t, `${PRIO_SYMBOL[t]} ${PRIO_NAMEN[t]}`]), e.prioritaet)}</select></label>
          <label class="feld" data-nur="kein-epic"><span>Sprint</span><select name="sprint" id="f-sprint">${optionen(sprintOpt, e.sprint)}</select></label>
          <label class="feld" data-nur="unteraufgabe"><span>Gehört zu</span><select name="eltern" id="f-eltern">${optionen(elternOpt, e.eltern)}</select></label>
          <label class="feld" data-nur="kein-epic"><span>Epic</span><select name="epic">${optionen(epicOpt, e.epic)}</select></label>
          <div class="zwei">
            <label class="feld"><span>Version</span><input name="version" type="text" maxlength="40" list="versionen" value="${h(e.version)}" placeholder="z. B. 1.2.0"></label>
            <label class="feld"><span>Fällig am</span><input name="faellig" type="date" value="${h(e.faellig)}"></label>
          </div>
          <datalist id="versionen">${versionen.map((v) => `<option value="${h(v)}">`).join("")}</datalist>
          <label class="feld"><span>Labels (mit Komma trennen)</span><input name="labels" type="text" value="${h((e.labels || []).join(", "))}" placeholder="z. B. frontend, kunde-x"></label>
          <div class="feld"><span class="feld-titel">Hervorhebung</span>
            <div class="farbwahl" role="group" aria-label="Hervorhebung">${farben.map((f) =>
              `<button type="button" data-farbe="${h(f.farbe)}" aria-pressed="${f.farbe === (e.farbe || "")}" style="--hfarbe:${farbeOk(f.farbe) || "transparent"}"><span class="punkt"></span>${h(f.name)}</button>`).join("")}</div>
          </div>
          ${neu ? "" : `<p class="info" style="font-size:12px;color:var(--text-3);margin:4px 0 0">Erstellt ${datum(e.erstellt)}${e.aktualisiert ? ` · geändert ${datum(e.aktualisiert)}` : ""}</p>`}
        </div>
      </div>
    </div>
    <div class="dlg-fuss">
      <div class="links">${neu ? "" : `<button type="button" class="knopf gefahr" data-loeschen>Löschen</button><span class="datei" title="Datei im Projektordner">${h(e.datei)}</span>`}</div>
      <button type="button" class="knopf" data-schliessen>Abbrechen</button>
      <button type="submit" class="knopf primaer" title="Speichern (Strg+Enter)">${neu ? "Anlegen" : "Speichern"}</button>
    </div>
  </form>`;

  S.dlg = { e, neu, zurueck, geaendert: false, farbe: e.farbe || "", text, basis: e.basis, vorgaben };
  const form = $("#eintrag-form");
  modus(neu || !text.trim() ? "bearbeiten" : "vorschau");
  sichtbarkeit();
  unterlisteRender();

  form.addEventListener("input", (ev) => {
    S.dlg.geaendert = true;
    if (ev.target.id === "f-text") S.dlg.text = ev.target.value;
  });
  form.addEventListener("change", (ev) => {
    S.dlg.geaendert = true;
    if (ev.target.id === "f-typ") { $("#d-typsymbol").innerHTML = typSymbol(ev.target.value); sichtbarkeit(); }
    if (ev.target.id === "f-eltern") sichtbarkeit();
  });
  form.addEventListener("submit", (ev) => { ev.preventDefault(); speichern(); });
  form.addEventListener("click", (ev) => {
    const t = ev.target;
    const fb = t.closest("[data-farbe]");
    if (fb) {
      S.dlg.farbe = fb.dataset.farbe;
      S.dlg.geaendert = true;
      $$(".farbwahl button", form).forEach((b) => b.setAttribute("aria-pressed", String(b === fb)));
      return;
    }
    const m = t.closest("[data-modus]");
    if (m) { modus(m.dataset.modus); return; }
    if (t.closest("[data-schliessen]")) { dialogSchliessen(); return; }
    if (t.closest("[data-zurueck]")) { if (verwerfenOk()) { dialogZu(); eintragOeffnen(zurueck); } return; }
    if (t.closest("[data-loeschen]")) { loeschen(); return; }
    const neuUnter = t.closest("[data-neu-unter]");
    if (neuUnter) {
      if (!verwerfenOk()) return;
      dialogZu();
      neuerEintrag(neuUnter.dataset.neuUnter === "epic" ? { typ: "aufgabe", epic: e.id } : { typ: "unteraufgabe", eltern: e.id, epic: e.epic }, e.id);
      return;
    }
    const link = t.closest("[data-oeffnen]");
    if (link) {
      ev.preventDefault();
      if (!verwerfenOk()) return;
      dialogZu();
      eintragOeffnen(link.dataset.oeffnen, neu ? null : e.id);
      return;
    }
    const box = t.closest("input[data-aufgabe]");
    if (box) {
      S.dlg.text = Markdown.aufgabeUmschalten(S.dlg.text, Number(box.dataset.aufgabe));
      $("#f-text").value = S.dlg.text;
      S.dlg.geaendert = true;
      vorschauRender();
    }
  });
  form.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === "Enter" || ev.key.toLowerCase() === "s")) {
      ev.preventDefault();
      speichern();
    }
  });
  dlg.oncancel = (ev) => { ev.preventDefault(); dialogSchliessen(); };
  if (!dlg.open) dlg.showModal();
  if (neu) $("#f-titel").focus();
  else $("[data-schliessen]", dlg).focus();
}

function modus(m) {
  const vorschau = m === "vorschau";
  $$("[data-modus]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.modus === m)));
  $("#f-text").hidden = vorschau;
  $("#d-vorschau").hidden = !vorschau;
  if (vorschau) vorschauRender();
  else $("#f-text").focus();
}
function vorschauRender() {
  const html = Markdown.render(S.dlg.text, (id) => S.nachId.has(id));
  $("#d-vorschau").innerHTML = html || `<p class="leer-text">Noch keine Beschreibung. Wechsle zu „Bearbeiten“.</p>`;
}

function sichtbarkeit() {
  const form = $("#eintrag-form");
  const typ = form.typ.value;
  $$("[data-nur]", form).forEach((el) => {
    const nur = el.dataset.nur;
    el.hidden = (nur === "kein-epic" && typ === "epic") || (nur === "unteraufgabe" && typ !== "unteraufgabe");
  });
  const sprint = $("#f-sprint");
  if (typ === "unteraufgabe") {
    const elt = S.nachId.get(form.eltern.value);
    sprint.disabled = true;
    sprint.title = "Unteraufgaben folgen dem Sprint ihres Elternteils";
    if (elt) sprint.value = elt.sprint;
  } else {
    sprint.disabled = false;
    sprint.title = "";
  }
}

function unterlisteRender() {
  const e = S.dlg.e;
  const ziel = $("#d-unter");
  if (S.dlg.neu || e.typ === "unteraufgabe") { ziel.innerHTML = ""; return; }
  const istEpic = e.typ === "epic";
  const liste = istEpic ? imEpic(e.id) : unteraufgaben(e.id);
  const erledigt = liste.filter((x) => x.status === "erledigt").length;
  ziel.innerHTML = `<div class="unterliste">
    <h3>${istEpic ? "Einträge in diesem Epic" : "Unteraufgaben"}${liste.length ? ` <span class="kennung">${erledigt}/${liste.length} erledigt</span>` : ""}
      <button type="button" class="knopf klein" data-neu-unter="${istEpic ? "epic" : "eintrag"}">+ ${istEpic ? "Eintrag" : "Unteraufgabe"}</button></h3>
    ${liste.length ? `<ul class="liste">${liste.map((x) => zeileHtml(x, { ziehbar: false, unterZaehlen: false, elternZeigen: false }).replace("<li ", `<li data-oeffnen="${h(x.id)}" `)).join("")}</ul>` : ""}
  </div>`;
}

function formWerte() {
  const form = $("#eintrag-form");
  const typ = form.typ.value;
  const w = {
    typ,
    titel: form.titel.value.trim(),
    status: form.status.value,
    prioritaet: form.prioritaet.value,
    version: form.version.value.trim(),
    faellig: form.faellig.value,
    labels: form.labels.value.split(",").map((s) => s.trim()).filter(Boolean),
    farbe: S.dlg.farbe,
    text: S.dlg.text,
  };
  if (typ !== "epic") {
    w.epic = form.epic.value;
    if (typ === "unteraufgabe") w.eltern = form.eltern.value;
    else w.sprint = form.sprint.value;
  }
  return w;
}

async function speichern(erzwingen = false) {
  const d = S.dlg;
  if (!d) return;
  const w = formWerte();
  if (!w.titel) { meldung("Bitte einen Titel eingeben", true); $("#f-titel").focus(); return; }
  if (w.typ === "unteraufgabe" && !w.eltern) { meldung("Bitte wählen, zu welchem Eintrag die Unteraufgabe gehört", true); return; }
  try {
    let erg;
    if (d.neu) {
      erg = await api("POST", pp("/eintraege"), w);
      meldung(`${erg.id} angelegt`);
    } else {
      const aenderung = {};
      for (const [k, v] of Object.entries(w)) {
        const alt = d.e[k] == null ? "" : d.e[k];
        if (JSON.stringify(v) !== JSON.stringify(alt)) aenderung[k] = v;
      }
      if (!Object.keys(aenderung).length) { dialogZu(); return; }
      if (!erzwingen) aenderung.basis = d.basis;
      erg = await api("PUT", pp(`/eintraege/${encodeURIComponent(d.e.id)}`), aenderung);
      meldung(`${erg.id} gespeichert`);
    }
    const zurueck = d.zurueck;
    dialogZu();
    await neuLaden();
    if (zurueck && S.nachId.has(zurueck)) eintragOeffnen(zurueck);
  } catch (err) {
    if (err.status === 409 && !d.neu) konfliktZeigen(err.message);
    else meldung(err.message, true);
  }
}

function konfliktZeigen(text) {
  $("#d-warnung").innerHTML = `<div class="warnbox"><strong>Konflikt:</strong> <span>${h(text)}</span>
    <button type="button" class="knopf klein" id="k-neu">Meine Änderungen verwerfen und neu laden</button>
    <button type="button" class="knopf klein gefahr" id="k-trotzdem">Trotzdem speichern</button></div>`;
  $("#k-neu").onclick = async () => { const id = S.dlg.e.id; dialogZu(); await neuLaden(); eintragOeffnen(id); };
  $("#k-trotzdem").onclick = () => speichern(true);
}

async function loeschen() {
  const e = S.dlg.e;
  if (!confirm(`${e.id} „${e.titel}“ löschen?\n\nDie Datei wird in den Ordner .papierkorb im Projekt verschoben.`)) return;
  try {
    await api("DELETE", pp(`/eintraege/${encodeURIComponent(e.id)}`));
    meldung(`${e.id} in den Papierkorb verschoben`);
    dialogZu();
    await neuLaden();
  } catch (err) { meldung(err.message, true); }
}

function verwerfenOk() {
  return !S.dlg || !S.dlg.geaendert || confirm("Ungespeicherte Änderungen verwerfen?");
}
function dialogSchliessen() {
  if (!verwerfenOk()) return;
  dialogZu();
}
function dialogZu() {
  const dlg = $("#dialog");
  if (dlg.open) dlg.close();
  dlg.innerHTML = "";
  S.dlg = null;
}

/* ---------- Kleine Dialoge ------------------------------------------------------------ */
function kleinDialog(titel, rumpf, knoepfe, beimOeffnen) {
  return new Promise((fertig) => {
    const dlg = $("#dialog-klein");
    dlg.innerHTML = `<form class="dlg" method="dialog" novalidate>
      <div class="dlg-kopf"><h2>${h(titel)}</h2><button type="button" class="knopf symbol schliessen" value="" data-x title="Schließen">✕</button></div>
      <div class="dlg-rumpf">${rumpf}</div>
      <div class="dlg-fuss"><div class="links"></div>${knoepfe.map((k) =>
        `<button type="${k.primaer ? "submit" : "button"}" class="knopf${k.primaer ? " primaer" : ""}${k.gefahr ? " gefahr" : ""}" data-wert="${h(k.wert)}">${h(k.text)}</button>`).join("")}</div>
    </form>`;
    const form = $("form", dlg);
    let ergebnis = null;
    const ende = (wert) => {
      ergebnis = wert;
      dlg.close();
    };
    form.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-x")) { ev.preventDefault(); ende(null); return; }
      if (b.type === "button") { ev.preventDefault(); ende({ wert: b.dataset.wert, form }); }
    });
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const k = knoepfe.find((x) => x.primaer);
      ende({ wert: k ? k.wert : "ok", form });
    });
    dlg.onclose = () => fertig(ergebnis);
    dlg.showModal();
    if (beimOeffnen) beimOeffnen(form);
    const erstes = $("input, select, textarea", form);
    if (erstes) erstes.focus();
  });
}

function sprintFelderHtml(s, { start = "", ende = "" } = {}) {
  return `<div class="formular">
    <label class="feld"><span>Name</span><input type="text" name="name" required maxlength="60" value="${h(s ? s.name : "")}" placeholder="Sprint ${sprints().length + 1}"></label>
    <label class="feld"><span>Sprintziel</span><input type="text" name="ziel" maxlength="300" value="${h(s ? s.ziel : "")}" placeholder="Was soll am Ende erreicht sein?"></label>
    <div class="zwei">
      <label class="feld"><span>Start</span><input type="date" name="start" value="${h(start || (s ? s.start : ""))}"></label>
      <label class="feld"><span>Ende</span><input type="date" name="ende" value="${h(ende || (s ? s.ende : ""))}"></label>
    </div></div>`;
}
const sprintWerte = (form) => ({
  name: form.name.value.trim() || `Sprint ${sprints().length + 1}`,
  ziel: form.ziel.value.trim(), start: form.start.value, ende: form.ende.value,
});

async function sprintAktion(aktion, sid) {
  const s = sprints().find((x) => x.id === sid);
  if (aktion === "anlegen") {
    const r = await kleinDialog("Sprint anlegen", sprintFelderHtml(null), [{ text: "Abbrechen", wert: "nein" }, { text: "Anlegen", wert: "ok", primaer: true }]);
    if (r && r.wert === "ok") {
      const w = sprintWerte(r.form);
      if (!r.form.name.value.trim()) delete w.name;
      await versuche(async () => { const n = await api("POST", pp("/sprints"), w); meldung(`${n.name} angelegt`); });
      await neuLaden();
    }
  } else if (aktion === "bearbeiten" && s) {
    const knoepfe = [{ text: "Abbrechen", wert: "nein" }, { text: "Speichern", wert: "ok", primaer: true }];
    if (s.status === "geplant") knoepfe.unshift({ text: "Sprint löschen", wert: "loeschen", gefahr: true });
    const r = await kleinDialog(`${s.name} bearbeiten`, sprintFelderHtml(s), knoepfe);
    if (r && r.wert === "ok") {
      await versuche(() => api("PUT", pp(`/sprints/${sid}`), sprintWerte(r.form)));
      await neuLaden();
    } else if (r && r.wert === "loeschen") {
      if (confirm(`${s.name} löschen? Seine Einträge wandern zurück ins Backlog.`)) {
        await versuche(() => api("DELETE", pp(`/sprints/${sid}`)));
        await neuLaden();
      }
    }
  } else if (aktion === "starten" && s) {
    const start = s.start || heute();
    const ende = s.ende || plusTage(start, S.d.projekt.sprint_dauer_tage);
    const anzahl = eintraege().filter((e) => e.sprint === sid && e.typ !== "epic").length;
    const r = await kleinDialog(`${s.name} starten`,
      `<p>${anzahl} Einträge sind eingeplant.</p>${sprintFelderHtml(s, { start, ende })}`,
      [{ text: "Abbrechen", wert: "nein" }, { text: "Sprint starten", wert: "ok", primaer: true }]);
    if (r && r.wert === "ok") {
      const ok = await versuche(() => api("POST", pp(`/sprints/${sid}/starten`), sprintWerte(r.form)));
      await neuLaden();
      if (ok) { meldung(`${s.name} läuft`); ansichtWechseln("board"); }
    }
  } else if (aktion === "abschliessen" && s) {
    const liste = eintraege().filter((e) => e.sprint === sid && e.typ !== "epic");
    const offen = liste.filter((e) => e.status !== "erledigt");
    const geplant = sprints().filter((x) => x.status === "geplant");
    const ziel = offen.length
      ? `<label class="feld"><span>${offen.length} unerledigte Einträge verschieben nach</span>
          <select name="ziel">${optionen([["", "Backlog"], ...geplant.map((x) => [x.id, x.name])], "")}</select></label>`
      : `<p>Alle Einträge sind erledigt. 🎉</p>`;
    const r = await kleinDialog(`${s.name} abschließen`,
      `<div class="formular"><p><strong>${liste.length - offen.length}</strong> erledigt, <strong>${offen.length}</strong> offen.</p>${ziel}</div>`,
      [{ text: "Abbrechen", wert: "nein" }, { text: "Sprint abschließen", wert: "ok", primaer: true }]);
    if (r && r.wert === "ok") {
      const zielId = r.form.ziel ? r.form.ziel.value : "";
      const erg = await versuche(() => api("POST", pp(`/sprints/${sid}/abschliessen`), { ziel: zielId }));
      await neuLaden();
      if (erg) { meldung(`${s.name} abgeschlossen`); ansichtWechseln("backlog"); }
    }
  }
}

async function projektNeu() {
  if (S.info.einzelprojekt) {
    meldung("Es ist ein einzelner Projektordner geöffnet. Starte die App mit einem übergeordneten Ordner, um mehrere Projekte zu verwalten.", true);
    return;
  }
  const r = await kleinDialog("Neues Projekt", `<div class="formular">
      <p style="margin:0">Jedes Projekt ist ein eigener Ordner in <code>${h(S.info.arbeitsbereich)}</code>.</p>
      <label class="feld"><span>Projektname</span><input type="text" name="name" required maxlength="80"></label>
      <label class="feld"><span>Kürzel für Ticket-IDs</span><input type="text" name="kuerzel" maxlength="10" placeholder="automatisch" pattern="[A-Za-z][A-Za-z0-9]{0,9}"></label></div>`,
    [{ text: "Abbrechen", wert: "nein" }, { text: "Anlegen", wert: "ok", primaer: true }]);
  if (r && r.wert === "ok") await projektAnlegen(r.form.name.value, r.form.kuerzel.value);
}

async function projektAnlegen(name, kuerzel) {
  const p = await versuche(() => api("POST", "projekte", { name, kuerzel: kuerzel.toUpperCase() }));
  if (!p) return;
  S.info = await api("GET", "info");
  await projektWaehlen(p.id);
  meldung(`Projekt „${p.name}“ angelegt (Kürzel ${p.kuerzel})`);
}

async function projektEinstellungen() {
  const p = S.d.projekt;
  const zeile = (hv) => `<div class="zwei" data-hv style="grid-template-columns:auto 1fr auto;align-items:center">
    <input type="color" value="${h(hv.farbe)}" aria-label="Farbe"><input type="text" value="${h(hv.name)}" maxlength="30" aria-label="Bedeutung" required>
    <button type="button" class="knopf klein" data-hv-weg title="Entfernen">✕</button></div>`;
  const r = await kleinDialog("Projekteinstellungen", `<div class="formular">
      <label class="feld"><span>Projektname</span><input type="text" name="name" required maxlength="80" value="${h(p.name)}"></label>
      <p style="margin:0">Kürzel: <strong>${h(p.kuerzel)}</strong> · Ordner: <code>${h(p.id)}</code></p>
      <label class="feld"><span>Standard-Sprintdauer (Tage)</span><input type="number" name="dauer" min="1" max="90" value="${p.sprint_dauer_tage}"></label>
      <div class="feld"><span class="feld-titel">Hervorhebungen (Farbe und Bedeutung)</span>
        <div id="hv-liste" style="display:grid;gap:6px">${p.hervorhebungen.map(zeile).join("")}</div>
        <button type="button" class="knopf klein" id="hv-neu" style="justify-self:start">+ Farbe</button></div></div>`,
    [{ text: "Abbrechen", wert: "nein" }, { text: "Speichern", wert: "ok", primaer: true }],
    (form) => {
      form.addEventListener("click", (ev) => {
        if (ev.target.id === "hv-neu") { ev.stopPropagation(); $("#hv-liste").insertAdjacentHTML("beforeend", zeile({ farbe: "#6366f1", name: "" })); }
        if (ev.target.hasAttribute("data-hv-weg")) { ev.stopPropagation(); ev.target.closest("[data-hv]").remove(); }
      }, true);
    });
  if (!r || r.wert !== "ok") return;
  const hervorhebungen = $$("[data-hv]", r.form).map((z) => {
    const [farbe, name] = $$("input", z);
    return { farbe: farbe.value, name: name.value.trim() };
  }).filter((x) => x.name);
  await versuche(() => api("PUT", pp("/projekt"), {
    name: r.form.name.value.trim(), sprint_dauer_tage: Number(r.form.dauer.value), hervorhebungen,
  }));
  S.info = await api("GET", "info");
  await neuLaden();
}

function hilfeZeigen() {
  const k = [["c", "Neuer Eintrag"], ["/", "Suchen"], ["b", "Backlog"], ["s", "Sprint-Board"], ["e", "Epics"],
    ["Strg + Enter", "Im Dialog speichern"], ["Esc", "Dialog schließen"], ["?", "Diese Hilfe"]];
  kleinDialog("Tastenkürzel", `<table class="kuerzel-tabelle">${k.map(([a, b]) => `<tr><td><kbd>${a}</kbd></td><td>${b}</td></tr>`).join("")}</table>
    <p style="font-size:13px;color:var(--text-2)">Einträge per Drag &amp; Drop zwischen Backlog und Sprints bzw. zwischen den Spalten des Boards verschieben.</p>`,
  [{ text: "Schließen", wert: "ok", primaer: true }]);
}

async function beenden() {
  if (!confirm("Ticket-Board beenden? Der lokale Server wird gestoppt.")) return;
  await versuche(() => api("POST", "beenden"));
  clearInterval(abfrageTimer);
  document.body.innerHTML = `<div class="hinweis"><h2>Ticket-Board beendet</h2><p>Du kannst dieses Fenster schließen.</p></div>`;
}

/* ---------- Thema ------------------------------------------------------------------------ */
function themaAnwenden() {
  const t = speicher.lesen("thema");
  if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function themaUmschalten() {
  const dunkelJetzt = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  speicher.schreiben("thema", dunkelJetzt ? "light" : "dark");
  themaAnwenden();
}

/* ---------- Steuerung ------------------------------------------------------------------- */
function ansichtWechseln(a) {
  if (!ANSICHTEN.includes(a)) return;
  S.ansicht = a;
  speicher.schreiben("ansicht", a);
  render();
}

async function projektWaehlen(pid) {
  S.pid = pid;
  speicher.schreiben("projekt", pid);
  S.filter = leererFilter();
  $("#suche").value = "";
  S.d = null;
  render();
  await versuche(laden);
  render();
}

async function neuLaden() {
  await versuche(laden);
  render();
  if (S.dlg && !S.dlg.neu && !S.dlg.geaendert) {
    // Offenen Dialog aktualisieren, falls die Datei geändert wurde
    const frisch = S.nachId.get(S.dlg.e.id);
    if (frisch && frisch.basis !== S.dlg.basis) dialogZeigen(frisch, {}, S.dlg.zurueck);
  }
}

let abfrageTimer = null;
let abfrageLaeuft = false;
async function abfragen() {
  if (abfrageLaeuft || !S.pid || !S.d || document.visibilityState !== "visible" || S.zieh) return;
  abfrageLaeuft = true;
  try {
    const { stand } = await api("GET", pp("/stand"));
    if (stand !== S.d.stand) {
      const offen = S.dlg && !S.dlg.neu ? S.dlg : null;
      if (offen && offen.geaendert) {
        await laden();
        render();
        const frisch = S.nachId.get(offen.e.id);
        if (!frisch) $("#d-warnung").innerHTML = `<div class="warnbox">Die Datei dieses Eintrags wurde außerhalb gelöscht oder umbenannt.</div>`;
        else if (frisch.basis !== offen.basis) $("#d-warnung").innerHTML = `<div class="warnbox">Die Datei wurde außerhalb geändert. Beim Speichern wirst du gefragt, welche Fassung gilt.</div>`;
      } else {
        await neuLaden();
      }
    }
  } catch { /* Server kurz nicht erreichbar – nächster Versuch */ }
  finally { abfrageLaeuft = false; }
}

function ereignisse() {
  $(".reiter").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ansicht]");
    if (b) ansichtWechseln(b.dataset.ansicht);
  });
  $("#projektwahl").addEventListener("change", (ev) => projektWaehlen(ev.target.value));
  $("#neu").addEventListener("click", () => S.d ? neuerEintrag() : null);

  let sucheTimer;
  $("#suche").addEventListener("input", (ev) => {
    clearTimeout(sucheTimer);
    sucheTimer = setTimeout(() => { S.filter.text = ev.target.value.trim(); render(); }, 120);
  });

  const menue = $("#menue-liste");
  $("#menue-knopf").addEventListener("click", (ev) => {
    ev.stopPropagation();
    menue.hidden = !menue.hidden;
    ev.currentTarget.setAttribute("aria-expanded", String(!menue.hidden));
  });
  document.addEventListener("click", () => { menue.hidden = true; });
  menue.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-aktion]");
    if (!a) return;
    menue.hidden = true;
    ({
      "projekt-neu": projektNeu,
      "projekt-einstellungen": () => S.d && projektEinstellungen(),
      thema: themaUmschalten,
      hilfe: hilfeZeigen,
      beenden,
    })[a.dataset.aktion]();
  });

  $("#filterleiste").addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-typ]");
    if (t) { const f = S.filter.typen; f.has(t.dataset.typ) ? f.delete(t.dataset.typ) : f.add(t.dataset.typ); render(); return; }
    const s = ev.target.closest("[data-schalter]");
    if (s) { S.filter[s.dataset.schalter] = !S.filter[s.dataset.schalter]; render(); return; }
    if (ev.target.closest("[data-filter-weg]")) {
      const erledigte = S.filter.erledigte;
      S.filter = leererFilter();
      S.filter.erledigte = erledigte;
      $("#suche").value = "";
      render();
    }
  });
  $("#filterleiste").addEventListener("change", (ev) => {
    const f = ev.target.dataset.filter;
    if (f) { S.filter[f] = ev.target.value; render(); }
  });

  const inhalt = $("#inhalt");
  inhalt.addEventListener("click", (ev) => {
    const t = ev.target;
    const sa = t.closest("[data-sprint-aktion]");
    if (sa) { sprintAktion(sa.dataset.sprintAktion, sa.dataset.sprint); return; }
    const aw = t.closest("[data-ansicht-wechsel]");
    if (aw) { ansichtWechseln(aw.dataset.ansichtWechsel); return; }
    const nt = t.closest("[data-neu-typ]");
    if (nt) { neuerEintrag({ typ: nt.dataset.neuTyp }); return; }
    const el = t.closest("[data-id]");
    if (el && !t.closest("a")) eintragOeffnen(el.dataset.id);
  });
  inhalt.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.matches("[data-id][tabindex]")) eintragOeffnen(ev.target.dataset.id);
  });
  inhalt.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    if (form.id === "erstes-projekt") {
      await projektAnlegen(form.name.value, form.kuerzel.value);
      return;
    }
    if (form.classList.contains("schnell")) {
      const titel = form.titel.value.trim();
      if (!titel) return;
      const erg = await versuche(() => api("POST", pp("/eintraege"), { typ: form.typ.value, titel, sprint: form.dataset.sprint }));
      if (erg) {
        meldung(`${erg.id} angelegt`);
        const typ = form.typ.value;
        await neuLaden();
        const neu = $(`form.schnell[data-sprint="${CSS.escape(form.dataset.sprint)}"]`);
        if (neu) { neu.typ.value = typ; neu.titel.focus(); }
      }
    }
  });
  dndEinrichten();

  document.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if ($("#dialog").open || $("#dialog-klein").open) return;
    if (ev.target.matches("input, textarea, select")) {
      if (ev.key === "Escape") ev.target.blur();
      return;
    }
    const aktion = {
      c: () => S.d && neuerEintrag(), "/": () => $("#suche").focus(), b: () => ansichtWechseln("backlog"),
      s: () => ansichtWechseln("board"), e: () => ansichtWechseln("epics"), "?": hilfeZeigen,
    }[ev.key];
    if (aktion) { ev.preventDefault(); aktion(); }
  });

  document.addEventListener("visibilitychange", abfragen);
  window.addEventListener("focus", abfragen);
  abfrageTimer = setInterval(abfragen, 2000);
}

async function start() {
  themaAnwenden();
  try {
    S.info = await api("GET", "info");
  } catch (e) {
    $("#inhalt").innerHTML = `<div class="hinweis"><h2>Server nicht erreichbar</h2><p>${h(e.message)}</p></div>`;
    return;
  }
  const ansicht = speicher.lesen("ansicht");
  if (ANSICHTEN.includes(ansicht) && ansicht !== "probleme") S.ansicht = ansicht;
  const gemerkt = speicher.lesen("projekt");
  const ids = S.info.projekte.map((p) => p.id);
  S.pid = ids.includes(gemerkt) ? gemerkt : ids[0] || null;
  ereignisse();
  render();
  if (S.pid) { await versuche(laden); render(); }
}

document.addEventListener("DOMContentLoaded", start);
