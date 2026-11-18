"""Projekte, Sprints und Einträge als Markdown-Dateien auf der Platte.

Aufbau eines Arbeitsbereichs::

    arbeitsbereich/
    └── Mein Projekt/
        ├── projekt.md          Name, Kürzel, ID-Zähler, Sprint-Dauer, Hervorhebungen
        ├── sprints/sprint-01.md
        ├── eintraege/TB-12-login-umlaute.md
        └── .papierkorb/        gelöschte Einträge

Ein Ordner, der selbst eine ``projekt.md`` enthält, wird als einzelnes Projekt
geöffnet. Es gibt keinen Zwischenspeicher: Jede Anfrage liest die Dateien neu,
damit Änderungen in einem Texteditor sofort sichtbar sind.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import os
import re
import tempfile
import threading
import unicodedata
from pathlib import Path
from typing import Any

from .frontmatter import Dokument, FrontmatterFehler

TYPEN = ["epic", "story", "aufgabe", "bug", "unteraufgabe"]
STATUS = ["offen", "in-arbeit", "review", "erledigt"]
PRIORITAETEN = ["niedrig", "mittel", "hoch", "kritisch"]
SPRINT_STATUS = ["geplant", "aktiv", "abgeschlossen"]

EINTRAG_FELDER = [
    "id", "typ", "titel", "status", "prioritaet", "sprint", "epic", "eltern",
    "version", "faellig", "farbe", "labels", "rang", "erstellt", "aktualisiert",
]
SPRINT_FELDER = ["id", "name", "status", "ziel", "start", "ende"]

STANDARD_HERVORHEBUNGEN = [
    "#dc2626 Blocker",
    "#ea580c Kunde wartet",
    "#ca8a04 Wichtig",
    "#0891b2 Zur Info",
    "#db2777 Idee",
]
STANDARD_SPRINT_DAUER = 14

VORLAGEN = {
    "epic": "## Ziel\n\n\n## Umfang\n\n- \n",
    "story": "## Beschreibung\n\nAls … möchte ich …, damit …\n\n## Akzeptanzkriterien\n\n- [ ] \n",
    "aufgabe": "## Beschreibung\n\n\n## Erledigt, wenn\n\n- [ ] \n",
    "bug": "## Schritte zum Nachstellen\n\n1. \n\n## Erwartet\n\n\n## Tatsächlich\n\n\n## Umgebung\n\n",
    "unteraufgabe": "",
}

_ID = re.compile(r"^([A-Z][A-Z0-9]{0,9})-(\d{1,7})$")
_KUERZEL = re.compile(r"^[A-Z][A-Z0-9]{0,9}$")
_SPRINT_ID = re.compile(r"^sprint-(\d{1,5})$")
_FARBE = re.compile(r"^#[0-9a-fA-F]{6}$")
_DATUM = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_UNGUELTIG_IM_ORDNERNAMEN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

PROJEKTDATEI = "projekt.md"


class Fehler(Exception):
    """Fehler, der als Meldung an die Oberfläche geht."""

    def __init__(self, meldung: str, status: int = 400, daten: Any = None) -> None:
        super().__init__(meldung)
        self.meldung = meldung
        self.status = status
        self.daten = daten


def heute() -> str:
    return dt.date.today().isoformat()


def _slug(text: str, laenge: int = 40) -> str:
    ersatz = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "ae", "Ö": "oe", "Ü": "ue"}
    text = "".join(ersatz.get(c, c) for c in text)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    if len(text) > laenge:
        gekuerzt = text[:laenge + 1]
        text = gekuerzt.rsplit("-", 1)[0] if "-" in gekuerzt[laenge // 2:] else text[:laenge]
    return text.rstrip("-") or "eintrag"


def _pruefsumme(daten: bytes) -> str:
    return hashlib.sha1(daten).hexdigest()


def atomar_schreiben(pfad: Path, inhalt: str) -> None:
    """Erst in eine Temp-Datei schreiben, dann ersetzen – nie halbe Dateien."""
    pfad.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".md", dir=pfad.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(inhalt)
        os.replace(tmp, pfad)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _datum_pruefen(wert: Any, feld: str) -> str:
    wert = "" if wert is None else str(wert).strip()
    if wert == "":
        return ""
    if not _DATUM.match(wert):
        raise Fehler(f"{feld}: Datum im Format JJJJ-MM-TT erwartet")
    try:
        dt.date.fromisoformat(wert)
    except ValueError:
        raise Fehler(f"{feld}: „{wert}“ ist kein gültiges Datum") from None
    return wert


def _text_pruefen(wert: Any, feld: str, maximal: int, pflicht: bool = False) -> str:
    wert = "" if wert is None else str(wert).strip()
    if "\n" in wert or "\r" in wert:
        raise Fehler(f"{feld}: darf keinen Zeilenumbruch enthalten")
    if len(wert) > maximal:
        raise Fehler(f"{feld}: höchstens {maximal} Zeichen")
    if pflicht and not wert:
        raise Fehler(f"{feld} darf nicht leer sein")
    return wert


def _int(wert: Any, standard: int | None = None) -> int | None:
    try:
        return int(str(wert).strip())
    except (TypeError, ValueError):
        return standard


def kuerzel_vorschlagen(name: str) -> str:
    woerter = [w for w in re.split(r"[^A-Za-z0-9ÄÖÜäöüß]+", name) if w]
    if len(woerter) >= 2:
        k = "".join(w[0] for w in woerter[:4])
    else:
        k = (woerter[0] if woerter else "TB")[:3]
    k = _slug(k).replace("-", "").upper()
    if not k or not k[0].isalpha():
        k = "T" + k
    return k[:10]


# ---------------------------------------------------------------------------
class Projekt:
    """Ein Projektordner."""

    def __init__(self, pfad: Path, sperre: threading.RLock) -> None:
        self.pfad = pfad
        self._sperre = sperre

    @property
    def id(self) -> str:
        return self.pfad.name

    @property
    def eintraege_ordner(self) -> Path:
        return self.pfad / "eintraege"

    @property
    def sprints_ordner(self) -> Path:
        return self.pfad / "sprints"

    # -- Anlegen ---------------------------------------------------------------
    @classmethod
    def anlegen(cls, pfad: Path, name: str, kuerzel: str, sperre: threading.RLock) -> "Projekt":
        dok = Dokument({
            "name": name,
            "kuerzel": kuerzel,
            "sprint_dauer_tage": STANDARD_SPRINT_DAUER,
            "hervorhebungen": STANDARD_HERVORHEBUNGEN,
            "erstellt": heute(),
        }, f"# {name}\n\nBeschreibung des Projekts.\n")
        atomar_schreiben(pfad / PROJEKTDATEI, dok.als_text())
        (pfad / "eintraege").mkdir(exist_ok=True)
        (pfad / "sprints").mkdir(exist_ok=True)
        return cls(pfad, sperre)

    # -- Lesen -----------------------------------------------------------------
    def _projekt_dok(self) -> Dokument:
        pfad = self.pfad / PROJEKTDATEI
        try:
            return Dokument.lesen(pfad.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise Fehler("projekt.md fehlt", 404) from None
        except FrontmatterFehler as f:
            raise Fehler(f"projekt.md ist nicht lesbar: {f}", 500) from None

    def einstellungen(self) -> dict[str, Any]:
        dok = self._projekt_dok()
        kuerzel = str(dok.get("kuerzel") or "").strip().upper()
        if not _KUERZEL.match(kuerzel):
            kuerzel = kuerzel_vorschlagen(self.pfad.name)
        hervorhebungen = []
        roh = dok.get("hervorhebungen")
        for eintrag in roh if isinstance(roh, list) else STANDARD_HERVORHEBUNGEN:
            teile = str(eintrag).strip().split(" ", 1)
            if _FARBE.match(teile[0]):
                hervorhebungen.append({
                    "farbe": teile[0].lower(),
                    "name": teile[1].strip() if len(teile) > 1 else teile[0],
                })
        return {
            "id": self.id,
            "name": str(dok.get("name") or self.pfad.name),
            "kuerzel": kuerzel,
            "naechste_nummer": _int(dok.get("naechste_nummer"), 1) or 1,
            "sprint_dauer_tage": _int(dok.get("sprint_dauer_tage"), STANDARD_SPRINT_DAUER)
            or STANDARD_SPRINT_DAUER,
            "hervorhebungen": hervorhebungen,
            "text": dok.text,
        }

    def _dateien(self, ordner: Path) -> list[Path]:
        if not ordner.is_dir():
            return []
        return sorted(p for p in ordner.glob("*.md") if not p.name.startswith("."))

    def stand(self) -> str:
        """Kennung, die sich ändert, sobald sich irgendeine Datei ändert."""
        h = hashlib.sha1()
        for pfad in [self.pfad / PROJEKTDATEI, *self._dateien(self.sprints_ordner),
                     *self._dateien(self.eintraege_ordner)]:
            try:
                st = pfad.stat()
            except FileNotFoundError:
                continue
            h.update(f"{pfad.name}|{st.st_mtime_ns}|{st.st_size}\n".encode())
        return h.hexdigest()[:16]

    def _sprints_lesen(self, probleme: list[dict]) -> list[dict]:
        sprints = []
        for pfad in self._dateien(self.sprints_ordner):
            datei = f"sprints/{pfad.name}"
            try:
                dok = Dokument.lesen(pfad.read_text(encoding="utf-8"))
            except (FrontmatterFehler, UnicodeDecodeError) as f:
                probleme.append({"datei": datei, "meldung": str(f)})
                continue
            sid = str(dok.get("id") or pfad.stem)
            if not _SPRINT_ID.match(sid):
                probleme.append({"datei": datei, "meldung": f"Ungültige Sprint-ID „{sid}“ (erwartet sprint-NN)"})
                continue
            status = str(dok.get("status") or "geplant")
            if status not in SPRINT_STATUS:
                probleme.append({"datei": datei, "meldung": f"Unbekannter Sprint-Status „{status}“, behandelt als „geplant“"})
                status = "geplant"
            sprints.append({
                "id": sid,
                "name": str(dok.get("name") or sid),
                "status": status,
                "ziel": str(dok.get("ziel") or ""),
                "start": str(dok.get("start") or ""),
                "ende": str(dok.get("ende") or ""),
                "text": dok.text,
                "datei": datei,
                "_pfad": pfad,
            })
        sprints.sort(key=lambda s: int(_SPRINT_ID.match(s["id"]).group(1)))
        aktive = [s for s in sprints if s["status"] == "aktiv"]
        for s in aktive[1:]:
            probleme.append({"datei": s["datei"], "meldung": "Mehr als ein aktiver Sprint – nur der erste wird auf dem Board gezeigt"})
        return sprints

    def _eintrag_aus_datei(self, pfad: Path, probleme: list[dict]) -> dict | None:
        datei = f"eintraege/{pfad.name}"
        try:
            roh = pfad.read_bytes()
            dok = Dokument.lesen(roh.decode("utf-8"))
        except (FrontmatterFehler, UnicodeDecodeError) as f:
            probleme.append({"datei": datei, "meldung": str(f)})
            return None
        eid = str(dok.get("id") or "")
        if not eid:
            m = re.match(r"^([A-Z][A-Z0-9]{0,9}-\d+)", pfad.stem)
            eid = m.group(1) if m else ""
        if not _ID.match(eid):
            probleme.append({"datei": datei, "meldung": f"Keine gültige ID (erwartet z. B. TB-12), gefunden „{eid}“"})
            return None

        def auswahl(feld: str, erlaubt: list[str], standard: str) -> str:
            wert = str(dok.get(feld) or standard)
            if wert not in erlaubt:
                probleme.append({"datei": datei, "meldung": f"{feld}: unbekannter Wert „{wert}“, behandelt als „{standard}“"})
                return standard
            return wert

        labels = dok.get("labels") or []
        if not isinstance(labels, list):
            labels = [s.strip() for s in str(labels).split(",") if s.strip()]
        farbe = str(dok.get("farbe") or "")
        if farbe and not _FARBE.match(farbe):
            probleme.append({"datei": datei, "meldung": f"farbe: „{farbe}“ ist keine Farbe im Format #rrggbb"})
            farbe = ""
        return {
            "id": eid,
            "typ": auswahl("typ", TYPEN, "aufgabe"),
            "titel": str(dok.get("titel") or pfad.stem),
            "status": auswahl("status", STATUS, "offen"),
            "prioritaet": auswahl("prioritaet", PRIORITAETEN, "mittel"),
            "sprint": str(dok.get("sprint") or ""),
            "epic": str(dok.get("epic") or ""),
            "eltern": str(dok.get("eltern") or ""),
            "version": str(dok.get("version") or ""),
            "faellig": str(dok.get("faellig") or ""),
            "farbe": farbe.lower(),
            "labels": [str(l) for l in labels],
            "rang": _int(dok.get("rang")),
            "erstellt": str(dok.get("erstellt") or ""),
            "aktualisiert": str(dok.get("aktualisiert") or ""),
            "text": dok.text,
            "datei": datei,
            "basis": _pruefsumme(roh),
            "_pfad": pfad,
        }

    def _eintraege_lesen(self, probleme: list[dict]) -> list[dict]:
        eintraege: list[dict] = []
        gesehen: dict[str, str] = {}
        for pfad in self._dateien(self.eintraege_ordner):
            e = self._eintrag_aus_datei(pfad, probleme)
            if e is None:
                continue
            if e["id"] in gesehen:
                probleme.append({"datei": e["datei"], "meldung": f"ID {e['id']} gibt es schon in {gesehen[e['id']]} – Datei wird ignoriert"})
                continue
            gesehen[e["id"]] = e["datei"]
            eintraege.append(e)

        def nummer(e: dict) -> int:
            return int(_ID.match(e["id"]).group(2))

        eintraege.sort(key=lambda e: (e["rang"] if e["rang"] is not None else 10**12, nummer(e)))
        return eintraege

    def laden(self) -> dict[str, Any]:
        with self._sperre:
            probleme: list[dict] = []
            einst = self.einstellungen()
            sprints = self._sprints_lesen(probleme)
            eintraege = self._eintraege_lesen(probleme)
            stand = self.stand()
        return {
            "projekt": einst,
            "sprints": [_ohne_intern(s) for s in sprints],
            "eintraege": [_ohne_intern(e) for e in eintraege],
            "probleme": probleme,
            "stand": stand,
            "typen": TYPEN,
            "status": STATUS,
            "prioritaeten": PRIORITAETEN,
        }

    # -- Hilfen ----------------------------------------------------------------
    def _alle(self) -> tuple[list[dict], list[dict]]:
        probleme: list[dict] = []
        return self._sprints_lesen(probleme), self._eintraege_lesen(probleme)

    def _finden(self, eintraege: list[dict], eid: str) -> dict:
        for e in eintraege:
            if e["id"] == eid:
                return e
        raise Fehler(f"Eintrag {eid} nicht gefunden", 404)

    def _speichern(self, e: dict, aenderungen: dict[str, Any], text: str | None = None) -> bool:
        """Nur die angegebenen Felder in der Datei ändern; Rest bleibt unangetastet."""
        pfad: Path = e["_pfad"]
        dok = Dokument.lesen(pfad.read_text(encoding="utf-8"))
        geaendert = False
        for feld, wert in aenderungen.items():
            geaendert |= dok.setzen(feld, wert)
        if text is not None and text != dok.text:
            dok.text = text
            geaendert = True
        if geaendert:
            dok.setzen("aktualisiert", heute())
            atomar_schreiben(pfad, dok.als_text())
        return geaendert

    def _felder_pruefen(self, felder: dict[str, Any], alt: dict | None,
                        sprints: list[dict], eintraege: list[dict]) -> dict[str, Any]:
        """Eingaben prüfen und vereinheitlichen. Gibt nur übergebene Felder zurück."""
        aus: dict[str, Any] = {}
        unbekannt = set(felder) - set(EINTRAG_FELDER) - {"text"}
        if unbekannt:
            raise Fehler(f"Unbekannte Felder: {', '.join(sorted(unbekannt))}")
        for feld in ("id", "erstellt", "aktualisiert"):
            if feld in felder:
                raise Fehler(f"{feld} kann nicht geändert werden")

        typ = felder.get("typ", alt["typ"] if alt else "aufgabe")
        if typ not in TYPEN:
            raise Fehler(f"Unbekannter Typ „{typ}“")
        if "typ" in felder:
            aus["typ"] = typ
        if "titel" in felder or alt is None:
            aus["titel"] = _text_pruefen(felder.get("titel"), "Titel", 200, pflicht=True)
        if "status" in felder:
            if felder["status"] not in STATUS:
                raise Fehler(f"Unbekannter Status „{felder['status']}“")
            aus["status"] = felder["status"]
        if "prioritaet" in felder:
            if felder["prioritaet"] not in PRIORITAETEN:
                raise Fehler(f"Unbekannte Priorität „{felder['prioritaet']}“")
            aus["prioritaet"] = felder["prioritaet"]
        if "sprint" in felder:
            sid = str(felder["sprint"] or "")
            if sid and sid not in {s["id"] for s in sprints}:
                raise Fehler(f"Sprint {sid} gibt es nicht")
            aus["sprint"] = sid
        if "epic" in felder:
            epic = str(felder["epic"] or "")
            if epic:
                ziel = next((e for e in eintraege if e["id"] == epic), None)
                if ziel is None or ziel["typ"] != "epic":
                    raise Fehler(f"{epic} ist kein Epic")
            aus["epic"] = epic
        if "eltern" in felder:
            eltern = str(felder["eltern"] or "")
            if eltern:
                ziel = next((e for e in eintraege if e["id"] == eltern), None)
                if ziel is None or ziel["typ"] in ("epic", "unteraufgabe"):
                    raise Fehler(f"{eltern} kann keine Unteraufgaben haben")
                if alt and eltern == alt["id"]:
                    raise Fehler("Ein Eintrag kann nicht sein eigenes Elternteil sein")
            aus["eltern"] = eltern
        if "version" in felder:
            aus["version"] = _text_pruefen(felder["version"], "Version", 40)
        if "faellig" in felder:
            aus["faellig"] = _datum_pruefen(felder["faellig"], "Fällig")
        if "farbe" in felder:
            farbe = str(felder["farbe"] or "").strip().lower()
            if farbe and not _FARBE.match(farbe):
                raise Fehler("Farbe im Format #rrggbb erwartet")
            aus["farbe"] = farbe
        if "labels" in felder:
            roh = felder["labels"]
            if isinstance(roh, str):
                roh = roh.split(",")
            if not isinstance(roh, list):
                raise Fehler("Labels als Liste erwartet")
            labels = []
            for l in roh:
                l = _text_pruefen(l, "Label", 30).replace(",", " ").strip()
                if l and l not in labels:
                    labels.append(l)
            aus["labels"] = labels
        if "rang" in felder:
            rang = _int(felder["rang"])
            if rang is None:
                raise Fehler("Rang muss eine ganze Zahl sein")
            aus["rang"] = rang
        if "text" in felder and not isinstance(felder["text"], str):
            raise Fehler("Text als Zeichenkette erwartet")

        # Regeln je Typ
        if alt is not None and typ != alt["typ"]:
            if alt["typ"] == "epic" and any(e["epic"] == alt["id"] for e in eintraege):
                raise Fehler(f"{alt['id']} enthält noch Einträge und bleibt deshalb ein Epic")
            if typ in ("epic", "unteraufgabe") and any(e["eltern"] == alt["id"] for e in eintraege):
                raise Fehler(f"{alt['id']} hat Unteraufgaben und kann kein {typ.capitalize()} werden")
        if typ == "epic":
            if alt is None or "typ" in felder:
                aus["sprint"] = ""
                aus["epic"] = ""
                aus["eltern"] = ""
            for feld in ("sprint", "epic", "eltern"):
                if aus.get(feld):
                    raise Fehler(f"Ein Epic hat kein Feld „{feld}“")
        elif typ != "unteraufgabe":
            if aus.get("eltern"):
                raise Fehler("Nur Unteraufgaben haben ein Elternteil")
            if alt is not None and alt.get("eltern") and "typ" in felder:
                aus["eltern"] = ""
        else:
            eltern = aus.get("eltern", alt["eltern"] if alt else "")
            if not eltern:
                raise Fehler("Eine Unteraufgabe braucht ein Elternteil")
            # Unteraufgaben gehören immer in den Sprint ihres Elternteils
            elt = next((e for e in eintraege if e["id"] == eltern), None)
            if elt is not None:
                aus["sprint"] = elt["sprint"]
                if "epic" not in aus and alt is None:
                    aus["epic"] = elt["epic"]
        return aus

    def _unteraufgaben_nachziehen(self, eintraege: list[dict], eltern_id: str, sprint: str) -> None:
        for kind in eintraege:
            if kind["eltern"] == eltern_id and kind["typ"] == "unteraufgabe" and kind["sprint"] != sprint:
                if kind["status"] != "erledigt" or not sprint:
                    self._speichern(kind, {"sprint": sprint})

    # -- Einträge ändern ---------------------------------------------------------
    def eintrag_anlegen(self, felder: dict[str, Any]) -> dict:
        with self._sperre:
            sprints, eintraege = self._alle()
            werte = self._felder_pruefen(felder, None, sprints, eintraege)
            typ = werte.get("typ", "aufgabe")
            werte["typ"] = typ
            einst = self.einstellungen()
            nummer = self._naechste_nummer(einst, eintraege)
            eid = f"{einst['kuerzel']}-{nummer}"
            sprint = werte.get("sprint", "")
            gleiche = [e["rang"] for e in eintraege
                       if e["sprint"] == sprint and e["rang"] is not None and e["typ"] != "epic"]
            rang = werte.pop("rang", None)
            if rang is None:
                rang = (max(gleiche) if gleiche else 0) + 1000
            daten: dict[str, Any] = {
                "id": eid,
                "typ": typ,
                "titel": werte["titel"],
                "status": werte.get("status", "offen"),
                "prioritaet": werte.get("prioritaet", "mittel"),
                "sprint": sprint,
                "epic": werte.get("epic", ""),
            }
            if typ == "unteraufgabe":
                daten["eltern"] = werte["eltern"]
            daten.update({
                "version": werte.get("version", ""),
                "faellig": werte.get("faellig", ""),
                "farbe": werte.get("farbe", ""),
                "labels": werte.get("labels", []),
                "rang": rang,
                "erstellt": heute(),
                "aktualisiert": heute(),
            })
            text = felder.get("text")
            if text is None:
                text = VORLAGEN.get(typ, "")
            dok = Dokument(daten, text)
            pfad = self.eintraege_ordner / f"{eid}-{_slug(werte['titel'])}.md"
            if pfad.exists():
                raise Fehler(f"Datei {pfad.name} existiert bereits", 409)
            atomar_schreiben(pfad, dok.als_text())
            return self._einzeln(eid)

    def _naechste_nummer(self, einst: dict, eintraege: list[dict]) -> int:
        """Nächste freie Nummer aus den vorhandenen Dateien (auch im Papierkorb).

        Der Zähler wird bewusst nicht in projekt.md gespeichert: Beim Git-Abgleich
        würde sonst jedes parallele Anlegen einen Konflikt in projekt.md erzeugen.
        Ein alter Wert ``naechste_nummer`` wird weiterhin berücksichtigt.
        """
        k = einst["kuerzel"]
        nummern = [int(m.group(2)) for e in eintraege if (m := _ID.match(e["id"])) and m.group(1) == k]
        korb = self.pfad / ".papierkorb"
        if korb.is_dir():
            for f in korb.glob(f"{k}-*.md"):
                m = re.match(rf"^{k}-(\d+)", f.name)
                if m:
                    nummern.append(int(m.group(1)))
        return max([einst["naechste_nummer"], *(n + 1 for n in nummern)])

    def id_neu_vergeben(self, alte_id: str, datei: str, verweise_in: list[str] | None = None) -> str:
        """Eintrag in ``datei`` bekommt eine neue, freie ID (z. B. nach einem Git-Abgleich,
        wenn auf zwei Geräten dieselbe ID vergeben wurde).

        In den Dateien ``verweise_in`` (Pfade relativ zum Projekt) werden Verweise
        ``epic``/``eltern`` auf die alte ID auf die neue umgestellt."""
        with self._sperre:
            pfad = (self.pfad / datei).resolve()
            if pfad.parent != self.eintraege_ordner.resolve() or not pfad.is_file():
                raise Fehler(f"Datei {datei} nicht gefunden", 404)
            _, eintraege = self._alle()
            einst = self.einstellungen()
            probleme: list[dict] = []
            # Die doppelte Datei taucht in _alle() nicht auf – Nummer über alle Dateien bestimmen
            alle = [e for f in self._dateien(self.eintraege_ordner)
                    if (e := self._eintrag_aus_datei(f, probleme)) is not None]
            nummer = self._naechste_nummer(einst, alle)
            neue_id = f"{einst['kuerzel']}-{nummer}"
            dok = Dokument.lesen(pfad.read_text(encoding="utf-8"))
            dok.setzen("id", neue_id)
            rest = pfad.name[len(alte_id):] if pfad.name.startswith(alte_id + "-") else f"-{_slug(str(dok.get('titel') or ''))}.md"
            ziel = pfad.with_name(neue_id + rest)
            atomar_schreiben(ziel, dok.als_text())
            if ziel != pfad:
                pfad.unlink()
            for rel in verweise_in or []:
                vpfad = (self.pfad / rel).resolve()
                if vpfad == ziel or vpfad.parent != self.eintraege_ordner.resolve() or not vpfad.is_file():
                    continue
                try:
                    vdok = Dokument.lesen(vpfad.read_text(encoding="utf-8"))
                except (FrontmatterFehler, UnicodeDecodeError):
                    continue
                geaendert = False
                for feld in ("epic", "eltern"):
                    if str(vdok.get(feld) or "") == alte_id:
                        geaendert |= vdok.setzen(feld, neue_id)
                if geaendert:
                    atomar_schreiben(vpfad, vdok.als_text())
            return neue_id

    def eintrag_aendern(self, eid: str, felder: dict[str, Any], basis: str | None = None) -> dict:
        with self._sperre:
            sprints, eintraege = self._alle()
            alt = self._finden(eintraege, eid)
            if basis and basis != alt["basis"]:
                raise Fehler(
                    f"{eid} wurde inzwischen außerhalb geändert. Neu laden oder trotzdem speichern?",
                    409, _ohne_intern(alt))
            werte = self._felder_pruefen(felder, alt, sprints, eintraege)
            text = felder.get("text")
            self._speichern(alt, werte, text)
            if "sprint" in werte and alt["typ"] not in ("epic", "unteraufgabe"):
                self._unteraufgaben_nachziehen(eintraege, eid, werte["sprint"])
            return self._einzeln(eid)

    def eintrag_loeschen(self, eid: str) -> None:
        """Datei in den Papierkorb verschieben und Verweise darauf entfernen."""
        with self._sperre:
            _, eintraege = self._alle()
            e = self._finden(eintraege, eid)
            kinder = [k for k in eintraege if k["eltern"] == eid]
            if kinder:
                raise Fehler(f"{eid} hat noch Unteraufgaben ({', '.join(k['id'] for k in kinder)})")
            korb = self.pfad / ".papierkorb"
            korb.mkdir(exist_ok=True)
            ziel = korb / e["_pfad"].name
            if ziel.exists():
                ziel = korb / f"{e['_pfad'].stem}-{dt.datetime.now():%Y%m%d-%H%M%S}.md"
            os.replace(e["_pfad"], ziel)
            if e["typ"] == "epic":
                for k in eintraege:
                    if k["epic"] == eid:
                        self._speichern(k, {"epic": ""})

    def reihenfolge(self, sprint: str | None, ids: list[str], status: dict[str, str] | None = None) -> None:
        """Einträge eines Abschnitts (Sprint oder Backlog) neu ordnen.

        ``ids`` ist die vollständige neue Reihenfolge des Abschnitts. Ist ``sprint``
        nicht ``None``, landen alle Einträge in diesem Sprint (bzw. im Backlog bei "").
        ``status`` setzt zusätzlich den Status einzelner Einträge (Board).
        """
        status = status or {}
        with self._sperre:
            sprints, eintraege = self._alle()
            if sprint and sprint not in {s["id"] for s in sprints}:
                raise Fehler(f"Sprint {sprint} gibt es nicht")
            for eid, st in status.items():
                if st not in STATUS:
                    raise Fehler(f"Unbekannter Status „{st}“")
            if len(set(ids)) != len(ids):
                raise Fehler("Doppelte IDs in der Reihenfolge")
            nach_id = {e["id"]: e for e in eintraege}
            for eid in [*ids, *status]:
                if eid not in nach_id:
                    raise Fehler(f"Eintrag {eid} nicht gefunden", 404)
                if nach_id[eid]["typ"] == "epic" and sprint:
                    raise Fehler("Epics gehören in keinen Sprint")
            for i, eid in enumerate(ids):
                e = nach_id[eid]
                aenderung: dict[str, Any] = {"rang": (i + 1) * 1000}
                sprint_neu = e["sprint"]
                if sprint is not None and e["typ"] != "epic":
                    if e["typ"] == "unteraufgabe" and e["eltern"] in nach_id:
                        sprint_neu = nach_id[e["eltern"]]["sprint"]
                    else:
                        sprint_neu = sprint
                    aenderung["sprint"] = sprint_neu
                if eid in status:
                    aenderung["status"] = status[eid]
                self._speichern(e, aenderung)
                if sprint_neu != e["sprint"] and e["typ"] not in ("epic", "unteraufgabe"):
                    self._unteraufgaben_nachziehen(eintraege, eid, sprint_neu)
            for eid, st in status.items():
                if eid not in ids:
                    self._speichern(nach_id[eid], {"status": st})

    def _einzeln(self, eid: str) -> dict:
        _, eintraege = self._alle()
        return _ohne_intern(self._finden(eintraege, eid))

    def _projekt_feld_setzen(self, feld: str, wert: Any) -> None:
        pfad = self.pfad / PROJEKTDATEI
        dok = self._projekt_dok()
        if dok.setzen(feld, wert):
            atomar_schreiben(pfad, dok.als_text())

    def projekt_aendern(self, felder: dict[str, Any]) -> dict:
        with self._sperre:
            erlaubt = {"name", "sprint_dauer_tage", "hervorhebungen"}
            unbekannt = set(felder) - erlaubt
            if unbekannt:
                raise Fehler(f"Nicht änderbar: {', '.join(sorted(unbekannt))}")
            if "name" in felder:
                self._projekt_feld_setzen("name", _text_pruefen(felder["name"], "Name", 80, pflicht=True))
            if "sprint_dauer_tage" in felder:
                tage = _int(felder["sprint_dauer_tage"])
                if tage is None or not 1 <= tage <= 90:
                    raise Fehler("Sprint-Dauer: 1 bis 90 Tage")
                self._projekt_feld_setzen("sprint_dauer_tage", tage)
            if "hervorhebungen" in felder:
                liste = []
                for h in felder["hervorhebungen"]:
                    farbe = str(h.get("farbe", "")).lower()
                    name = _text_pruefen(h.get("name"), "Name der Hervorhebung", 30, pflicht=True)
                    if not _FARBE.match(farbe):
                        raise Fehler("Farbe im Format #rrggbb erwartet")
                    liste.append(f"{farbe} {name}")
                self._projekt_feld_setzen("hervorhebungen", liste)
            return self.einstellungen()

    # -- Sprints ---------------------------------------------------------------
    def _sprint_finden(self, sprints: list[dict], sid: str) -> dict:
        for s in sprints:
            if s["id"] == sid:
                return s
        raise Fehler(f"Sprint {sid} nicht gefunden", 404)

    def _sprint_speichern(self, s: dict, aenderungen: dict[str, Any]) -> None:
        pfad: Path = s["_pfad"]
        dok = Dokument.lesen(pfad.read_text(encoding="utf-8"))
        geaendert = False
        for feld, wert in aenderungen.items():
            geaendert |= dok.setzen(feld, wert)
        if geaendert:
            atomar_schreiben(pfad, dok.als_text())

    def _sprint_felder(self, felder: dict[str, Any]) -> dict[str, Any]:
        aus: dict[str, Any] = {}
        unbekannt = set(felder) - {"name", "ziel", "start", "ende"}
        if unbekannt:
            raise Fehler(f"Unbekannte Felder: {', '.join(sorted(unbekannt))}")
        if "name" in felder:
            aus["name"] = _text_pruefen(felder["name"], "Name", 60, pflicht=True)
        if "ziel" in felder:
            aus["ziel"] = _text_pruefen(felder["ziel"], "Ziel", 300)
        for feld in ("start", "ende"):
            if feld in felder:
                aus[feld] = _datum_pruefen(felder[feld], feld.capitalize())
        if aus.get("start") and aus.get("ende") and aus["ende"] < aus["start"]:
            raise Fehler("Das Ende liegt vor dem Start")
        return aus

    def sprint_anlegen(self, felder: dict[str, Any]) -> dict:
        with self._sperre:
            sprints, _ = self._alle()
            werte = self._sprint_felder(felder)
            nummer = max([0, *(int(_SPRINT_ID.match(s["id"]).group(1)) for s in sprints)]) + 1
            sid = f"sprint-{nummer:02d}"
            dok = Dokument({
                "id": sid,
                "name": werte.get("name") or f"Sprint {nummer}",
                "status": "geplant",
                "ziel": werte.get("ziel", ""),
                "start": werte.get("start", ""),
                "ende": werte.get("ende", ""),
            }, "")
            atomar_schreiben(self.sprints_ordner / f"{sid}.md", dok.als_text())
            return self._sprint_einzeln(sid)

    def sprint_aendern(self, sid: str, felder: dict[str, Any]) -> dict:
        with self._sperre:
            sprints, _ = self._alle()
            s = self._sprint_finden(sprints, sid)
            werte = self._sprint_felder(felder)
            start = werte.get("start", s["start"])
            ende = werte.get("ende", s["ende"])
            if start and ende and ende < start:
                raise Fehler("Das Ende liegt vor dem Start")
            self._sprint_speichern(s, werte)
            return self._sprint_einzeln(sid)

    def sprint_starten(self, sid: str, felder: dict[str, Any]) -> dict:
        with self._sperre:
            sprints, _ = self._alle()
            s = self._sprint_finden(sprints, sid)
            if s["status"] != "geplant":
                raise Fehler(f"{s['name']} ist nicht geplant, sondern {s['status']}")
            aktiv = [x for x in sprints if x["status"] == "aktiv"]
            if aktiv:
                raise Fehler(f"{aktiv[0]['name']} läuft noch – erst abschließen", 409)
            werte = self._sprint_felder(felder)
            start = werte.get("start") or s["start"] or heute()
            ende = werte.get("ende") or s["ende"]
            if not ende:
                tage = self.einstellungen()["sprint_dauer_tage"]
                ende = (dt.date.fromisoformat(start) + dt.timedelta(days=tage)).isoformat()
            if ende < start:
                raise Fehler("Das Ende liegt vor dem Start")
            werte.update({"status": "aktiv", "start": start, "ende": ende})
            self._sprint_speichern(s, werte)
            return self._sprint_einzeln(sid)

    def sprint_abschliessen(self, sid: str, ziel: str = "") -> dict:
        """Sprint beenden; Unerledigtes wandert ins Backlog oder in Sprint ``ziel``."""
        with self._sperre:
            sprints, eintraege = self._alle()
            s = self._sprint_finden(sprints, sid)
            if s["status"] != "aktiv":
                raise Fehler(f"{s['name']} ist nicht aktiv")
            if ziel:
                z = self._sprint_finden(sprints, ziel)
                if z["status"] != "geplant":
                    raise Fehler(f"{z['name']} ist kein geplanter Sprint")
            offen = [e for e in eintraege if e["sprint"] == sid and e["status"] != "erledigt"]
            im_ziel = [e["rang"] for e in eintraege if e["sprint"] == ziel and e["rang"] is not None
                       and e["typ"] != "epic"]
            kleinster = min(im_ziel) if im_ziel else 1000
            for i, e in enumerate(offen):
                self._speichern(e, {"sprint": ziel, "rang": kleinster - (len(offen) - i) * 10})
            self._sprint_speichern(s, {"status": "abgeschlossen", "ende": s["ende"] or heute()})
            return {"sprint": self._sprint_einzeln(sid), "verschoben": [e["id"] for e in offen]}

    def sprint_loeschen(self, sid: str) -> None:
        with self._sperre:
            sprints, eintraege = self._alle()
            s = self._sprint_finden(sprints, sid)
            if s["status"] != "geplant":
                raise Fehler("Nur geplante Sprints können gelöscht werden")
            for e in eintraege:
                if e["sprint"] == sid:
                    self._speichern(e, {"sprint": ""})
            korb = self.pfad / ".papierkorb"
            korb.mkdir(exist_ok=True)
            os.replace(s["_pfad"], korb / f"{sid}-{dt.datetime.now():%Y%m%d-%H%M%S}.md")

    def _sprint_einzeln(self, sid: str) -> dict:
        sprints, _ = self._alle()
        return _ohne_intern(self._sprint_finden(sprints, sid))


def _ohne_intern(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}


# ---------------------------------------------------------------------------
class Arbeitsbereich:
    """Ordner mit Projekten – oder selbst ein einzelnes Projekt."""

    def __init__(self, pfad: Path) -> None:
        self.pfad = pfad.expanduser().resolve()
        self._sperre = threading.RLock()

    @property
    def einzelprojekt(self) -> bool:
        return (self.pfad / PROJEKTDATEI).is_file()

    def projekte(self) -> list[Projekt]:
        if self.einzelprojekt:
            return [Projekt(self.pfad, self._sperre)]
        if not self.pfad.is_dir():
            return []
        return [Projekt(p, self._sperre) for p in sorted(self.pfad.iterdir(), key=lambda p: p.name.lower())
                if p.is_dir() and not p.name.startswith(".") and (p / PROJEKTDATEI).is_file()]

    def projekt(self, pid: str) -> Projekt:
        for p in self.projekte():
            if p.id == pid:
                return p
        raise Fehler(f"Projekt „{pid}“ nicht gefunden", 404)

    def uebersicht(self) -> list[dict]:
        liste = []
        for p in self.projekte():
            try:
                e = p.einstellungen()
                liste.append({"id": p.id, "name": e["name"], "kuerzel": e["kuerzel"]})
            except Fehler as f:
                liste.append({"id": p.id, "name": p.id, "kuerzel": "", "fehler": f.meldung})
        return liste

    def projekt_anlegen(self, name: str, kuerzel: str = "") -> dict:
        if self.einzelprojekt:
            raise Fehler("Hier ist ein einzelnes Projekt geöffnet. Starte die App mit einem "
                         "Arbeitsbereich-Ordner, um weitere Projekte anzulegen.")
        name = _text_pruefen(name, "Name", 80, pflicht=True)
        ordner = _UNGUELTIG_IM_ORDNERNAMEN.sub(" ", name).strip().strip(".")
        ordner = re.sub(r"\s+", " ", ordner)
        if not ordner:
            raise Fehler("Aus diesem Namen lässt sich kein Ordnername bilden")
        kuerzel = (kuerzel or kuerzel_vorschlagen(name)).strip().upper()
        if not _KUERZEL.match(kuerzel):
            raise Fehler("Kürzel: 1–10 Großbuchstaben/Ziffern, beginnend mit einem Buchstaben (z. B. TB)")
        with self._sperre:
            self.pfad.mkdir(parents=True, exist_ok=True)
            pfad = self.pfad / ordner
            if pfad.exists():
                raise Fehler(f"Der Ordner „{ordner}“ existiert bereits", 409)
            pfad.mkdir()
            p = Projekt.anlegen(pfad, name, kuerzel, self._sperre)
            return {"id": p.id, "name": name, "kuerzel": kuerzel}
