# Lacedaemon – modulares Community-Portal

Vanilla HTML, CSS und JavaScript im Frontend. Node.js + Express im Backend. SQLite standardmäßig, PostgreSQL optional. **Keine React- oder Docker-Pflicht.**

## Schnellstart (Windows 11 / VS Code)

Voraussetzung: **Node.js LTS**, empfohlen >= 22.12.0.

1. ZIP entpacken, in VS Code den inneren Ordner **`lacedaemon`** öffnen (dort liegt `package.json`).
2. VS-Code-Terminal (PowerShell) öffnen.
3. Abhängigkeiten installieren:

   ```powershell
   npm.cmd install
   ```

4. Optional: `.env.example` als `.env` kopieren. Ohne `.env` verwendet das Projekt Port 3000 und SQLite.
5. Entwicklungsserver starten:

   ```powershell
   npm.cmd run dev
   ```

6. Im Browser **http://localhost:3000** öffnen.

> Falls PowerShell `npm.ps1` blockiert, verwende wie oben `npm.cmd`. PostgreSQL und Docker müssen nicht installiert sein.

## Was funktioniert bereits?

- Mehrseitiges Dark-Mode-Dashboard mit **gemeinsamer Navigation** aus einer Partial-Datei.
- **Anime-Liste und Spiele-Liste**: Titel mit Namen, Status und Bewertungen (1–10) erfassen; Daten bleiben in der SQLite-Datei bestehen.
- Mehrere Mitglieder können denselben Titel bewerten; Durchschnitt wird berechnet. Derselbe Anzeigename kann seine Bewertung aktualisieren.
- Drachen-Leaderboard liest Einträge aus der Datenbank. Aktuell sind dies **explizit gekennzeichnete Beispieldaten**.
- API-Endpunkt `/api/health`, strukturierte API-Routen und grundlegende Eingabevalidierung.
- Fantasy-League-Seite als Platzhalter für spätere Implementierung.

**Noch NICHT enthalten:** Discord OAuth2, sichere Mitgliederidentitäten, reale Discord-Economy-Synchronisation, Fantasy-Berechnung, Monopoly-Multiplayer. Das Projekt ist ein **Starter mit einigen echten Funktionen**, keine fertige Community-Plattform.

## Projektstruktur

```text
lacedaemon/
├── public/                         # Frontend, direkt vom Browser abrufbar
│   ├── index.html                  # Dashboard
│   ├── pages/
│   │   
│   ├── partials/
│   │   └── navbar.html             # Eine Navigation für alle Seiten
│   └── assets/
│       ├── css/
│       │   ├── base.css
│       │   ├── components.css
│       │   └── pages/...
│       └── js/
│           ├── core/               # API-Client, Navigation, DOM-Helfer
│           ├── components/         # Wiederverwendbare UI-Funktionen
│           └── pages/              # JavaScript pro Seite
├── src/                            # Backend (NICHT öffentlich)
│   ├── config/env.js
│   ├── db/
│   │   ├── index.js
│   │   ├── sqlite.js
│   │   ├── postgres.js
│   │   ├── seed.js
│   │   └── migrations/            # SQL für beide DB-Systeme
│   ├── modules/
│   │   ├── catalog/                # Anime + Spiele: Route, Service, Repository
│   │   ├── leaderboard/            # Drachen
│   │   └── overview/               # Dashboard-Zahlen
│   ├── middleware/
│   ├── app.js
│   └── server.js
├── tests/
├── docs/
├── scripts/
├── .env.example
├── .gitignore
└── package.json
```

## API

| Methode | Route | Funktion |
|---|---|---|
| GET | `/api/health` | Serverstatus |
| GET | `/api/overview` | Dashboard-Statistik |
| GET | `/api/catalog/anime` | Anime mit Bewertungen |
| GET | `/api/catalog/games` | Spiele mit Bewertungen |
| POST | `/api/catalog/anime/reviews` | Anime-Bewertung hinzufügen/aktualisieren |
| POST | `/api/catalog/games/reviews` | Spiele-Bewertung hinzufügen/aktualisieren |
| GET | `/api/leaderboard` | Drachenwerte (vorerst Demo) |

POST-Beispiel (JSON):

```json
{
  "title": "Naruto",
  "memberName": "Alex",
  "score": 9,
  "status": "completed"
}
```

## Tests

```powershell
npm.cmd test
npm.cmd run check
```

Die SQLite-Integrationstests benötigen `npm install`. Die Modulsyntax kann darüber hinaus mit Node geprüft werden.

## Git und Zusammenarbeit

- **Ins Git:** `public/`, `src/`, `docs/`, `tests/`, `scripts/`, `package.json`, `package-lock.json` (wird beim ersten `npm install` erzeugt), `.env.example`, `.gitignore`.
- **Nicht ins Git:** `node_modules/`, `.env`, `data/*.sqlite`, Logs.
- Für euer Dreierteam: eigene Feature-Branches, Pull Requests und kurze Code-Reviews.
- Initiales Repository auf GitHub idealerweise **leer erstellen**, wenn ihr das lokale Projekt pushen wollt (kein zusätzlich generiertes README nötig).

## Später erweitern

- Authentifizierung mit Discord OAuth2 und serverseitiger Session.
- PostgreSQL als DB-Alternative: siehe [docs/DATABASE.md](docs/DATABASE.md).
- Eigenes Monopoly-Modul mit Game Engine und Map-Editor: siehe [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Sicherheit

In dieser frühen Entwicklungsfassung sind Schreibendpunkte noch nicht durch Login geschützt; **nicht unverändert öffentlich ins Internet stellen**. Vor Deployment gehören Authentifizierung, Autorisierung, Rate-Limits, HTTPS, sichere Session-Cookies und regelmäßige Backups dazu.
