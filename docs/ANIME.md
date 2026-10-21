# Anime mit MyAnimeList-Metadaten

Die Anime-Seite nutzt dieselbe Karten- und Menügestaltung wie die Spiele-Seite.
„Anime hinzufügen“ öffnet eine Maske mit Suche und Pagination. Titel, Poster,
Beschreibung, Genre, Format, Gesamtzahl der Episoden und MAL-Score kommen
serverseitig von MyAnimeList über die öffentliche, inoffizielle
[Tenrai-API v1](https://api.tenrai.org/documentation). Ein zusätzlicher API-Schlüssel ist nicht erforderlich.

Der frühere öffentliche Jikan-Dienst wurde zum 1. Oktober 2026 eingestellt.
Tenrai wird vom [Jikan-Betreiber als Alternative genannt](https://github.com/jikan-me/jikan-rest/issues/613)
und verwendet für die benötigten Daten dasselbe Format sowie dieselben MyAnimeList-IDs.

## Persönliche Einträge

- **Watching:** Anzahl gesehener Episoden, einschließlich 0; keine Bewertung.
- **Plan to watch:** weder Episodenzahl noch Bewertung.
- **Completed:** alle bekannten Episoden; optional eine Bewertung von 1–10.
  Ist die Gesamtzahl unbekannt, wird die gesehene Anzahl manuell eingegeben.

Bekannte Gesamtzahlen werden auch im Backend geprüft. Clientdaten können weder
Titel und Gesamtzahl noch Discord-Identität oder Ersteller überschreiben. Pro
Anime und Mitglied gibt es einen Eintrag. Änderungen erfolgen direkt in der Karte.

Beim Hinzufügen lassen sich andere registrierte Discord-Mitglieder auswählen.
Sie erhalten einen eigenen Plan-to-watch-Eintrag ohne Bewertung oder Fortschritt.
Vorhandene Einträge werden nicht überschrieben. Eigene Fortschritte werden weiterhin
nur mit der jeweiligen Sitzung geändert. Die Avatare zeigen beim Hovern den Anzeigenamen.

Nur der Ersteller kann den gesamten Anime nach einer Bestätigung löschen. Alle
zugehörigen persönlichen Einträge werden dann mit gelöscht. Mitgliedsnummern,
Erstellerprüfung und gemeinsame Speicherung werden serverseitig geprüft.

## Filtern und Sortieren

Die Mitglieder-Mehrfachauswahl bildet eine Schnittmenge: Ein Anime muss zu allen
gewählten Mitgliedern gehören. Keine Auswahl zeigt die gesamte Bibliothek.
Zusätzlich gibt es Status-, Genre- und Formatfilter. Der Status muss bei mindestens
einem Mitglied des Anime zutreffen. Sortiert wird nach neu/alt hinzugefügt,
Anzahl der Mitglieder, Titel, Genre, MAL-Score oder Episodenzahl. Unbekannte
Episodenzahlen stehen in beiden Sortierrichtungen am Ende.

## Datenstand und Ausfälle

Die Suche fragt Tenrai bei Bedarf ab. Lokal werden Suchen zwei Minuten und Details
15 Minuten gespeichert; identische gleichzeitige Anfragen werden zusammengefasst.
Anfragen laufen spätestens nach zwölf Sekunden ab. Eine Warteschlange mit mindestens
1,1 Sekunden Abstand liegt unter den öffentlichen Tenrai-Limits (4/s, 120/min).
Nach Netzwerkfehlern pausieren neue Quellenanfragen 15 Sekunden. Bei 429 wird
`Retry-After` berücksichtigt, ansonsten 30 Sekunden gewartet. Bereits gespeicherte
Cachetreffer bleiben in dieser Zeit verfügbar. DNS-/Verbindungsfehler, Timeouts
und ungültige Antworten werden unterschieden. Die Oberfläche zeigt kontrollierte
Fehlermeldungen; erwartete Quellenfehler erscheinen im Serverlog ohne Stacktrace.

Tenrai liefert vorbereitete und zwischengespeicherte MyAnimeList-Daten. Die Integration ist
deshalb keine Garantie für sekundengenaue Quelldaten. Karten zeigen den Zeitpunkt
des lokalen Abrufs. Die Metadaten werden bei Auswahl und Speicherung gemäß
Cache-Laufzeit erneut geladen; es gibt keinen regelmäßigen Hintergrundimport.
Öffentliche Quelle: [Tenrai-FAQ zum Datenstand](https://api.tenrai.org/faq).

Gespeicherte Listen bleiben ohne Quellenzugriff lesbar. Bei Such- und Detailfehlern
zeigt die Oberfläche eine Fehlermeldung und erlaubt erneutes Suchen. Ein fehlgeschlagener
Abruf speichert keinen unvollständigen Anime.

## API und Speicherung

| Methode | Route | Zweck |
|---|---|---|
| GET | `/api/anime` | Gemeinsame Bibliothek einschließlich alter manueller Einträge |
| GET | `/api/anime/search?q=cowboy&page=1` | Suche mit weiteren Ergebnisseiten |
| GET | `/api/anime/mal/:id` | Normalisierte Quelldaten |
| GET | `/api/anime/members` | Registrierte Mitglieder, Sitzung erforderlich |
| POST | `/api/anime/:id/entries` | Eigenen Eintrag speichern, optional `memberIds` hinzufügen |
| DELETE | `/api/anime/:id` | Gesamten Anime als Ersteller löschen |

Beispiel für einen Watching-Eintrag:

```json
{"status":"watching","watchedEpisodes":6,"score":null,"memberIds":[2,3]}
```

`mal_anime` und `mal_anime_entries` werden beim Serverstart für SQLite und PostgreSQL
angelegt. Spiel und Nutzerprofil sind davon unabhängig. Alte manuelle Anime werden
weiter angezeigt und gezählt, ohne Namensgleichheit als Discord-Zuordnung auszulegen.
`POST /api/catalog/anime/reviews` ist in der Anwendung gesperrt; `GET /api/catalog/anime`
liefert weiterhin die vollständige Bibliothek. Dashboard-Zahlen berücksichtigen beide Arten.

## Prüfung

`npm.cmd test` prüft unter anderem die Quellenschnittstelle mit Fixtures, Cache,
Quellenfehler, IDs, Sitzungen, Status-/Episodenvalidierung, gemeinsame Einträge,
Transaktionen, Löschrechte und Filter. Es werden keine echten Anime-Daten gespeichert.

`npm.cmd run check:anime` prüft die echte Seite mit SQLite im Arbeitsspeicher und
lokalen Quellen-Fixtures in Chrome/Edge: Desktop, Mobilansicht, Gäste und abgelaufene
Sitzungen. `npm.cmd run check:games` verwendet denselben Browser-Testhelfer.
