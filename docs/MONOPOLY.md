# Lacedaemon Monopoly

Unser eigenes richup.io: Mitglieder spielen live gegeneinander (Discord-Login oder Gast-Name), Bots füllen leere Plätze. Regeln, Zahlen und Raumeinstellungen folgen richup.io; dazu kommen eigene Extras wie die **Crazy Surprises/Treasures**. Straßennamen, Farben, Flaggen, Karten und die Optik sind Vorlagen und lassen sich ohne Code austauschen.

## Starten

```powershell
npm.cmd install
npm.cmd run dev
```

Dann **http://localhost:3000/pages/monopoly.html** öffnen (oder im Portal auf „Monopoly“). Einladungslinks haben die Form `http://localhost:3000/play/abcde`.

- **Play** sucht einen offenen öffentlichen Raum oder eröffnet einen.
- **All rooms** zeigt öffentliche Räume mit ihren Regel-Abweichungen.
- **Create a private game** eröffnet einen privaten Raum (nur per Link erreichbar).

Wer den Raum öffnet, ist Host: Er stellt die Regeln ein, fügt Bots hinzu und startet.

### Mit Freunden spielen

- **Gleiches WLAN:** in `.env` `HOST=0.0.0.0` setzen und den Server neu starten. Freunde öffnen `http://<deine-IP>:3000/play/<raumcode>` (die IP zeigt `ipconfig` unter Windows). Windows fragt beim ersten Start, ob Node.js im Netzwerk erreichbar sein darf: erlauben.
- **Übers Internet, schnell:** einen Tunnel starten, z. B. `cloudflared tunnel --url http://localhost:3000`, und den angezeigten `https://…trycloudflare.com`-Link mit `/play/<raumcode>` weitergeben.
- **Tailscale (nur für eingeladene Freunde):** auf dem Host-PC Tailscale installieren und anmelden, Server starten, dann `tailscale serve --bg 3000`. Der Link `https://<pc-name>.<tailnet>.ts.net/play/<raumcode>` funktioniert für alle im eigenen Tailnet (Freunde über „Share“ bzw. „Invite users“ in der Tailscale-Admin-Konsole einladen). Für Freunde ohne Tailscale: `tailscale funnel --bg 3000` macht denselben Link öffentlich.
- **Kostenlos im Internet zum Testen (Render):** auf https://render.com mit GitHub anmelden, *New → Blueprint*, dieses Repository und den Branch `claude/cool-heisenberg-0vkqp2` wählen; `render.yaml` stellt alles ein. Danach läuft das Spiel unter `https://lacedaemon-….onrender.com/pages/monopoly.html`. Kostenlose Instanzen schlafen nach 15 Minuten ohne Besucher ein (der erste Aufruf dauert dann etwa eine Minute) und vergessen dabei laufende Partien.
- **Dauerhaft:** auf dem Linux-Server mit `NODE_ENV=production` hinter HTTPS betreiben.

### Discord-Login

Ohne Konfiguration spielt jeder mit einem Gast-Namen (der Browser merkt sich ein zufälliges Token, damit man nach einem Neuladen seinen Platz behält). Für den Discord-Login:

1. Auf https://discord.com/developers/applications eine Anwendung anlegen, unter **OAuth2** die Redirect-URL `http://localhost:3000/api/auth/discord/callback` eintragen (später die echte Domain).
2. In `.env`:

   ```
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback
   # optional: nur Mitglieder des Lacedaemon-Servers
   DISCORD_GUILD_ID=...
   ```

Angemeldete Mitglieder stehen in der Tabelle `members`, Sitzungen in `sessions` (im Cookie liegt ein Zufalls-Token, in der Datenbank nur dessen SHA-256). Die Raumeinstellung **Only logged-in users** lässt dann nur Discord-Mitglieder mitspielen.

## Aufbau

```text
src/modules/monopoly/
  engine/            reine Spielregeln, ohne Express/DOM
    game.js          Zustand, Aktionen, Miete, Karten, Schulden, Handel, Auktion, Statistik
    bots.js          Bot-Entscheidungen (auch für Spieler, deren Zeit abgelaufen ist)
    board.js, rng.js, errors.js
  maps/              Map-Vorlagen als JSON + Prüfung beim Laden
    lacedaemon.json  das Lacedaemon-Brett mit allen Karten
  lobbies/           Räume: Lobby, Host, Bots, Teams, Zuguhr, Votekick, Zeitplan
  realtime/socket.js Socket.IO, Server ist autoritativ
  settings.js        alle Raumeinstellungen mit UI-Texten
  monopoly.routes.js REST: /api/monopoly/...
src/modules/auth/    Discord OAuth2 und Sitzungen
public/pages/monopoly.html
public/assets/js/monopoly/        Client (Brett, Würfel, Räume, Dialoge, Sounds)
public/assets/css/pages/monopoly.css
public/assets/monopoly/themes/    Optik-Vorlagen (CSS) + themes.json
```

