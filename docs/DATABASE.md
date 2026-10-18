# Datenbank: SQLite oder PostgreSQL

**Beide Datenbanksysteme sind kostenlos und quelloffen.** SQLite ist eingebettet (eine lokale Datei, kein eigener Server), PostgreSQL ist ein eigenständiger Server und eignet sich besser für mehrere gleichzeitig schreibende Prozesse und wachsende Abfragen. Hosting kann bei beiden Varianten Kosten verursachen.

## SQLite (Standard)
1. `.env.example` nach `.env` kopieren (optional, Standardwerte funktionieren auch ohne `.env`).
2. `DB_CLIENT=sqlite`
3. `SQLITE_FILE=./data/lacedaemon.sqlite`
4. `npm install`, `npm run dev`

Tabellen werden beim Start für einen neuen Datenbestand automatisch angelegt. Die `.sqlite`-Datei und die WAL/SHM-Dateien sind in `.gitignore` eingetragen.

## PostgreSQL (optional)
1. PostgreSQL lokal oder auf eurem Linux-Server bereitstellen.
2. Datenbank `lacedaemon` und einen dafür vorgesehenen Datenbankbenutzer anlegen.
3. `.env` setzen:

```
DB_CLIENT=postgres
DATABASE_URL=postgresql://BENUTZER:PASSWORT@localhost:5432/lacedaemon
```

4. `npm run dev` starten.

Das Projekt hat für beide Datenbanksysteme eigene `CREATE TABLE IF NOT EXISTS`-Skripte. Dies ersetzt **kein echtes Migrations-Management** bei späteren Schemaänderungen. Die Daten werden beim Wechsel **nicht automatisch übertragen**.

## Tabellen
- `catalog_items` – Anime-/Spieletitel, eindeutig je Kategorie.
- `reviews` – Demo-Bewertungen per Anzeigename; später auf echte Discord-Mitglieder umstellen.
- `economy_balances` – aktuell **Beispieldaten** für Drachen.

## Wichtiger Hinweis
Ein gemeinsamer Linux-Server kann SQLite zu Beginn gut nutzen, solange **ein Backend-Prozess** die DB-Datei bearbeitet. Wenn ihr das Projekt auf mehrere Backend-Instanzen verteilt oder hohe Schreiblast erreicht, ist PostgreSQL die robustere Wahl. SQLite-Dateien niemals ohne passende Sicherung direkt als Synchronisationsformat zwischen Rechnern austauschen.
