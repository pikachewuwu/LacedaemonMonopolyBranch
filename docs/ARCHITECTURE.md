# Architekturentscheidungen

## Bewusst ohne React
- **Frontend:** statisches HTML unter `public/`, CSS unter `public/assets/css/` und native ES-Module unter `public/assets/js/`.
- **Gemeinsame Navigation:** `public/partials/navbar.html` wird über `layout.js` in jede Seite geladen (DRY, ohne React oder Template Engine).
- **Backend:** `src/app.js` verbindet Middleware, statische Dateien und API-Routen; `src/server.js` startet den Prozess.
- **Featuremodule:** API-Route -> Service (Geschäftslogik/Validierung) -> Repository (SQL).
- **Persistenz:** `src/db/` kapselt die Unterschiede zwischen SQLite und PostgreSQL. SQL-Migrationen liegen getrennt vor.

## Erweiterung: Discord-Login
1. `src/modules/auth/` für Discord-OAuth2-Routen und Session-Handling anlegen.
2. `members`-Tabelle mit eindeutiger `discord_user_id` ergänzen.
3. `reviews.member_key` durch FK auf `members.id` ergänzen; **nicht** auf frei eingetippte Namen vertrauen.
4. Schreibende API-Routen durch Authentifizierung, CSRF-Schutz (bei Cookie-Sessions) und Autorisierungsregeln schützen.

## Erweiterung: Monopoly
Ein neues Modul `src/modules/monopoly/` planen:
- `engine/`: reine Spiellogik (Regeln ohne DOM/Express)
- `lobbies/`: Lobbyverwaltung
- `realtime/`: WebSocket oder Socket.IO, Server autoritativ
- `maps/`: konfigurierbare Spielbretter als validierte Datenobjekte
Frontend unter `public/pages/monopoly.html` und `public/assets/js/pages/monopoly.js`.

## Aktuelle Grenzen
- Anime/Spiele: persistente Titellisten und Bewertungen, **noch keine Authentifizierung**.
- Drachen: beispielhafte Datenbankeinträge, **keine Discord-Anbindung**.
- Fantasy League: **nur Layout und Konzept**, kein funktionierendes Spiel.
- Kein Rollen-/Rechtesystem, keine Produktionshärtung für öffentliche Schreibzugriffe.
