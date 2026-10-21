# Steam-Spiele und Discord-Bewertungen

Auf `/pages/games.html` werden Spiele im deutschen Steam Store gesucht. Weitere
Treffer lassen sich seitenweise nachladen. Nach Auswahl werden Titel, Headerbild,
Kurzbeschreibung, Genres, Preis und Spielmodus von Steam übernommen. Persönliche
Angaben hängen vom Status ab: Merkliste hat Priorität High/Medium/Low, „Wird gespielt“
hat keine Bewertung, „Pausiert“ und „Abgeschlossen“ haben eine Bewertung von 1–10.
Nur diese numerischen Bewertungen fließen in den Durchschnitt ein.

Zum Speichern ist eine gültige Discord-Sitzung erforderlich. Die Mitglieds-ID
kommt ausschließlich aus dem serverseitig geprüften Sitzungscookie. Anzeigename
und Avatar werden aus dem verknüpften Discord-Mitglied geladen. Gleichnamige
Mitglieder bleiben getrennt; pro Spiel und Mitglied gibt es eine Bewertung,
die aktualisiert werden kann. Profiländerungen werden in den Bewertungen mit angezeigt.

## Ansicht, Filter und Bearbeiten

Das Menü unter der Seitenüberschrift enthält „Spiel hinzufügen“. Die Steam-Suche
und das Hinzufügen öffnen sich in einer eigenen Maske. Die Bibliothek zeigt auf
großen Bildschirmen drei Karten nebeneinander, auf kleineren zwei oder eine.
Eigener Status, Priorität und Bewertung werden direkt in der jeweiligen Karte geändert.

Beim Hinzufügen können weitere bereits angemeldete Discord-Mitglieder ausgewählt
werden. `GET /api/games/members` liefert diese Liste ausschließlich mit gültiger
Sitzung. `memberIds` beim Speichern setzt diese Mitglieder auf die Merkliste mit
Priorität Medium. Bereits bestehende Einträge der ausgewählten Mitglieder werden
nicht überschrieben; ihre Bewertungen können weiterhin nur sie selbst ändern.
Ersteller des Spiels bleibt das Mitglied, das es angelegt hat. Alle Einträge werden
gemeinsam mit dem Spiel in derselben Transaktion gespeichert.

„Merkliste von“ erlaubt mehrere Mitglieder. Ohne Auswahl sind alle Spiele sichtbar,
auch ohne Merkliste. Bei mehreren ausgewählten Mitgliedern muss das Spiel auf
**jeder** ihrer Merklisten stehen (`planned`). Die Zuordnung erfolgt über die
Mitglieds-ID, nicht über den Anzeigenamen. Zusätzlich filtert „Status“ nach mindestens
einer passenden Bewertung des Spiels, unabhängig vom ausgewählten Mitglied.

Die Sortierung bietet neu/alt hinzugefügt, Beliebtheit (Anzahl der Merklisten),
Preis auf-/absteigend und Genre alphabetisch. Fehlende Preise stehen in beiden
Richtungen am Ende. Änderungen einer Bewertung oder des Steam-Datenstands ändern
das ursprüngliche Hinzufügedatum nicht.

Nur das Mitglied, das den Spieleintrag angelegt hat, erhält „Spiel löschen“.
Nach Bestätigung werden das gesamte Spiel und alle zugehörigen Bewertungen
gelöscht. `DELETE /api/games/:appId` prüft die Sitzung und den gespeicherten
Ersteller serverseitig unmittelbar beim Löschen. Fremde Mitglieder erhalten 403,
Gäste 401 und nicht vorhandene Spiele 404.

## Steam-Daten

- Suche: `https://store.steampowered.com/search/results/` mit Spielkategorie und
  50er-Pagination. Das Ergebnis-HTML wird ausschließlich serverseitig in Textdaten
  umgewandelt und niemals als HTML in die Oberfläche übernommen.