Der Client schickt nur Wünsche („würfeln“, „kaufen“, „bieten“); der Server prüft alles und schickt jedem Spieler den vollen Zustand plus Ereignisse für die Animationen. Räume liegen im Speicher des Server-Prozesses: Ein Neustart beendet laufende Partien. Beendete Partien landen in `monopoly_games`.

## Karten ändern

Alle Karten stehen in `src/modules/monopoly/maps/lacedaemon.json` unter `cards`:

```json
{ "text": "You won in the Casino. You made a profit of 25🐉.", "effect": { "type": "money", "amount": 25 } }
```

Den `text` frei ändern, der `effect` bestimmt, was passiert. Der Text wird 1:1 angezeigt; `{player}` wird durch den Namen des betroffenen Spielers ersetzt (bei Karten, die einen anderen Spieler treffen). Server neu starten, fertig.

- `cards.treasure` und `cards.surprise`: die normalen Stapel (je 17 Karten, wie richup).
- `cards.crazy.treasure` und `cards.crazy.surprise`: werden nur mit der Einstellung **Crazy Surprises/Treasures** dazugemischt.

| `effect.type` | Felder | Wirkung |
|---|---|---|
| `money` | `amount` | positiv: bekommen, negativ: an die Bank zahlen |
| `moveTo` | `tile`, optional `collectGo: false` | zu Feld Nr. `tile` (0 = =collect); beim Überqueren von =collect gibt es Geld, außer `collectGo: false` |
| `moveSteps` | `steps` | vor (positiv) oder zurück (negativ) |
| `nextOfType` | `tileType`: `airport` oder `company` | zum nächsten Flughafen bzw. Provider |
| `prison` | | in die Backrooms |
| `pardon` | | Freikarte (höchstens eine pro Stapel) |
| `payEach` / `collectEach` | `amount` | jedem Spieler zahlen / von jedem kassieren |
| `repairs` | `perHouse`, `perHotel` | pro Upgrade / Full-Stack zahlen |
| `boost` | | eigene Grundstücke kassieren doppelte Miete bis zum nächsten eigenen Zug |
| `shield` | | keine Miete zahlen bis zum nächsten eigenen Zug |
| `skipTurn` | `turns` | nächste Züge aussetzen |
| `goToVacation` | | zu Touch Grass (setzt aus, kassiert den Topf) |
| `teleportRandom` | | auf ein zufälliges Feld |
| `swapRandom` | | Platz mit `{player}` tauschen |
| `moveOthers` | `steps` | alle anderen springen, ohne Feld-Effekt |
| `stealPercent` | `percent` | Anteil vom Bargeld des Reichsten (`{player}`) |
| `robinHood` | `amount` | der Reichste (`{player}`) zahlt dem Ärmsten |
| `everyonePaysPot` | `amount` | alle zahlen in den Touch-Grass-Topf |
| `payPerProperty` | `amount` | pro eigenem Grundstück zahlen |
| `freeUpgrade` | | ein kostenloses Upgrade (sonst 100 Bargeld) |
| `griefUpgrade` / `griefSelf` | | `{player}` bzw. man selbst verliert ein Upgrade |
| `claimFree` | | billigstes freies Grundstück geschenkt (sonst 200 Bargeld) |

Ist etwas falsch (unbekannter Typ, Feldnummer außerhalb des Bretts …), startet der Server nicht und sagt, welche Karte es ist.

## Straßen, Farben und Flaggen ändern

Ebenfalls in `lacedaemon.json`:

- `tiles`: 40 Felder im Uhrzeigersinn ab der Ecke oben links. Ecken an Position 0, 10, 20, 30 (`go`, `prison`, `vacation`, `goToPrison`). Straßen (`city`) haben `name`, `group`, `price`, `house` (Upgrade-Kosten) und `rent` mit 6 Werten (ohne, 1–4 Upgrades, Full-Stack). Flughäfen (`airport`) haben `rent` je Anzahl, Provider (`company`) `multipliers` je Anzahl. Steuern (`tax`) haben `amount` oder `percent`.
- `groups`: Farbgruppen. `color` als Hex, `flag` als Flaggen-ID. `placeholder` ist nur ein interner Merkname (z. B. „Germany“) und erscheint nirgends im Spiel.
- `words`: Währung (`🐉`, Position `after`), Namen für Haus/Hotel (`upgrade`/`full-stack`), Gefängnis, Freikarten.
- `rewards`, `prison`, `vacation`: Geld für =collect (vorbei 200, genau drauf 300), Kaution und Runden in den Backrooms, Aussetzen bei Touch Grass.

