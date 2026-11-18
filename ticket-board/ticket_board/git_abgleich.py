"""Abgleich eines Projektordners über Git.

Ein Abgleich besteht aus:

1. Änderungen im Projektordner committen – und nur dort. Liegt der Ordner in
   einem Code-Repository, bleibt der übrige Code unangetastet.
2. ``git fetch`` und, falls es Neues gibt, ``git merge`` des Upstream-Zweigs.
3. Konflikte in Ticket-Dateien feldweise zusammenführen (Drei-Wege-Vergleich auf
   Frontmatter-Ebene, Text über ``git merge-file``). Nur wenn dasselbe Feld auf
   beiden Seiten unterschiedlich geändert wurde, muss jemand entscheiden.
4. Auf zwei Geräten gleichzeitig vergebene IDs (zwei Dateien mit WS-15)
   bekommen auf der lokalen Seite eine neue Nummer.
5. ``git push``.

Git wird als Programm aufgerufen (kein Zusatzpaket). Anmeldedaten kommen aus der
normalen Git-Einrichtung (SSH-Schlüssel, Credential Manager); Git darf nie im
Terminal nach einem Passwort fragen, sonst würde die App hängen.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .frontmatter import Dokument, FrontmatterFehler
from .speicher import Fehler, Projekt, atomar_schreiben

NETZ_TIMEOUT = 90
LOKAL_TIMEOUT = 30

# Felder, die bei Änderungen auf beiden Seiten ohne Rückfrage zusammengeführt werden
NEUESTES_DATUM = {"aktualisiert"}
GROESSTE_ZAHL = {"naechste_nummer"}
MEINE_GEWINNT = {"rang"}  # Reihenfolge: lokale Sortierung behalten

_URL = re.compile(r"^(https?://|ssh://|git://|file://|[\w.-]+@[\w.-]+:|/|~|\.{1,2}[/\\]|[A-Za-z]:[\\/]|\\\\)")


def git_verfuegbar() -> bool:
    return shutil.which("git") is not None


def _umgebung() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"     # nie im Terminal nach Zugangsdaten fragen
    env["GIT_MERGE_AUTOEDIT"] = "no"
    env["LC_ALL"] = "C"                  # Meldungen auf Englisch, damit sie erkennbar sind
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
    return env


def git(*args: str, cwd: Path, pruefen: bool = True, timeout: int = LOKAL_TIMEOUT) -> subprocess.CompletedProcess:
    if not git_verfuegbar():
        raise Fehler("Git ist nicht installiert (https://git-scm.com/downloads).", 501)
    try:
        r = subprocess.run(
            ["git", "-c", "core.quotepath=false", *args], cwd=cwd, capture_output=True,
            text=True, encoding="utf-8", errors="replace", env=_umgebung(), timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        raise Fehler(f"git {args[0]} hat nicht innerhalb von {timeout} s geantwortet "
                     "(Netzwerk? Anmeldung?).", 504) from None
    if pruefen and r.returncode != 0:
        raise Fehler(_meldung(args, r), 502)
    return r


def _meldung(args: tuple[str, ...], r: subprocess.CompletedProcess) -> str:
    text = (r.stderr or r.stdout or "").strip()
    klein = text.lower()
    if "please tell me who you are" in klein or "empty ident" in klein:
        return ("Git kennt deinen Namen noch nicht. Einmalig in einer Konsole ausführen:\n"
                'git config --global user.name "Dein Name"\n'
                'git config --global user.email "du@example.com"')
    if ("authentication failed" in klein or "permission denied" in klein
            or "could not read username" in klein or "terminal prompts disabled" in klein):
        return ("Anmeldung beim Git-Server fehlgeschlagen. Richte einen SSH-Schlüssel oder den "
                "Git Credential Manager ein und probiere es dann erneut.\n\n" + text)
    if "could not resolve host" in klein or "unable to access" in klein or "connection" in klein:
        return "Der Git-Server ist nicht erreichbar:\n" + text
    if "rejected" in klein and "fetch first" in klein:
        return "Auf dem Server gibt es inzwischen neuere Änderungen – bitte noch einmal abgleichen."
    if "would be overwritten by merge" in klein:
        return ("Der Abgleich würde ungesicherte Änderungen außerhalb des Ticket-Ordners "
                "überschreiben. Bitte diese zuerst committen:\n" + text)
    return f"git {args[0]} fehlgeschlagen:\n{text}"


def url_pruefen(url: str) -> str:
    url = (url or "").strip()
    if not url:
        raise Fehler("Bitte eine Adresse angeben")
    if url.startswith("-") or "::" in url or "\n" in url or not _URL.match(url):
        raise Fehler("Das sieht nicht nach einer Git-Adresse aus. Beispiele: "
                     "https://github.com/name/tickets.git, git@github.com:name/tickets.git "
                     "oder ein Ordner wie D:\\Sync\\tickets.git")
    return url


# ---------------------------------------------------------------------------
# Drei-Wege-Zusammenführung einer Markdown-Datei
# ---------------------------------------------------------------------------
def _norm(zeilen: list[str] | None) -> list[str] | None:
    if zeilen is None:
        return None
    return [z.rstrip() for z in zeilen if z.strip()]


def _text_zusammenfuehren(basis: str, meine: str, fremde: str) -> str | None:
    """Freitext zeilenweise mit ``git merge-file`` zusammenführen; ``None`` bei Konflikt."""
    with tempfile.TemporaryDirectory(prefix="ticket-board-") as tmp:
        pfade = []
        for name, inhalt in (("meine", meine), ("basis", basis), ("fremde", fremde)):
            p = Path(tmp) / name
            p.write_text(inhalt, encoding="utf-8", newline="\n")
            pfade.append(str(p))
        r = git("merge-file", "-p", "-q", *pfade, cwd=Path(tmp), pruefen=False)
        return r.stdout if r.returncode == 0 else None


def dreiwege(basis: str | None, meine: str | None, fremde: str | None,
             wahl: str | None = None) -> tuple[str | None, list[dict[str, Any]]]:
    """Datei aus Basis, meiner und fremder Fassung zusammenführen.

    Gibt ``(inhalt, konflikte)`` zurück. ``inhalt`` ist ``None``, wenn die Datei
    gelöscht bleiben soll. Bei Konflikten wird – solange ``wahl`` fehlt – vorläufig
    meine Fassung des betroffenen Felds genommen; mit ``wahl`` ("meine"/"fremde")
    werden alle Konflikte zu dieser Seite aufgelöst.
    """
    if wahl not in (None, "meine", "fremde"):
        raise Fehler("wahl muss „meine“ oder „fremde“ sein")
    seite = meine if wahl != "fremde" else fremde

    if meine == fremde:
        return meine, []
    if meine is None or fremde is None:  # auf einer Seite gelöscht
        andere = fremde if meine is None else meine
        if andere == basis:
            return None, []
        if wahl:
            return seite, []
        return meine, [{"feld": "(Datei)", "meine": "gelöscht" if meine is None else "geändert",
                        "fremde": "gelöscht" if fremde is None else "geändert"}]

    try:
        b = Dokument.lesen(basis) if basis else Dokument()
        o = Dokument.lesen(meine)
        t = Dokument.lesen(fremde)
    except (FrontmatterFehler, ValueError):
        if wahl:
            return seite, []
        return meine, [{"feld": "(ganze Datei)", "meine": "…", "fremde": "…"}]

    konflikte: list[dict[str, Any]] = []
    erg = Dokument()
    erg._vorspann = list(o._vorspann)
    schluessel = o.schluessel() + [k for k in t.schluessel() if k not in o]
    for k in schluessel:
        bz, oz, tz = b.roh(k), o.roh(k), t.roh(k)
        if _norm(oz) == _norm(tz):
            neu = oz
        elif _norm(oz) == _norm(bz):
            neu = tz
        elif _norm(tz) == _norm(bz):
            neu = oz
        elif k in NEUESTES_DATUM:
            neu = oz if str(o.get(k) or "") >= str(t.get(k) or "") else tz
        elif k in GROESSTE_ZAHL:
            def zahl(d: Dokument) -> int:
                try:
                    return int(str(d.get(k)))
                except (TypeError, ValueError):
                    return 0
            neu = oz if zahl(o) >= zahl(t) else tz
        elif k in MEINE_GEWINNT:
            neu = oz
        else:
            konflikte.append({"feld": k, "meine": o.get(k), "fremde": t.get(k)})
            neu = tz if wahl == "fremde" else oz
        erg.roh_setzen(k, neu)

    if o.text == t.text:
        erg.text = o.text
    elif o.text == b.text:
        erg.text = t.text
    elif t.text == b.text:
        erg.text = o.text
    else:
        zusammen = _text_zusammenfuehren(b.text, o.text, t.text)
        if zusammen is not None:
            erg.text = zusammen
        else:
            konflikte.append({"feld": "text", "meine": _kurz(o.text), "fremde": _kurz(t.text)})
            erg.text = t.text if wahl == "fremde" else o.text
    if wahl:
        konflikte = []
    return erg.als_text(), konflikte


def _kurz(text: str, laenge: int = 400) -> str:
    text = text.strip()
    return text if len(text) <= laenge else text[:laenge] + " …"


# ---------------------------------------------------------------------------
class GitAbgleich:
    """Git-Abgleich für einen Projektordner."""

    def __init__(self, projekt: Projekt) -> None:
        self.projekt = projekt
        self.pfad = projekt.pfad
        self._sperre = projekt._sperre

    # -- Hilfen ------------------------------------------------------------------
    def _git(self, *args: str, **kw: Any) -> subprocess.CompletedProcess:
        return git(*args, cwd=kw.pop("cwd", self.pfad), **kw)

    def _wurzel(self) -> Path | None:
        if not git_verfuegbar():
            return None
        r = self._git("rev-parse", "--show-toplevel", pruefen=False)
        return Path(r.stdout.strip()) if r.returncode == 0 else None

    def _praefix(self) -> str:
        """Pfad des Projektordners relativ zur Repository-Wurzel (mit / am Ende oder leer)."""
        return self._git("rev-parse", "--show-prefix").stdout.strip()

    def _upstream(self) -> str | None:
        r = self._git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", pruefen=False)
        return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None

    def _hat_commit(self) -> bool:
        return self._git("rev-parse", "-q", "--verify", "HEAD", pruefen=False).returncode == 0

    def _merge_laeuft(self) -> bool:
        return self._git("rev-parse", "-q", "--verify", "MERGE_HEAD", pruefen=False).returncode == 0

    def _aenderungen(self) -> list[str]:
        """Geänderte Dateien im Projektordner (Pfade relativ zum Projektordner)."""
        r = self._git("status", "--porcelain", "-z", "--untracked-files=all", "--", ".")
        teile = r.stdout.split("\0")
        dateien, i = [], 0
        praefix = self._praefix()
        while i < len(teile):
            eintrag = teile[i]
            i += 1
            if len(eintrag) < 4:
                continue
            code, pfad = eintrag[:2], eintrag[3:]
            if code[0] in "RC":
                i += 1  # ursprünglicher Pfad folgt
            dateien.append(pfad[len(praefix):] if pfad.startswith(praefix) else pfad)
        return dateien

    def _konfliktdateien(self, wurzel: Path) -> list[str]:
        r = self._git("diff", "--name-only", "-z", "--diff-filter=U", cwd=wurzel)
        return [p for p in r.stdout.split("\0") if p]

    def _stufe(self, wurzel: Path, nr: int, pfad: str) -> str | None:
        r = self._git("show", f":{nr}:{pfad}", cwd=wurzel, pruefen=False)
        return r.stdout if r.returncode == 0 else None

    # -- Status ------------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        if not git_verfuegbar():
            return {"verfuegbar": False, "aktiv": False,
                    "grund": "Git ist auf diesem Rechner nicht installiert."}
        wurzel = self._wurzel()
        if wurzel is None:
            return {"verfuegbar": True, "aktiv": False,
                    "grund": "Der Projektordner liegt in keinem Git-Repository."}
        zweig = self._git("symbolic-ref", "--short", "-q", "HEAD", pruefen=False).stdout.strip()
        upstream = self._upstream()
        remotes = [r for r in self._git("remote").stdout.split() if r]
        url = ""
        if remotes:
            name = upstream.split("/", 1)[0] if upstream else ("origin" if "origin" in remotes else remotes[0])
            url = self._git("remote", "get-url", name, pruefen=False).stdout.strip()
        vor = zurueck = 0
        if upstream and self._hat_commit():
            r = self._git("rev-list", "--left-right", "--count", "HEAD...@{u}", pruefen=False)
            if r.returncode == 0:
                vor, zurueck = (int(x) for x in r.stdout.split())
        merge = self._merge_laeuft()
        letzter = ""
        if self._hat_commit():
            letzter = self._git("log", "-1", "--format=%cI", "--", ".", pruefen=False).stdout.strip()
        return {
            "verfuegbar": True,
            "aktiv": True,
            "wurzel": str(wurzel),
            "praefix": self._praefix(),
            "zweig": zweig,
            "upstream": upstream or "",
            "remote_url": url,
            "remotes": remotes,
            "aenderungen": self._aenderungen(),
            "vor": vor,
            "zurueck": zurueck,
            "merge": merge,
            "konflikte": self._konflikt_details(wurzel) if merge else [],
            "letzter_commit": letzter,
        }

    def _konflikt_details(self, wurzel: Path) -> list[dict[str, Any]]:
        praefix = self._praefix()
        details = []
        for pfad in self._konfliktdateien(wurzel):
            basis, meine, fremde = (self._stufe(wurzel, n, pfad) for n in (1, 2, 3))
            _, konflikte = dreiwege(basis, meine, fremde)
            info: dict[str, Any] = {"datei": pfad, "anzeige": pfad[len(praefix):] if pfad.startswith(praefix) else pfad,
                                    "felder": konflikte, "id": "", "titel": ""}
            for inhalt in (meine, fremde):
                try:
                    dok = Dokument.lesen(inhalt or "")
                    info["id"] = info["id"] or str(dok.get("id") or dok.get("name") or "")
                    info["titel"] = info["titel"] or str(dok.get("titel") or dok.get("name") or "")
                except FrontmatterFehler:
                    pass
            details.append(info)
        return details

    # -- Einrichten --------------------------------------------------------------
    def einrichten(self, url: str = "") -> dict[str, Any]:
        """Repository anlegen (falls nötig), ersten Commit erstellen, Remote eintragen, pushen."""
        url = url_pruefen(url) if url.strip() else ""
        with self._sperre:
            wurzel = self._wurzel()
            if wurzel is None:
                self._git("init", "-q", "-b", "main")
            ignorieren = self.pfad / ".gitignore"
            if not ignorieren.exists():
                atomar_schreiben(ignorieren, "# Ticket-Board: Zwischendateien beim Speichern\n.tmp-*\n")
            attribute = self.pfad / ".gitattributes"
            if not attribute.exists():
                # Gleiche Zeilenenden auf allen Geräten (sonst meldet Git unter Windows Scheinänderungen)
                atomar_schreiben(attribute, "*.md text eol=lf\n")
            self._lokal_committen(f"Ticket-Board: Projekt {self.projekt.einstellungen()['name']}")
            if url:
                remotes = self._git("remote").stdout.split()
                if "origin" in remotes:
                    self._git("remote", "set-url", "origin", url)
                else:
                    self._git("remote", "add", "origin", url)
        if url:
            # Gibt es auf dem Server schon Inhalte, nicht blind überschreiben
            r = self._git("ls-remote", "--heads", "origin", timeout=NETZ_TIMEOUT, pruefen=False)
            if r.returncode != 0:
                raise Fehler(_meldung(("ls-remote",), r), 502)
            zweig = self._git("symbolic-ref", "--short", "HEAD").stdout.strip()
            if r.stdout.strip():
                self._git("fetch", "origin", timeout=NETZ_TIMEOUT)
                if self._git("rev-parse", "-q", "--verify", f"origin/{zweig}", pruefen=False).returncode == 0:
                    if self._git("merge-base", "HEAD", f"origin/{zweig}", pruefen=False).returncode != 0:
                        raise Fehler("Auf dem Server liegt bereits ein anderes Projekt mit eigener Historie. "
                                     "Um es auf diesen Rechner zu holen, nutze „Projekt aus Git holen …“ "
                                     "im Menü – oder gib eine leere Repository-Adresse an.", 409)
                    self._git("branch", f"--set-upstream-to=origin/{zweig}")
                    return self.abgleichen()
            self._git("push", "-u", "origin", "HEAD", timeout=NETZ_TIMEOUT)
        return {"meldung": "Git-Abgleich eingerichtet", "status": self.status()}

    # -- Abgleich ----------------------------------------------------------------
    def _lokal_committen(self, nachricht: str | None = None) -> list[str]:
        geaendert = self._aenderungen()
        if not geaendert:
            return []
        self._git("add", "-A", "--", ".")
        if nachricht is None:
            ids = sorted({m.group(1) for d in geaendert if (m := re.search(r"([A-Z][A-Z0-9]{0,9}-\d+)", Path(d).name))},
                         key=lambda x: (x.split("-")[0], int(x.split("-")[1])))
            name = self.projekt.einstellungen()["name"]
            if ids:
                liste = ", ".join(ids[:6]) + (f" (+{len(ids) - 6})" if len(ids) > 6 else "")
                nachricht = f"Ticket-Board {name}: {liste}"
            else:
                nachricht = f"Ticket-Board {name}: {len(geaendert)} Datei(en) geändert"
        if self._hat_commit():
            self._git("commit", "-q", "-m", nachricht, "--", ".")
        else:
            self._git("commit", "-q", "-m", nachricht)
        return geaendert

    def abgleichen(self, _nochmal: bool = True) -> dict[str, Any]:
        schritte: list[str] = []
        with self._sperre:
            if self._wurzel() is None:
                raise Fehler("Für dieses Projekt ist kein Git-Abgleich eingerichtet.")
            if self._merge_laeuft():
                return self._ergebnis(["Ein Abgleich wartet noch auf deine Entscheidung."])
            if self._lokal_committen():
                schritte.append("Änderungen gesichert")
            upstream = self._upstream()
            remotes = self._git("remote").stdout.split()

        if not upstream:
            if not remotes:
                schritte.append("Nur lokal gesichert – es ist kein Server (Remote) eingetragen")
                return self._ergebnis(schritte)
            remote = "origin" if "origin" in remotes else remotes[0]
            self._git("push", "-u", remote, "HEAD", timeout=NETZ_TIMEOUT)
            schritte.append(f"Zum ersten Mal nach {remote} übertragen")
            return self._ergebnis(schritte)

        remote = upstream.split("/", 1)[0]
        self._git("fetch", "-q", remote, timeout=NETZ_TIMEOUT)

        with self._sperre:
            vor, zurueck = (int(x) for x in self._git("rev-list", "--left-right", "--count", "HEAD...@{u}").stdout.split())
            if zurueck:
                ergebnis = self._zusammenfuehren(upstream)
                schritte.extend(ergebnis)
                if self._merge_laeuft():
                    return self._ergebnis(schritte)
                vor = int(self._git("rev-list", "--count", "@{u}..HEAD").stdout.strip())

        if vor:
            r = self._git("push", "-q", timeout=NETZ_TIMEOUT, pruefen=False)
            if r.returncode != 0:
                text = (r.stderr or "").lower()
                if _nochmal and "rejected" in text:
                    # Jemand war schneller – einmal erneut holen und zusammenführen
                    weiter = self.abgleichen(_nochmal=False)
                    weiter["schritte"] = schritte + weiter["schritte"]
                    return weiter
                raise Fehler(_meldung(("push",), r), 502)
            schritte.append("Übertragen")
        if not schritte:
            schritte.append("Alles aktuell")
        return self._ergebnis(schritte)

    def _zusammenfuehren(self, upstream: str) -> list[str]:
        wurzel = self._wurzel()
        assert wurzel is not None
        praefix = self._praefix()
        vorgemerkt = [p for p in self._git("diff", "--cached", "--name-only", "-z", cwd=wurzel).stdout.split("\0") if p]
        if vorgemerkt:
            raise Fehler("Im Repository sind Änderungen außerhalb des Ticket-Ordners vorgemerkt "
                         "(git add). Bitte diese zuerst committen oder zurücknehmen:\n" + "\n".join(vorgemerkt[:10]))
        lokal_vorher = self._git("rev-parse", "HEAD").stdout.strip()
        r = self._git("merge", "--no-edit", "-q", upstream, pruefen=False)
        schritte = ["Neues vom Server geholt"]
        if r.returncode != 0:
            if not self._merge_laeuft():
                raise Fehler(_meldung(("merge",), r), 502)
            konflikte = self._konfliktdateien(wurzel)
            fremd = [p for p in konflikte if not p.startswith(praefix)]
            if fremd:
                self._git("merge", "--abort")
                raise Fehler("Der Abgleich hat Konflikte außerhalb des Ticket-Ordners. Bitte in Git selbst lösen:\n"
                             + "\n".join(fremd[:10]))
            offen = 0
            for pfad in konflikte:
                if not self._datei_aufloesen(wurzel, pfad, None):
                    offen += 1
            if offen:
                schritte.append(f"{offen} Datei(en) brauchen deine Entscheidung")
                return schritte
            self._git("commit", "-q", "--no-edit")
            schritte.append(f"{len(konflikte)} Datei(en) automatisch zusammengeführt")
        schritte.extend(self._doppelte_ids_beheben(upstream, lokal_vorher))
        return schritte

    def _datei_aufloesen(self, wurzel: Path, pfad: str, wahl: str | None) -> bool:
        """Konfliktdatei zusammenführen. ``True``, wenn sie danach erledigt ist."""
        basis, meine, fremde = (self._stufe(wurzel, n, pfad) for n in (1, 2, 3))
        inhalt, konflikte = dreiwege(basis, meine, fremde, wahl)
        ziel = wurzel / pfad
        if inhalt is None:
            if konflikte:
                return False
            self._git("rm", "-q", "--", pfad, cwd=wurzel)
            return True
        # Ohne Konfliktmarker schreiben, damit die App die Datei weiter lesen kann
        atomar_schreiben(ziel, inhalt)
        if konflikte:
            return False
        self._git("add", "--", pfad, cwd=wurzel)
        return True

    def _doppelte_ids_beheben(self, upstream: str, lokal_vorher: str) -> list[str]:
        """Gleiche ID auf beiden Seiten vergeben → die lokal neu angelegte Datei umnummerieren."""
        praefix = self._praefix()
        def dateien(stand: str) -> set[str]:
            r = self._git("ls-tree", "-r", "--name-only", "--full-name", "-z", stand, "--", "eintraege")
            return {p for p in r.stdout.split("\0") if p}
        auf_server, lokal = dateien(upstream), dateien(lokal_vorher)
        nur_lokal = sorted(p[len(praefix):] for p in lokal - auf_server)
        probleme: list[dict] = []
        nach_id: dict[str, list[str]] = {}
        for datei in self.projekt._dateien(self.projekt.eintraege_ordner):
            e = self.projekt._eintrag_aus_datei(datei, probleme)
            if e:
                nach_id.setdefault(e["id"], []).append(e["datei"])
        schritte = []
        for eid, dateien in sorted(nach_id.items()):
            if len(dateien) < 2:
                continue
            for datei in dateien:
                if datei in nur_lokal and any(d not in nur_lokal for d in dateien):
                    neu = self.projekt.id_neu_vergeben(eid, datei, verweise_in=nur_lokal)
                    schritte.append(f"Doppelte ID: dein {eid} heißt jetzt {neu}")
                    break
        if schritte:
            self._lokal_committen("Ticket-Board: doppelte IDs nach Abgleich umnummeriert")
        return schritte

    def loesen(self, datei: str | None, wahl: str) -> dict[str, Any]:
        """Konflikt(e) auflösen: ``wahl`` = "meine" oder "fremde"; ``datei`` None = alle."""
        if wahl not in ("meine", "fremde"):
            raise Fehler("wahl muss „meine“ oder „fremde“ sein")
        with self._sperre:
            wurzel = self._wurzel()
            if wurzel is None or not self._merge_laeuft():
                raise Fehler("Es läuft kein Abgleich mit offenen Konflikten.", 409)
            offen = self._konfliktdateien(wurzel)
            if datei is not None and datei not in offen:
                raise Fehler(f"{datei} hat keinen offenen Konflikt", 404)
            for pfad in [datei] if datei else offen:
                self._datei_aufloesen(wurzel, pfad, wahl)
            if self._konfliktdateien(wurzel):
                return self._ergebnis(["Entscheidung übernommen"])
            upstream = self._upstream()
            lokal_vorher = self._git("rev-parse", "HEAD").stdout.strip()
            self._git("commit", "-q", "--no-edit")
            schritte = ["Konflikte gelöst"]
            if upstream:
                schritte.extend(self._doppelte_ids_beheben(upstream, lokal_vorher))
        weiter = self.abgleichen()
        weiter["schritte"] = schritte + weiter["schritte"]
        return weiter

    def abbrechen(self) -> dict[str, Any]:
        with self._sperre:
            if self._merge_laeuft():
                self._git("merge", "--abort")
            return self._ergebnis(["Abgleich abgebrochen – deine Fassung ist unverändert"])

    def _ergebnis(self, schritte: list[str]) -> dict[str, Any]:
        st = self.status()
        return {"schritte": schritte, "status": st,
                "zeit": dt.datetime.now().isoformat(timespec="seconds")}


def projekt_klonen(arbeitsbereich_pfad: Path, url: str, ordnername: str = "") -> str:
    """Bestehendes Ticket-Projekt aus Git in den Arbeitsbereich holen. Gibt den Ordnernamen zurück."""
    url = url_pruefen(url)
    name = ordnername.strip() or re.sub(r"\.git$", "", re.split(r"[/\\:]", url.rstrip("/\\"))[-1])
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", name).strip().strip(".")
    if not name:
        raise Fehler("Aus der Adresse lässt sich kein Ordnername ableiten – bitte einen angeben.")
    ziel = arbeitsbereich_pfad / name
    if ziel.exists():
        raise Fehler(f"Der Ordner „{name}“ existiert bereits", 409)
    arbeitsbereich_pfad.mkdir(parents=True, exist_ok=True)
    git("clone", "-q", "--", url, name, cwd=arbeitsbereich_pfad, timeout=NETZ_TIMEOUT * 2)
    if not (ziel / "projekt.md").is_file():
        shutil.rmtree(ziel, ignore_errors=True)
        raise Fehler("Im Repository liegt keine projekt.md im obersten Ordner – das ist kein Ticket-Board-Projekt.")
    return name
