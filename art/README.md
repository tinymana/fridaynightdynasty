# Art sources

Sheets supplied by the creative director on 2026-11-25. Not yet used in the game.

| File | Contents | Planned use |
| --- | --- | --- |
| `cutins-scoring.jpg` | Touchdown, field goal, extra point panels and banners | Cut-ins after scoring plays and kicks |
| `cutins-events.jpg` | Interception, sack, first down, half time, game over, referees, cheerleaders, coaches | Event cut-ins, half time and final screens |
| `players-sheet.jpg` | Running, throwing, catching, blocking, diving and kicking poses | Player sprites (need recolouring per school) |
| `kicking-sheet.jpg` | Kicker, holder, referee signals | Special-teams sequences |
| `hud-overlays.jpg` | Score bug frames, status boxes, pixel font, arrows, play clock, transition banners | Scoreboard restyle and the broadcast look |
| `ball-and-field-fx.jpg` | Footballs, impact effects, turf damage, pylons, chains | On-field effects, weather and worn turf |

Not stored here: the field-tile sheet, because it carries a real league's logo. The game uses only original
marks; the sheet needs a version without that logo before any of it can ship. The same goes for the drink-cooler
logo in `cutins-events.jpg`, which must be cropped out or repainted before that panel is used.

All sheets are JPEG on a grey background with uneven spacing, so each sprite has to be cut out and cleaned by hand
(or re-exported as PNG with transparency on a fixed grid) before use.

## Second set (`source/sheets2`)

Supplied 27 November 2026. Cut by `tools/cut-sprites.py`.

- **In the game:** `01_tecmo_players_spritesheet.png` (the red-and-silver row, repainted per school), the bleachers
  and press box from `05_high_school_crowd_spritesheet.png`, and the wall ads from `09_sponsor_banners.jpg`.
- **Not yet used:** referees, cheerleaders, sideline and field props, menu assets, stadium signs.
- **Left out on purpose:** the "Welcome to Friday Night Lights" sign (the title of a book, film and series), the
  mascot-specific signs (schools are generated), and the cooler with a single-letter logo.