Flaggen und Icons: eingebaute IDs (`steam`, `shadow`, `revolver`, `block`, `orbit`, `rps`, `debate`, `lizard`, `casino`, `bolt`, `sheriff`, `helmet`; Icons `windows`, `linux`, `mac`, `uwuntu`, `openbsd`, `server`, `internet`, `donation`, `bill`), ein Emoji (`"emoji:🦎"`) oder ein eigenes Bild (`"img:/assets/img/meine-flagge.png"`). Neue eingebaute Grafiken kommen nach `public/assets/js/monopoly/icons.js`.

**Weitere Bretter**: eine neue JSON-Datei mit eigener `id` in `src/modules/monopoly/maps/` ablegen. Sie erscheint automatisch in den Raumeinstellungen unter „Board“. Mehr oder weniger als 40 Felder gehen auch (16 bis 64, durch 4 teilbar).

## Optik (Themes)

Jeder Spieler wählt seine Optik selbst (Paletten-Symbol im Raum oder auf der Startseite), das Brett der anderen bleibt davon unberührt. Mitgeliefert: **Lacedaemon Night**, **Amethyst**, **Blurple**, **Overworld**, **The Backrooms**, **Marble**.

Neues Theme:

1. `public/assets/monopoly/themes/<id>.css` anlegen und darin die Tokens unter `.mono-root[data-theme="<id>"]` überschreiben (`--m-bg`, `--m-panel`, `--m-accent`, `--m-tile-bg`, `--m-board-art`, `--m-font-tile` …; die vollständige Liste steht oben in `public/assets/css/pages/monopoly.css`).
2. In `themes.json` eintragen (`id`, `name`, `line`, `swatch` mit drei Farben, optional `fonts` als Google-Fonts-URL).

## Einstellungen

Alles von richup.io, Texte wie dort:

| Einstellung | Standard |
|---|---|
| Maximum players | 4 (2–8, alles frei) |
| Private room | aus |
| Allow bots to join | an |
| Only logged-in users | aus |
| Teams (mit „Balance starting cash“) | aus |
| x2 rent on full-set properties | aus |
| Vacation cash | aus |
| Auction | aus |
| Don't collect rent while in prison | aus |
| Mortgage | aus |
| Even build | an |
| Starting cash | 1.500 (500–3.000) |
| Randomize player order | an |

Dazu unsere Extras:

| Einstellung | Standard |
|---|---|
| **Crazy Surprises/Treasures** | aus: mischt die verrückten Karten in beide Stapel |
| **Turn timer** | standard (20 s + Zeitkonto wie richup), relaxed (doppelt), off |
| **Round limit** | keins; sonst gewinnt nach 20/30/50 Runden der höchste Gesamtwert |

## Regeln in Kürze (wie richup)

- Über =collect: +200, genau drauf: +300. Pasch: nochmal würfeln, dritter Pasch: Backrooms.
- Backrooms: 3 Runden. Raus mit Pasch, 50 zahlen (vor dem Würfeln) oder Freikarte. Nach drei Fehlversuchen ist man frei.
- Touch Grass: einmal aussetzen; mit „Vacation cash“ gibt es den Topf aus Steuern und Bank-Zahlungen.
- Server Donation: 10 % vom Bargeld. Server Bill: 75.
- Upgrades nur mit vollständiger Gruppe und ohne Hypothek darin; ein Full-Stack kostet so viel wie ein Upgrade. Abreißen bringt die Hälfte zurück.
- Verkauf an die Bank: halber Preis (nichts, wenn belastet). Hypothek: halber Preis, Ablösung 110 %.
- Wer nicht zahlen kann, bekommt Schulden: Der Gläubiger erhält sofort das vorhandene Bargeld, der Rest muss durch Verkaufen/Belasten/Handeln aufgebracht werden, sonst Bankrott.
- Handel jederzeit: Geld, Grundstücke (ohne Bauten in der Gruppe) und Freikarten. In öffentlichen Räumen darf man nicht über 90 % seines Werts verschenken.
- Zuguhr: Läuft die Zeit ab, spielt der Server den Zug minimal zu Ende; nach zwei solchen Zügen fliegt man raus. Mitspieler können eine Minute schenken.
- Votekick: Mehrheit der menschlichen Spieler.

## Grenzen

- Räume leben im Speicher eines Server-Prozesses; für mehrere Instanzen bräuchte es einen geteilten Speicher (z. B. Redis-Adapter für Socket.IO).
- Gewinne sind noch nicht an die Drachen-Economy angebunden (`monopoly_games` speichert aber jedes Ergebnis).
- Einen grafischen Map-Editor gibt es noch nicht; Bretter werden als JSON gepflegt.