- Details: `https://store.steampowered.com/api/appdetails` mit App-ID, Sprache Deutsch
  und Region Deutschland. Nur von Steam als Spiel klassifizierte Apps können gespeichert werden.
- Kein zusätzlicher Steam-API-Key erforderlich. Die öffentlichen Store-Endpunkte
  sind keine stabil zugesicherte Steamworks-Web-API. Änderungen oder Ausfälle bei Steam
  können die Suche beeinträchtigen; Fehlermeldungen und erneutes Suchen sind vorgesehen.
- Suchanfragen werden zwei Minuten und Details 30 Minuten zwischengespeichert.
  Anfragen laufen nach acht Sekunden ab. Gleichzeitige identische Anfragen werden zusammengefasst.
- Preise sind der bei Steam gelieferte Stand für Deutschland. Gespeicherte Karten
  zeigen das Datum dieses Stands. Beim erneuten Auswählen und Speichern werden Details
  gemäß Cache-Laufzeit erneut abgerufen; es gibt keinen regelmäßigen Hintergrundimport.
- Steam stellt kein allgemeines Feld für die maximale Koop-Spielerzahl bereit.
  Eine Zahl wird nur übernommen, wenn eine eindeutige Spielerzahl ausdrücklich mit
  einem Koop-Modus im Steam-Text verknüpft ist. Bei fehlenden oder widersprüchlichen
  Angaben erscheint „Spielerzahl nicht angegeben“. Aktuelle Online-Spielerzahlen
  und Empfehlungen werden nicht als Koop-Kapazität verwendet.

## Speicherung und bestehende Einträge

Die Tabellen `steam_games`, `steam_game_entries` und `steam_game_reviews` werden beim Serverstart für
SQLite und PostgreSQL angelegt. Steam-Metadaten, Ersteller und Bewertung werden gemeinsam
in einer Datenbanktransaktion gespeichert. Der alte ungeschützte Schreibpfad
`POST /api/catalog/games/reviews` ist gesperrt. Anime bleibt davon unabhängig.

Vorhandene manuelle Spiele und Bewertungen bleiben lesbar. Ohne sichere Steam-ID
oder Discord-Mitglieds-ID werden sie weder automatisch zugeordnet noch mit einem
fremden Discord-Profil verbunden. Neue Steam-Einträge und Alteinträge werden bei
der Spielezahl im Dashboard berücksichtigt.

Bestehende Steam-Bewertungen werden automatisch auf die neuen Statusfelder migriert.
„Gespielt“ (`completed`) heißt jetzt „Abgeschlossen“ und behält die Bewertung.
Alte Merkliste-Einträge erhalten Priorität Medium, bei „Wird gespielt“ entfällt die
Bewertung. Ersteller und ursprüngliche Zeitstempel bleiben erhalten. SQLite baut
die Bewertungstabelle innerhalb einer Transaktion um, PostgreSQL passt sie einmalig an.

Für bereits gespeicherte Steam-Spiele wird der eindeutig erste Bewertende anhand
von `created_at` als Ersteller rekonstruiert. Bei gleichzeitig ersten Bewertungen
oder fehlendem Nachweis bleibt der Ersteller unbekannt und niemand erhält automatisch
Löschrechte. Diese einmalige Zuordnung bleibt bei Neustarts und späteren Bewertungen
unverändert. Historische manuelle Einträge ohne Discord-Zuordnung sind nicht löschbar.

## Tests

`npm.cmd test` prüft unter anderem Quellenvalidierung, Steam-Ausfälle, Cache,
Preis- und Koop-Angaben, echte Sitzungscookies, Identitätsschutz, Updates und
Bestandserhalt. Es werden dabei keine echten Steam-Anfragen benötigt.

`npm.cmd run check:games` prüft die echte Seite mit lokalen SQLite-/Steam-Fixtures
im vorhandenen Chrome- oder Edge-Browser: Desktop, Mobilansicht, Gäste und abgelaufene
Sitzungen. Bei Bedarf kann `BROWSER_PATH` auf einen Chromium-Browser gesetzt werden.
