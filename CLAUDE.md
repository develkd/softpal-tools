# Arbeitsregeln für dieses Repository

## Git-Workflow (verbindlich)

- **Jede Änderung** bekommt einen **eigenen Branch, der von `develop` abgezweigt wird**
  (`git fetch origin develop && git checkout -b <typ>/<kurzbeschreibung> origin/develop`,
  z. B. `feature/…`, `fix/…`, `chore/…`).
- **Jeder Merge Request / Pull Request geht gegen `develop`** – nie gegen einen anderen Branch.
- **Nie direkt auf `develop` pushen** und `develop` **nie löschen**. `develop` ist auf GitHub
  per Branch-Schutz gegen direktes Pushen und Löschen gesperrt; Änderungen landen nur über
  einen Pull Request dort.
