# Architekturentscheidungen

## Bewusst ohne React
- **Frontend:** statisches HTML unter `public/`, CSS unter `public/assets/css/` und native ES-Module unter `public/assets/js/`.
- **Gemeinsame Navigation:** `public/partials/navbar.html` wird über `layout.js` in jede Seite geladen (DRY, ohne React oder Template Engine).
- **Backend:** `src/app.js` verbindet Middleware, statische Dateien und API-Routen; `src/server.js` startet den Prozess.
- **Featuremodule:** API-Route -> Service (Geschäftslogik/Validierung) -> Repository (SQL).
- **Persistenz:** `src/db/` kapselt die Unterschiede zwischen SQLite und PostgreSQL. SQL-Migrationen liegen getrennt vor.

## Discord-Login
`src/modules/auth/`: OAuth2-Routen (`/api/auth/discord`, Callback, `/api/auth/me`, Logout), Tabelle `members` mit eindeutiger `discord_user_id`, Tabelle `sessions` (nur Token-Hash). Offen:
1. `reviews.member_key` durch FK auf `members.id` ersetzen; **nicht** auf frei eingetippte Namen vertrauen.
2. Die übrigen schreibenden API-Routen durch Authentifizierung und Autorisierungsregeln schützen.

## Monopoly
Modul `src/modules/monopoly/`, wie geplant aufgebaut:
- `engine/`: reine Spiellogik (Regeln ohne DOM/Express), getestet in `tests/monopoly.engine.test.js`
- `lobbies/`: Räume, Host, Bots, Zuguhr
- `realtime/`: Socket.IO, Server autoritativ
- `maps/`: konfigurierbare Spielbretter als validierte JSON-Vorlagen
Frontend unter `public/pages/monopoly.html`, `public/assets/js/monopoly/` und `public/assets/monopoly/themes/`. Details in [MONOPOLY.md](MONOPOLY.md).

## Aktuelle Grenzen
- Anime/Spiele: persistente Titellisten und Bewertungen, **noch keine Authentifizierung**.
- Drachen: beispielhafte Datenbankeinträge, **keine Discord-Anbindung**.
- Fantasy League: **nur Layout und Konzept**, kein funktionierendes Spiel.
- Kein Rollen-/Rechtesystem, keine Produktionshärtung für öffentliche Schreibzugriffe.
- Monopoly-Räume liegen im Speicher eines Prozesses; ein Neustart beendet laufende Partien.
