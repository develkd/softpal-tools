# AGENTS.md — softpal-tools

Sammlung kleiner, eigenständiger Werkzeuge; jedes Tool hat einen eigenen Ordner mit README.

## Git-Regeln

- **Niemals direkt auf `develop` pushen.** `develop` erhält Änderungen ausschließlich über gemergte Pull Requests – auch beim ersten Commit eines neuen Repositorys, bei kleinen Korrekturen und nie per Force-Push.
- Jede Änderung entsteht auf einem eigenen Branch, der vom aktuellen `origin/develop` abzweigt, und geht per Pull Request gegen `develop`.
- Pull Requests folgen der Vorlage `.github/pull_request_template.md`.
