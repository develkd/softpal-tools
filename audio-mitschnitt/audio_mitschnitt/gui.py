"""Fensteroberfläche (Tkinter) für den Audio-Mitschnitt."""

from __future__ import annotations

import os
import subprocess
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Optional

from .cli import groesse_text, zeit_text
from .einstellungen import Einstellungen
from .encoder import ERLAUBTE_BITRATEN
from .recorder import Recorder

# softpal-Farben (wie in der Termin-Scanner-App)
ROT = "#c62828"
GRUEN = "#2e7d32"
GRAU = "#616161"

PEGEL_MIN_DB = -60.0


def ordner_oeffnen(pfad: Path) -> None:
    pfad = Path(pfad)
    try:
        if sys.platform == "win32":
            os.startfile(pfad)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(pfad)])
        else:
            subprocess.Popen(["xdg-open", str(pfad)])
    except OSError as fehler:
        messagebox.showerror("Ordner öffnen", str(fehler))


def datei_im_explorer_zeigen(datei: Path) -> None:
    if sys.platform == "win32" and datei.exists():
        subprocess.Popen(["explorer", "/select,", str(datei)])
    else:
        ordner_oeffnen(datei.parent)


class App:
    def __init__(self, wurzel: tk.Tk, quelle) -> None:
        self.wurzel = wurzel
        self.quelle = quelle
        self.einst = Einstellungen.laden()
        self.recorder: Optional[Recorder] = None
        self.letzte_datei: Optional[Path] = None

        wurzel.title("Audio-Mitschnitt")
        wurzel.minsize(460, 0)
        wurzel.protocol("WM_DELETE_WINDOW", self._schliessen)

        stil = ttk.Style(wurzel)
        if "vista" in stil.theme_names():
            stil.theme_use("vista")
        elif "clam" in stil.theme_names():
            stil.theme_use("clam")
        stil.configure("Zeit.TLabel", font=("Segoe UI", 28, "bold"))
        stil.configure("Gross.TButton", font=("Segoe UI", 11, "bold"), padding=8)
        stil.configure("Pegel.Horizontal.TProgressbar", troughcolor="#e0e0e0",
                       background=GRUEN)

        rahmen = ttk.Frame(wurzel, padding=16)
        rahmen.grid(sticky="nsew")
        wurzel.columnconfigure(0, weight=1)
        rahmen.columnconfigure(1, weight=1)

        # --- Quelle -----------------------------------------------------
        ttk.Label(rahmen, text="Soundausgabe:").grid(row=0, column=0, sticky="w")
        self.geraet_var = tk.StringVar(value="…")
        ttk.Label(rahmen, textvariable=self.geraet_var, font=("Segoe UI", 10, "bold"),
                  wraplength=330).grid(row=0, column=1, columnspan=2, sticky="w", padx=(8, 0))

        # --- Anzeige ----------------------------------------------------
        anzeige = ttk.Frame(rahmen)
        anzeige.grid(row=1, column=0, columnspan=3, sticky="ew", pady=(14, 4))
        anzeige.columnconfigure(1, weight=1)
        self.punkt = tk.Label(anzeige, text="●", fg=GRAU, font=("Segoe UI", 22))
        self.punkt.grid(row=0, column=0, padx=(0, 8))
        self.zeit_var = tk.StringVar(value="00:00:00")
        ttk.Label(anzeige, textvariable=self.zeit_var, style="Zeit.TLabel").grid(
            row=0, column=1, sticky="w")
        self.groesse_var = tk.StringVar(value="")
        ttk.Label(anzeige, textvariable=self.groesse_var, foreground=GRAU).grid(
            row=0, column=2, sticky="e")

        self.pegel = ttk.Progressbar(rahmen, style="Pegel.Horizontal.TProgressbar",
                                     maximum=100, mode="determinate")
        self.pegel.grid(row=2, column=0, columnspan=3, sticky="ew", pady=(0, 12))

        # --- Knöpfe -----------------------------------------------------
        knoepfe = ttk.Frame(rahmen)
        knoepfe.grid(row=3, column=0, columnspan=3, sticky="ew")
        knoepfe.columnconfigure(0, weight=1)
        knoepfe.columnconfigure(1, weight=1)
        self.start_knopf = ttk.Button(knoepfe, text="●  Aufnahme starten",
                                      style="Gross.TButton", command=self._start_stopp)
        self.start_knopf.grid(row=0, column=0, sticky="ew", padx=(0, 4))
        self.pause_knopf = ttk.Button(knoepfe, text="❚❚  Pause", style="Gross.TButton",
                                      command=self._pause, state="disabled")
        self.pause_knopf.grid(row=0, column=1, sticky="ew", padx=(4, 0))

        # --- Einstellungen ----------------------------------------------
        box = ttk.LabelFrame(rahmen, text="Einstellungen", padding=10)
        box.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(16, 0))
        box.columnconfigure(1, weight=1)

        ttk.Label(box, text="Zielordner:").grid(row=0, column=0, sticky="w")
        self.ordner_var = tk.StringVar(value=self.einst.zielordner)
        self.ordner_feld = ttk.Entry(box, textvariable=self.ordner_var)
        self.ordner_feld.grid(row=0, column=1, sticky="ew", padx=6)
        self.ordner_knopf = ttk.Button(box, text="Ändern…", command=self._ordner_waehlen)
        self.ordner_knopf.grid(row=0, column=2)

        ttk.Label(box, text="Qualität:").grid(row=1, column=0, sticky="w", pady=(8, 0))
        self.bitrate_var = tk.StringVar(value=f"{self.einst.bitrate} kbit/s")
        self.bitrate_box = ttk.Combobox(
            box, textvariable=self.bitrate_var, state="readonly", width=12,
            values=[f"{b} kbit/s" for b in ERLAUBTE_BITRATEN])
        self.bitrate_box.grid(row=1, column=1, sticky="w", padx=6, pady=(8, 0))

        self.folgen_var = tk.BooleanVar(value=self.einst.ausgabe_folgen)
        ttk.Checkbutton(
            box, variable=self.folgen_var,
            text="Bei Wechsel der Standardausgabe automatisch mitwechseln",
        ).grid(row=2, column=0, columnspan=3, sticky="w", pady=(8, 0))

        # --- Ergebnis ---------------------------------------------------
        unten = ttk.Frame(rahmen)
        unten.grid(row=5, column=0, columnspan=3, sticky="ew", pady=(12, 0))
        unten.columnconfigure(0, weight=1)
        self.info_var = tk.StringVar(value="Bereit.")
        ttk.Label(unten, textvariable=self.info_var, foreground=GRAU,
                  wraplength=330, justify="left").grid(row=0, column=0, sticky="w")
        ttk.Button(unten, text="Ordner öffnen", command=self._ordner_oeffnen).grid(
            row=0, column=1, sticky="e")

        wurzel.bind("<space>", lambda _e: self._start_stopp())
        self._geraet_anzeigen()
        self._aktualisieren()

    # ------------------------------------------------------------ Aktionen
    def _bitrate(self) -> int:
        return int(self.bitrate_var.get().split()[0])

    def _einstellungen_sichern(self) -> None:
        self.einst.zielordner = self.ordner_var.get().strip() or self.einst.zielordner
        self.einst.bitrate = self._bitrate()
        self.einst.ausgabe_folgen = bool(self.folgen_var.get())
        self.einst.speichern()

    def _geraet_anzeigen(self) -> None:
        try:
            self.geraet_var.set(self.quelle.standardausgabe().name)
        except Exception as fehler:  # noqa: BLE001
            self.geraet_var.set(f"nicht verfügbar ({fehler})")

    def _ordner_waehlen(self) -> None:
        gewaehlt = filedialog.askdirectory(initialdir=self.ordner_var.get() or None,
                                           title="Zielordner für Mitschnitte")
        if gewaehlt:
            self.ordner_var.set(str(Path(gewaehlt)))
            self._einstellungen_sichern()

    def _ordner_oeffnen(self) -> None:
        if self.letzte_datei:
            datei_im_explorer_zeigen(self.letzte_datei)
            return
        ordner = Path(self.ordner_var.get())
        ordner.mkdir(parents=True, exist_ok=True)
        ordner_oeffnen(ordner)

    def _start_stopp(self) -> None:
        if self.recorder and self.recorder.laeuft:
            self._stoppen()
        else:
            self._starten()

    def _starten(self) -> None:
        self._einstellungen_sichern()
        self.recorder = Recorder(self.quelle, ordner=Path(self.einst.zielordner),
                                 bitrate=self.einst.bitrate,
                                 ausgabe_folgen=self.einst.ausgabe_folgen)
        try:
            self.letzte_datei = self.recorder.starten()
        except OSError as fehler:
            messagebox.showerror("Aufnahme", f"Zielordner nicht beschreibbar:\n{fehler}")
            self.recorder = None
            return
        self._bedienung_sperren(True)
        self.info_var.set(f"Nimmt auf in: {self.letzte_datei.name}")

    def _stoppen(self) -> None:
        if not self.recorder:
            return
        self.start_knopf.configure(state="disabled")
        self.wurzel.update_idletasks()
        self.recorder.stoppen()
        self._fertig()

    def _fertig(self) -> None:
        st = self.recorder.status() if self.recorder else None
        self._bedienung_sperren(False)
        self.punkt.configure(fg=GRAU)
        self.pegel["value"] = 0
        if st is None:
            return
        self.zeit_var.set(zeit_text(st.sekunden))
        self.groesse_var.set(groesse_text(st.bytes) if st.bytes else "")
        if st.fehler:
            self.info_var.set(f"Fehler: {st.fehler}")
            messagebox.showerror("Aufnahme", f"Die Aufnahme wurde beendet:\n{st.fehler}")
        if st.pfad and st.pfad.exists() and st.bytes > 0:
            self.info_var.set(
                f"Gespeichert: {st.pfad.name}  ({zeit_text(st.sekunden)}, "
                f"{groesse_text(st.bytes)})")
        else:
            self.letzte_datei = None  # leere Datei hat der Recorder entfernt
        self.recorder = None

    def _pause(self) -> None:
        if not self.recorder:
            return
        if self.recorder.status().pausiert:
            self.recorder.fortsetzen()
            self.pause_knopf.configure(text="❚❚  Pause")
        else:
            self.recorder.pausieren()
            self.pause_knopf.configure(text="▶  Fortsetzen")

    def _bedienung_sperren(self, aufnahme: bool) -> None:
        zustand = "disabled" if aufnahme else "normal"
        for w in (self.ordner_feld, self.ordner_knopf):
            w.configure(state=zustand)
        self.bitrate_box.configure(state="disabled" if aufnahme else "readonly")
        self.start_knopf.configure(
            state="normal",
            text="■  Aufnahme beenden" if aufnahme else "●  Aufnahme starten")
        self.pause_knopf.configure(state="normal" if aufnahme else "disabled",
                                   text="❚❚  Pause")

    # ------------------------------------------------------------ Anzeige
    def _aktualisieren(self) -> None:
        r = self.recorder
        if r is not None:
            st = r.status()
            if not st.laeuft:
                self._fertig()
            else:
                if st.geraet:
                    self.geraet_var.set(st.geraet)
                self.zeit_var.set(zeit_text(st.sekunden))
                self.groesse_var.set(groesse_text(st.bytes))
                if st.pausiert:
                    self.punkt.configure(fg=GRAU if self.punkt.cget("fg") == ROT else ROT)
                else:
                    self.punkt.configure(fg=ROT)
                db = st.pegel_db
                wert = 0 if db == float("-inf") else max(0.0, (db - PEGEL_MIN_DB) / -PEGEL_MIN_DB * 100)
                self.pegel["value"] = wert
                for meldung in st.meldungen:
                    self.info_var.set(meldung)
        else:
            # Ohne Aufnahme gelegentlich die eingestellte Ausgabe auffrischen
            self._leerlauf = getattr(self, "_leerlauf", 0) + 1
            if self._leerlauf % 20 == 0:
                self._geraet_anzeigen()
        self.wurzel.after(100 if r else 250, self._aktualisieren)

    def _schliessen(self) -> None:
        if self.recorder and self.recorder.laeuft:
            if not messagebox.askyesno(
                    "Audio-Mitschnitt",
                    "Die Aufnahme läuft noch.\nBeenden und Datei speichern?"):
                return
            self.recorder.stoppen()
        self._einstellungen_sichern()
        self.wurzel.destroy()


def starten() -> int:
    from .quelle import SoundcardQuelle

    wurzel = tk.Tk()
    try:
        quelle = SoundcardQuelle()
    except Exception as fehler:  # noqa: BLE001
        wurzel.withdraw()
        messagebox.showerror("Audio-Mitschnitt",
                             f"Das Audio-System ist nicht verfügbar:\n{fehler}")
        return 2
    App(wurzel, quelle)
    wurzel.mainloop()
    return 0
