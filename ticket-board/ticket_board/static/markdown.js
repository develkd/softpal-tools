/* Kleiner Markdown-Renderer ohne Abhängigkeiten.
 * Unterstützt: Überschriften, Absätze, Listen (auch Checklisten), nummerierte Listen,
 * Zitate, Codeblöcke, Trennlinien, **fett**, *kursiv*, ~~durchgestrichen~~, `Code`,
 * [Links](https://…) und Verweise auf Einträge (TB-12 oder [[TB-12]]).
 * Alles wird zuerst HTML-escaped; Links sind nur für http(s)/mailto erlaubt.
 */
(function () {
  "use strict";

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  const AUFGABE = /^(\s*[-*+]\s+\[)([ xX])(\]\s?)/;
  const ZAUN = /^\s*(```|~~~)/;

  function inline(text, kennt) {
    const codes = [];
    let s = esc(text).replace(/`([^`]+)`/g, (_, c) => {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, url) => {
      const roh = url.replace(/&amp;/g, "&");
      if (!/^(https?:\/\/|mailto:)/i.test(roh)) return m;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    });
    s = s.replace(/\[\[([A-Z][A-Z0-9]{0,9}-\d+)\]\]/g, "$1");
    s = s.replace(/(^|[^\w\-/#=">])([A-Z][A-Z0-9]{0,9}-\d+)(?![\w-])/g, (m, vor, id) =>
      kennt && kennt(id) ? `${vor}<a href="#${id}" class="verweis" data-oeffnen="${id}">${id}</a>` : m);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
    return s;
  }

  function render(text, kennt) {
    const zeilen = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const aus = [];
    let absatz = [];
    let liste = null; // {typ: "ul"|"ol", punkte: []}
    let aufgabe = 0;

    const absatzEnde = () => {
      if (absatz.length) aus.push(`<p>${absatz.map((z) => inline(z, kennt)).join("<br>")}</p>`);
      absatz = [];
    };
    const listeEnde = () => {
      if (liste) aus.push(`<${liste.typ}>${liste.punkte.join("")}</${liste.typ}>`);
      liste = null;
    };

    for (let i = 0; i < zeilen.length; i++) {
      const z = zeilen[i];
      if (ZAUN.test(z)) {
        absatzEnde(); listeEnde();
        const zaun = z.trim().slice(0, 3);
        const code = [];
        i++;
        while (i < zeilen.length && !zeilen[i].trim().startsWith(zaun)) code.push(zeilen[i++]);
        aus.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
        continue;
      }
      if (/^\s*$/.test(z)) { absatzEnde(); listeEnde(); continue; }
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(z))) {
        absatzEnde(); listeEnde();
        const stufe = Math.min(6, m[1].length + 2);
        aus.push(`<h${stufe}>${inline(m[2], kennt)}</h${stufe}>`);
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(z)) { absatzEnde(); listeEnde(); aus.push("<hr>"); continue; }
      if ((m = /^\s*>\s?(.*)$/.exec(z))) {
        absatzEnde(); listeEnde();
        const zitat = [m[1]];
        while (i + 1 < zeilen.length && (m = /^\s*>\s?(.*)$/.exec(zeilen[i + 1]))) { zitat.push(m[1]); i++; }
        aus.push(`<blockquote>${zitat.map((q) => inline(q, kennt)).join("<br>")}</blockquote>`);
        continue;
      }
      if ((m = AUFGABE.exec(z))) {
        absatzEnde();
        if (!liste || liste.typ !== "ul") { listeEnde(); liste = { typ: "ul", punkte: [] }; }
        const an = m[2] !== " ";
        const rest = z.slice(m[0].length);
        liste.punkte.push(`<li class="aufgabe${an ? " erledigt" : ""}"><label><input type="checkbox" data-aufgabe="${aufgabe++}"${an ? " checked" : ""}> <span>${inline(rest, kennt)}</span></label></li>`);
        continue;
      }
      if ((m = /^\s*[-*+]\s+(.*)$/.exec(z))) {
        absatzEnde();
        if (!liste || liste.typ !== "ul") { listeEnde(); liste = { typ: "ul", punkte: [] }; }
        liste.punkte.push(`<li>${inline(m[1], kennt)}</li>`);
        continue;
      }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(z))) {
        absatzEnde();
        if (!liste || liste.typ !== "ol") { listeEnde(); liste = { typ: "ol", punkte: [] }; }
        liste.punkte.push(`<li>${inline(m[1], kennt)}</li>`);
        continue;
      }
      if (liste && /^\s{2,}\S/.test(z)) {
        // Fortsetzungszeile eines Listenpunkts
        const letzter = liste.punkte.length - 1;
        liste.punkte[letzter] = liste.punkte[letzter].replace(/<\/li>$/, `<br>${inline(z.trim(), kennt)}</li>`);
        continue;
      }
      listeEnde();
      absatz.push(z);
    }
    absatzEnde(); listeEnde();
    return aus.join("\n");
  }

  /** n-te Checkbox (außerhalb von Codeblöcken) im Markdown-Text umschalten. */
  function aufgabeUmschalten(text, n) {
    const zeilen = String(text).split("\n");
    let imCode = false;
    let zaehler = 0;
    for (let i = 0; i < zeilen.length; i++) {
      if (ZAUN.test(zeilen[i])) { imCode = !imCode; continue; }
      if (imCode) continue;
      const m = AUFGABE.exec(zeilen[i]);
      if (!m) continue;
      if (zaehler++ === n) {
        const neu = m[2] === " " ? "x" : " ";
        zeilen[i] = m[1] + neu + m[3] + zeilen[i].slice(m[0].length);
        return zeilen.join("\n");
      }
    }
    return text;
  }

  /** Checklisten-Fortschritt [erledigt, gesamt]. */
  function aufgabenZaehlen(text) {
    let imCode = false, an = 0, alle = 0;
    for (const z of String(text || "").split("\n")) {
      if (ZAUN.test(z)) { imCode = !imCode; continue; }
      if (imCode) continue;
      const m = AUFGABE.exec(z);
      if (m && z.slice(m[0].length).trim()) { alle++; if (m[2] !== " ") an++; }
    }
    return [an, alle];
  }

  window.Markdown = { render, esc, aufgabeUmschalten, aufgabenZaehlen };
})();
