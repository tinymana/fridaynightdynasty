# Changelog

## 0.25.0 — 2026-11-27

The off-season. League change (rosters carry a spring focus): redeploy the `fnd` function with the merge.

### Added
- `FOCUSES`, `seededFocus`, `ProgramTune` in `program.ts`: +1 on the focus's ratings for returning players. The
  coach's school uses `Dynasty.focus`; every other school's focus comes from the seed (from season 2 on).
- `nextSeason(d, focus)`; `Dynasty.dev` (per-player rating points, -1 a season for a player still on the call-up
  list at season's end, at most `CALL_UP_COST_MAX`); both cleaned by `loadDynasty` and absent in old saves.
- `packages/league/src/offseason.ts`: `teamHonors`, `signings` (made-up colleges, deterministic), `jobOffers`,
  `takeJob`, `campNews`. `SeasonRecord.school` so a title won at a former school still counts in `career`.
- Dynasty page: the off-season in five stops in place of the single Start-next-year button.
- `tests/offseason.test.ts` (4 tests); six more checks in `tools/dynasty-check.mjs`.

## 0.24.0 — 2026-11-27

Rivalries and the weekly paper. League change (`nextSeason`): redeploy the `fnd` function with the merge.

### Added
- `rivalries(d)`, `rivalOf`, `isRivalryGame`, `RIVALRY_WEEK`: rivals are the last-week opponents in the schedule.
  The trophy name and the series before the coach arrived come from the league seed; `Dynasty.rivals` logs what the
  dynasty adds (cleaned by `loadDynasty`; absent in old saves, which start their logs at zero).
- `nextSeason`: +0.15 prestige for beating your rival.
- `packages/league/src/paper.ts`: `weeklyPaper(d)` builds the week's page from results, standings, news and (for
  other schools' games) a replay for the night's best player.
- Dynasty page: rival line, rivalry-week notice, Read the paper. Cut-ins `n-rivalry`, `n-rivalry-win`.
- `tests/paper.test.ts` (4 tests), `tools/paper-shot.mjs`.

## 0.23.0 — 2026-11-27

The game book. Client and league package; no change to how a game plays, so no server redeploy for this one alone.

### Added
- `packages/league/src/gamebook.ts`: `periodScores`, `scoringPlays`, `gameTotals` (third and fourth downs, penalties,
  punts, time of possession from the game clock), `driveChart`, `situation`, `elapsed`.
- `replayResult(d, game)`: a finished league game between two other schools played again from its seed and rosters
  for its play-by-play; null for the coach's own games or if the replay does not end on the recorded score.
- Client `gamebook.ts`: `renderGamebook(root, events, teams)` with Summary, Box score, Drives and Play-by-play tabs.
  On the final screen in place of the old totals table and scoring log; in a dynasty from last week's results.
- `tests/gamebook.test.ts` (6 tests over 40 games), `tools/book-shot.mjs`.

## 0.22.0 — 2026-11-27

Injuries and roster events. Simulation change (rosters): redeploy the `fnd` function with the merge.

### Added
- `packages/league/src/program.ts`: `incidentsOf` (injuries, grades, suspensions, a family moving), `departuresOf`
  (summer), walk-ons and transfers at fall camp, and a phenom in about one class in eight. Like the classes, none of
  it is stored: everything comes from the league seed, the school and the season, so saves do not change shape.
- `programFor(..., week)`: a player who is out keeps his place on the list but does not dress; players who are gone
  are not in the program. `squadTeam` moves the weakest man of the deepest group out of position if a squad is short
  (`MIN_DRESSED`), so no formation puts one player in two places.
- `teamFor`, `jvTeamFor`, `matchTeams` take the week; `leagueNews(d)` and `programNews` put it all in words;
  `programNames` keeps a name on the statistics of a player who has left.
- Dynasty page: Team news, Around the league, "Not dressing" before a game; program page tags for out, walk-on,
  transfer and phenom.
- Main menu on screens 900 px and wider: `menu-wide.webp` with the live rows laid over the painted ones.
- `tests/events.test.ts` (9 tests), `tools/events-shot.mjs`, `tools/menu-wide-shot.mjs`.

## 0.21.0 — 2026-11-27

Realism retune (softened) against the Ohio results archive. Simulation change: the `fnd` function must be redeployed
with the merge, and a game replays differently from 0.20.0.

### Changed
- `RULES.runoffSeconds` 32 to 29 (the coach AI's kneel arithmetic reads the same constant). Even teams: 19.7 points and
  64 plays a team (was 18.8 and 59).
- `LEAGUE_TUNING` in `packages/league/src/program.ts`: `gap` 2 (rating points per point of prestige, was 1),
  `homeEdge` 1 for every second man on the home roster (`matchTeams`, used by solo and shared leagues).
  Over 348 league games: 21.1 points a team (was 17.7), home side wins 55% (real 54 to 55), decided by 21 or more 40%
  (was 16; real 55 to 58), shutouts 10% (real 8 to 9), within 8 points 32%.
- `nextSeason`: drift toward the middle 0.5 (was 0.4; 0.6 from 0.24.0) and luck plus or minus 2.5 (was 2), so the wider gap does not
  let one school run a league for 30 years.
- `tools/league-realism.ts` measures the above and takes the tuning values as arguments.

### Added
- Player frames `truck`, `juke`, `pylon` (running back sheet), `dive`, `spike` (receiver sheet), `field` (special
  teams sheet). Moves set `moveUntil`; an incomplete pass lays the nearest receiver out; the scorer spikes it; the
  returner settles under a kick.
- Handoffs: the client knows the call was a run (`viewRun`), so the quarterback faces his backfield (`ViewPlayer.back`)
  and shows the handing-off arm for a third of a second after the ball changes hands, in place of the throwing pose.
  `tools/handoff-check.mjs` samples every drawn frame of live runs.
- Player frames `handoff` (quarterback sheet) and `crouch`, `tackle`, `swat`, `pick` (linebacker and safety sheet),
  both new in `art/source/sheets3`.
- Eleven panels `a-*.webp` from `17_action_cutscenes.png`; `cutinFor` now also answers runs and completions of 20
  yards or more.
- `flagDrop(event)`: three drawn penalty flags tumble in and land, placed from the play's number. `tools/flag-shot.mjs`.

## 0.20.0 — 2026-11-27

Permanent saves. Needs migration `0004_fnd_saves.sql` and a redeploy of the `fnd` function.

### Added
- `fnd.saves`: one save per coach (`rev`, `label`, `bytes`, `data`), row level security on, written only by the function.
- API actions `saveInfo`, `saveLoad`, `saveStore` (`packages/online/src/save.ts`, `Store.getSave` / `putSave`). A write
  names the revision the browser last saw; if the server holds another, nothing is written and `conflict` comes back
  with the save that is there. `force` overwrites. Saves are capped at 1.5 MB; a 30-season dynasty is about 160 KB.
- Client `saves.ts` (`makeSave`, `readSave`, `saveLabel`): one shape for the server copy and the downloadable file,
  holding the dynasty, designed plays and defenses, and the playbook. Everything read back goes through `loadDynasty`,
  `validateOffPlay`, `validateDefPlay` and `validateBook` again.
- Saves page on the main menu: sign in, save now, load, choose between two differing saves, download and load a file.
  Changes are sent up automatically a moment after they are made; on opening the game signed in, a newer server save
  is fetched when this browser has nothing unsaved.
- `DynastyScreen.reload()`.
- Player frames `line` and `drive` from the linemen pack (`LINE_FRAMES` in `tools/cut-sprites.py`). Offensive and
  defensive linemen show `line` before the snap (line panel, lined-up view, first ticks of a play) and `drive` while
  engaged or set after it; the scene draws both a little back from the spot so hands, not hips, are at the ball.
- `crowdFeels(event)`: emoji out of the stands for the home crowd, placed from the play's own number.
  `tools/crowd-shot.mjs`.
- `tests/saves.test.ts` (7 tests) and `tools/saves-check.mjs` (19 browser checks across five devices).

## 0.19.0 — 2026-11-27

Weather overlays and the homecoming court. Client only.

### Added
- `wx-rain.png`, `wx-snow.png`, `wx-fog.png`, `wx-leaves.png` cut by `cut_weather()` in `tools/cut-sprites.py`;
  `showWeather()` tiles them over the stage (`#wx`), with the fog sheet as a mist layer behind rain and snow.
  Loops move by whole tiles so they do not jump; they stop under `prefers-reduced-motion`.
- Homecoming court (king, queen, four attendants, banner) in the sideline atlas; `FieldScene.showBand(on, court)`
  shows it with the halftime band when the occasion is homecoming.
- Nine panels from the new cutscene sheets (`art/source/sheets3`, cut by `tools/cut-art.py` as `n-*.webp`):
  run-through, bus, homecoming banner (`cutinFor(null, 'opening', …)` at the opening kickoff), fourth-quarter and
  overtime banners, coin toss, locker room, chalk talk, handshake. `CutinPeriod` replaces the `'half' | 'final'` union.
- `tools/opening-shot.mjs`.

## 0.18.0 — 2026-11-27

A field that wears. Client only.

### Added
- `turf.png` (mud, puddles, snow, frost) cut by `tools/cut-sprites.py` from the weather sheet.
- `FieldScene.resetTurf` and `addWear`: two render textures over the grass, one for lying snow or frost (erased where
  players have been) and one for mud, scuffs and puddles. `wearFrom(event)` in the client places marks from the
  play's own number, so the field is the same after a reload or a rejoin.
- `tools/turf-shot.mjs`.

## 0.17.0 — 2026-11-27

Look-and-feel polish from the supplied art. Client only.

### Added
- Ten moment panels cut from `art/source/sheets2/22_moment_panels_spritesheet.png` (`assets/cutins/m-*.webp`);
  `cutinFor` takes a `CutinContext` (won, title game, homecoming) to pick the celebration, trophy and crowning panels.
- School names painted in the end zones and the home team's letters at midfield.

## 0.16.0 — 2026-11-27

Players and stadium from the supplied sheets (`art/source/sheets2`).

### Added
- `tools/cut-sprites.py` cuts the sheets into `players-base.png`, `players-mask.png` (which pixels are jersey,
  helmet or pants, and how light) and `stadium.png`, and writes `apps/client/src/art-atlas.ts`.
- `FieldScene` draws at two screen pixels per world unit (960 x 620), repaints the player frames per school from
  the mask, and adds stands and sponsors' boards above the field. Client only; the simulation is untouched.
- `tools/field-shot.mjs`.
- Sideline and chain crew (`sideline-base.png`, `sideline-mask.png`, `SIDELINE`), repainted per school; the box shows the down.
- `ViewPlayer.pose`: throw, stiff arm, kick and celebration frames chosen by the client from the simulation's state.

## 0.15.0 — 2026-11-27

Season awards.

### Added
- `packages/league/src/awards.ts`: `voteAwards` picks a player of the year, defensive player of the year, newcomer
  of the year, a sixteen-man all-league team and the coach of the year (wins against wins expected from prestige).
  `seasonAwards(d, stats)`, `cleanAwards`. `Dynasty.awards` holds every season's, written by `playWeek` after the
  title game.
- Client: awards on the season-over screen, an Awards page, and honors by school in the record book.

## 0.14.0 — 2026-11-26

Statistics, school records and the UI pass.

### Added
- `packages/league/src/stats.ts`: `boxScore(events)` gives a `StatLine` per player and team totals, counted the
  way a high school scorer does. It reads the play-by-play only, so game results and fingerprints are unchanged.
- `packages/league/src/records.ts`: `historicBook` (a school's records as fifty years left them, scaled to the
  quarter length), `recordGame`, `closeSeason`, `newsText`, `cleanStatBook`.
- `Dynasty.stats` (`StatBook`): season lines for every player in the league, career lines for returning players,
  a record book per school and the records that have fallen. `playWeek` takes the coach's own box score;
  `simulateWithBox`, `statsOf`, `schoolOfPlayer`.
- Client: Statistics and Record book pages, record watch during a dynasty game (`DynastyScreen.watch`), leaders
  and broken records on the final screen.
- `tests/stats.test.ts`.

### Changed
- One visual style across every screen (the block marked "UI pass" in `apps/client/index.html`): Press Start 2P
  for display, Jersey 15 for text (both OFL, carried in the page), gold and blue frames from the HUD sheet.

## 0.13.0 — 2026-11-26

Main menu, coaching jobs, and atmosphere changes after the first listen.

### Added
- Main menu (`#mainMenu`) with pages for Exhibition and Play online (`setupGo`). Keys 1 to 5 and Esc. Styled from
  `art/source/png/friday_night_dynasty_start_screen.png`; the stadium header is cropped from it. Press Start 2P (OFL)
  is carried in the page.
- `openings(league)`: five of a league's eight schools are hiring, with last season's record, a reason and an
  expectation. The dynasty start screen lists them as job postings.

- Both teams are drawn in a huddle between plays (`scrimmageLineup`); trying a front on the call sheet still shows it lined up.

### Changed
- The announcer picks the most natural English voice available and speaks at normal pitch.
- Quarter length and weather pickers move between the Exhibition and Play online pages.

### Fixed
- Kick to return: during the flight every drawn player moves to his starting place in the `ReturnSim` that follows, so nothing jumps when the return begins. `tools/kick-jump.mjs` measures it (0 yards).

### Removed
- The crowd noise bed, cheers and groans, and `crowdLevel`. The chants, band and announcer remain.

## 0.12.0 — 2026-11-26

Friday night atmosphere. Client only: no simulation or server change.

### Added
- `apps/client/src/atmosphere.ts` (pure, tested): `chantFor`, `fightSong` (a four-bar tune from the
  school's seed), `halftimeShow`.
- `apps/client/src/audio.ts`: "de-fense" and clap chants,
  a brass section and drum line, and `announce` (browser speech synthesis). No audio files.
- `occasionFor(week, home)` in the league package: home opener, homecoming, senior night, championship.
- Half-time show card in the result banner; an Announcer button; the occasion on the dynasty screen.
- `tests/atmosphere.test.ts`, `tools/halftime-shot.mjs`.

### Fixed
- A call sheet left on screen when the clock ran out before the snap is cleared.

## 0.11.0 — 2026-11-26

Freshmen, JV and varsity.

### Added
- `packages/league/src/program.ts`: a school's program is four classes of 22 generated from the league seed, the
  school and the year the class enrolled. Nothing is stored: a player's ratings are his senior ratings less his
  growth for each year still to come, lifted or dragged by the school's prestige. `programFor` sorts everyone into
  a 39-man varsity (best at each position, upperclassmen favoured) and a 49-man junior varsity.
- `teamFor` now returns that varsity; `jvTeamFor`, `programOf`, `incomingOf`, `setCallUp`, `simulateJv`.
- `Dynasty.callUps` (at most `MAX_CALL_UPS`, checked on load and at each new season) and `Dynasty.jv` (JV scores,
  played by `playWeek` through the regular season).
- `Player.year`; `rollRatings`, `rollName`, `numberRange` in core.
- Client: the program page in a solo dynasty (varsity, JV, call up, send down, graduating seniors, incoming
  freshmen), class tags on the sideline depth chart.
- `tests/program.test.ts`; the dynasty browser check covers the program page.

### Changed
- Varsity strength is calibrated to the old generated teams (starters average 63.6 before and after).

## 0.10.0 — 2026-11-26

Audibles and ball-carrier moves.

### Added
- `OffDecision` play calls take `audible`: the play changed to at the line. It must be in the book and share the
  formation of the play called. The engine runs the audible, marks the event `flags.audible`, and adds
  `RULES.audibleFalseStart` to the false-start chance. The log keeps both the call and the check, so replays match.
- `aiAudible` and `AutoCoach.audible`: the AI checks out of a run into a 5-2 or 4-4 and into a run against the
  nickel, at `AUDIBLE_RATE`. It draws from its own `line:` stream, so play calling is undisturbed.
- Online: a call sent with `look: true` opens a line phase once both calls are in (`Room.line`, `LINE_MS` 8 s).
  The offense's view carries the front id only; the defense's carries nothing and its call is locked. The offense
  answers with `{kind:'snap'}` or `{kind:'audible', playId}` through the same `call` action. A browser that never
  sends `look` plays exactly as before.
- Client: the line panel (snap, or audible cards for the formation), both sides drawn as they line up, an AUDIBLE
  tag in the calls box.
- Ball-carrier moves: `PlaySim.moves` and `ReturnSim.moves` record a stiff arm, truck, juke or spin on each missed
  tackle (`moveFor`, from power against agility, no random draw) and a dive on a long fall forward. The client
  shows a callout. Results are unchanged by the moves code.
- `tests/audible.test.ts`, `tests/moves.test.ts`, `tools/line-shot.mjs`.

### Changed
- Browser check scripts snap or audible when the line panel is up.

## 0.9.0 — 2026-11-26

Returns played out on the field.

### Added
- `packages/match-sim/src/returns.ts`: `ReturnSim`, a 60 Hz simulation of one ball carrier, his blockers and the
  pursuit. Blocks hold for a time set by the two players' ratings; missed tackles slow the runner and can take out
  the men behind. `kickoffReturnSetup` and `puntReturnSetup` place the coverage and the return team.
- The game uses it for kickoffs, punts that are not fair-caught, interceptions and fumble recoveries.
  `Game.lastReturn` gives a fresh copy to draw. Its random stream is keyed to the snap.
- `PlayFlags.defensiveTouchdown`; punt-return touchdowns.
- Client: mode `return` draws the real return after the kick or the play; a Special teams tab on the call sheet
  that opens on fourth down, with a Fake it card.
- `tests/returns.test.ts`; `tools/probe-returns.ts`.

### Fixed
- A return drawn after the ball had been re-spotted would have been built from the new spot. Positions are now
  copied when the play happens, and a test checks that the return shown is the return that counted.

### Changed
- Kickoff and punt return yards now come from the simulation, not a formula. Game results differ from 0.8.0.

### Known gaps
- Kickoff returns cluster between 12 and 20 yards; real ones spread wider.
- No fumbles on returns, no penalties on returns, no return by the kicking team after a blocked kick.
- Instant replay does not include the return.

## 0.8.0 — 2026-11-26

Penalties, a run-first retune held by a realism scorecard, and school renaming.

### Added
- Penalties (`PenaltyKind`, play type `penalty`, `PlayFlags.foul`): false start and offside before the snap,
  holding on a play the offense gained on, pass interference on an incompletion. Half the distance near a goal
  line. The officials' random stream is keyed to the snap, separate from the play's.
- `tests/realism.test.ts`: 16 measures over 150 AI games, each with a target range. `tools/realism.ts` prints them.
- `PlayEvent.returnYards` for kickoffs and punts; the client plays the return out on the field. The return
  itself is still decided by the kick formula; the players shown are an illustration of that result.
- `editSchool` / `checkIdentity` in `@fnd/league`; `leagueEdit` API action (commissioner only); rename form in
  the shared-league and solo dynasty screens. League game rooms carry the two schools' names and colours.

### Changed
- AI play calling is run first (about 58 percent runs); more fourth-down tries.
- Kicking: range `22 + 0.25 x kicking`, steeper accuracy fall-off, extra points about 85 percent.
- Pass rush: the quarterback reacts to a free rusher at 1.5 yards instead of 1.9 (sacks about 1.3 a team).
- Fumble chance per tackle 0.03 (was 0.012). Open-field tackle base 0.535 (was 0.6). Run blocks hold longer.
- Back Swing: the deep route is now a hook; the play was gaining 1.75 times the playbook average in games.
- A call for a play outside the book is refused before the officials are consulted.
- Game results differ from 0.7.x for the same seed and calls.

### Known gaps
- Scoring between two even teams is 17 points a team, at the low end of the target range.
- The balance ceiling for one play is now 1.6 times the playbook average (was 1.5); Flood sits at 1.51.
- Returns are animated from the result, not simulated player by player: no blocks or tackles are decided on them.
- No penalties on kicks or after the play, no declined-penalty choice for the coach, no player discipline rating.
- The scorecard's ranges come from general knowledge of the high school game, not from a data set.

## 0.7.1 — 2026-11-26

### Added
- Overtime (`RULES.overtimeFrom`, `RULES.overtimePeriods`, `Game.overtime`). A game level after regulation gives
  each team a series from the ten, first and goal, with no clock, kickoffs or punts by the AI. Up to four periods.
- A call made as regulation runs out is discarded when that run-off starts overtime.

### Changed
- Games that end level in regulation now continue, so their results differ from 0.7.0. Games decided in
  regulation are unchanged (fingerprints checked in `overtime.test.ts`).

### Known gaps
- With short quarters about one overtime game in five uses all four periods; a few still end level.

## 0.7.0 — 2026-11-26

Dynasty with friends.

### Added
- `packages/online/src/shared.ts`: a shared league as pure state transitions. Coaches claim schools, the
  commissioner starts the season, AI-only games are simulated one per check-in, the week closes when every game
  is in, the commissioner can force a week, and a title is credited to its coach exactly once.
- League game rooms: the two schools are rebuilt from league details carried in the room; the home school is
  team 0; quarter length and weather come from the league. A game between two coaches starts only when both
  have checked in within eight seconds of each other. A game against an AI school seats `AI_COACH`.
- API actions `leagueCreate`, `league`, `leagueClaim`, `leagueStart`, `leagueForce`, `leagueNext`, `leaguePlay`.
- Store methods `createLeague`, `withLeague`, `addChampionship`; migration `0003_fnd_leagues.sql`.
- `@fnd/league`: `addResult`, `closeWeek`, `weekComplete`, `recordOf`.
- Client: shared-league screen, league row in the online box, `check:league` (two browsers).

### Fixed
- The ball carrier jumped up to six yards forward at the tackle. The fall is now played out over a few ticks.
  Results, yardage and game fingerprints are unchanged.
- An online test assumed the turn after a rejoin was never a kickoff; it failed about one run in five.

### Known gaps
- A league has one season history but no per-coach history across seasons beyond the career record.
- A coach cannot join a league after its season has started, or hand over a school.
- Leagues are found only by code; there is no list of the leagues a coach is in beyond the last one opened.
- Not tested against the live server.

## 0.6.0 — 2026-11-26

Dynasty, special teams, game setup and cut-ins.

### Added
- `packages/league`: state league generator (50 states, eight invented schools each), round-robin schedule,
  standings, a championship between first and second, prestige that moves with results, per-game weather by
  region and week, and a validated save format. Pure and deterministic.
- Solo dynasty screen (`apps/client/src/dynasty.ts`), saved in the browser under `fnd.dynasty.v1`.
- Kickoff decision `{ kind: 'kickoff', style }` with deep, squib and onside kicks. A `null` kickoff decision still
  means deep, so older game logs replay unchanged.
- `DefDecision.block`: on fourth down, a chance to block a punt or field goal, a risk of a flag, and a defense
  caught out of position by a real play.
- Online: the kickoff is a turn for the kicking coach (`need.phase` "kickoff", 20 seconds).
- `GameSetup`: quarter length (4 to 12 minutes) and weather (clear, rain, wind, snow, heat). Chosen by the host
  online and carried in the room.
- Cut-in panels cut from the creative director's sheets by `tools/cut-art.py`; weather overlay on the field.
- Tests: `special.test.ts`, `setup.test.ts`, `league.test.ts` (including 30 simulated seasons). `check:dynasty`.

### Known gaps
- Dynasty is solo only. Dynasty with friends is not built.
- No overtime: league games can end tied; a tied championship goes to the home team.
- Dynasty rosters are regenerated each year from the school's prestige; individual players do not carry over.
- Weather does not change player speed or footing, only catching, throwing, fumbles, kicking and fatigue.
- Cut-in art shows generic red and blue teams, not the two schools playing. Player sprites, the scoreboard
  restyle and the broadcast overlays from the sheets are not used yet.
- The field-tile sheet is not used: it carries a real league's logo.
- Everything listed under 0.4.0 and 0.5.0 still stands.

## 0.5.0 — 2026-11-25

The big playbook.

### Added
- 16 offensive plays (40 in the library, eight per formation). The starter book is the whole library.
- `BOOK_MIN` (8) and `BOOK_SIZE` (52): a book is 8 to 52 plays, so designed plays add to the 40.
- 4-4 front; Man Free, Cover 2, Zone Blitz and Prevent calls. Five fronts by eight calls is 40 defenses.
- Offense panel grouped by formation tabs. `tools/probe-all.ts` and `tools/probe-def.ts` for measuring every
  play and every defense.
- `art/source`: artwork sheets from the creative director, not yet used.

### Changed
- The AI's defensive lean is shared among the calls of a kind, so a longer call sheet does not change its mix.
  Prevent is reserved for protecting a late lead.
- The home-win balance test samples 400 games; at 200 the 45-55 band was narrower than chance.
- Playbook storage key is now `fnd.book.v2`.

### Known gaps
- New plays were tuned by measurement against the AI, not by human play. Spread Counter is weak (about 3 yards);
  Tight End Pop completes about three in four.
- Special teams are still automatic apart from punt, field goal and the extra point.
- Everything listed under 0.4.0 still stands.

## 0.4.0 — 2026-11-25

Play designer, coach careers and the Hall of Fame.

### Added
- Play designer for offense and defense (`apps/client/src/designer.ts`): drag players, assign jobs, draw paths,
  live legality messages, and a practice field that runs a design against any front and call (or any library play)
  and can show a run on the real field.
- Designed plays and defenses are plain validated data (`packages/core/src/designer.ts`). They are checked when
  loaded from the browser, again by the engine, and again by the server when a coach sits down. Up to 12 plays
  and 6 defenses per coach.
- Online games carry both coaches' designs; each browser replays them from the room and still matches the
  server's game fingerprint.
- Coach careers: games, wins, losses, ties, points, current and best winning streak, championships (always 0
  until dynasty seasons exist). A finished online game is recorded exactly once.
- Hall of Fame: `hall` API action and screen, top ten by wins, then win rate, then point margin.
- `profile` API action; record shown in the sign-in box and on the final screen.
- Migration `0002_fnd_careers.sql` (adds columns to `fnd.coaches`).
- `npm run check:designer` and an extended `check:online`. 195 automated tests.

### Changed
- Man coverage is assigned from the formation actually on the field; corners take the widest receivers.
- Handoffs and pitches need the carrier within reach of the quarterback.

### Known gaps
- Designer balance target not met: the best design found by random search gains about 2.8 times the library
  average against the AI; the target is 2 times or less.
- The live server function has still not been called from a real browser by us; the sandbox cannot reach it.
- No human playtest yet for any milestone.

## 0.3.1 — 2026-11-25

### Added
- Voice chat between the two coaches of an online game, built like the Typlympics one: audio flows directly
  between the browsers (WebRTC); the server only passes the short connection messages through a mailbox on the room.
- `voice` API action with caps on message size and count, and a presence timeout. 3 new tests (146 in all).
- `npm run check:voice`: two headless browsers with fake microphones connect, audio is confirmed arriving,
  mute works, voice carries from lobby into game, and hanging up releases the microphone.

### Known gaps
- Only free public address helpers (STUN) are used, no relay. Two coaches on strict networks may fail to connect;
  the status line says so and keeps retrying.

## 0.3.0 — 2026-11-25

Milestone 2b release candidate: online head-to-head exhibition.

### Added
- `online` package: room rules as pure state transitions (lobby, hidden calls, play clock, AI cover for an absent
  coach, sideline changes), an API router behind a storage interface, and in-memory storage for tests.
- `supabase/`: the `fnd` schema (coaches, sessions, rooms; not exposed through the public API, row level security on
  with no policies) and the `fnd` Edge Function, which is the only way in. `npm run bundle:function` bundles it.
- `client`: coach sign-in (name plus four-digit PIN), host and join by five-digit game PIN, lobby, hidden calls with
  the server's play clock, rejoin, and a sync check of the local replay against the server's fingerprint.
- Tests: 23 online tests (sign-in, lobby, hidden calls, a whole game agreeing between two browsers and the server,
  clock expiry, disconnect and rejoin, tamper resistance). 143 tests in all.
- Tools: `npm run mock:online` (the real API with in-memory storage), `npm run check:online` (two headless browsers
  play a whole game, one of them dropping out and rejoining).
- `.github/workflows/pages.yml`: typecheck, test, build and publish `site/` on every push to main.

### How results stay honest
- The server picks the seed, holds both calls until the snap, runs the play and stores the log. A browser can only
  submit a call for its own sideline and the current turn, from its own playbook.
- Each browser redraws the game from the seed and the public log and compares fingerprints with the server.

### Known gaps
- No rematch button: host a new game from the menu.
- Coach names are not filtered for offensive words.
- An absent coach is covered by the AI immediately, rather than after the 90-second pause in the original design.
- The Supabase storage adapter is exercised by the same API tests only through its in-memory twin; the deployed
  function has not been called from the build machine, which cannot reach it.

## 0.2.0 — 2026-11-25

Milestone 2 release candidate: playbooks, fronts and smarter football.

### Added
- `core`: slot-based formations (5), a 24-play library, 4 defensive fronts combined with 4 calls, 39-player rosters
  with depth charts, playbook validation. Plays, formations and fronts are all data, in the shape a play designer will write.
- `match-sim`: man coverage matched to the offensive formation at the snap, lead blockers, quarterback runs,
  fatigue (energy drains with distance and contact, tired players are slower), automatic substitution with a
  threshold and a return margin, depth chart and threshold changes as logged decisions, kneel-downs, per-team playbooks.
- `football-ai`: game plans (run-pass lean, fourth-down aggression), situational play weights by tag, front selection,
  kneel-out arithmetic, prevent defense, a two-point chart.
- `client`: playbook builder, front picker, 20-second play clock with AI fallback, sideline menu (depth chart with
  energy, game plan, substitution threshold), kneel button.
- Tests: 119 in all, including a 42-case coach suite, a 40-case on-field suite and the 200-game balance criteria.
- Tools: `npm run probe -- <playId>` (one play against every front and call), `npm run check:ui`.

### Changed
- `DefDecision` is now a front plus a call. `Team` holds a roster and depth chart instead of fixed starters.
- Retuned tackling, blocking, catching and pass rush for the larger library.

### Balance baseline (300 AI-versus-AI games rotating through all 24 plays)
- 18.7 points and 55.8 plays per team; 4.3 yards per carry; 60% completions; 0.6 sacks and 0.9 turnovers per team.
- Highest-averaging play is 1.35 times the playbook average. Home side won 51.9% of decided games.

### Known gaps
- Sacks are lower than intended (target about 2 per team). Quarterback Draw and Quick Slants are the weakest plays.
- Featured players in the game plan, and penalties, are not implemented.

## 0.1.1 — 2026-11-25

### Added
- Start screen artwork and the Friday Night Dynasty logo; the title screen shows the current version.
- `site/`: a deployable website with features, roadmap and dev notes, all driven by `site/devnotes.json`.
  The game reads the same file for its version label. `npm run build:site` rebuilds the game into `site/play/`.
- Tools: `tools/site-shots.mjs` (recaptures the website screenshots), `tools/site-check.mjs` (loads the site in Chrome).

### Changed
- Home placeholder team is now the Wildcats in navy, white and red.
- Build order revised: online head-to-head follows Milestone 2, and the league is built online-first.

## 0.1.0-m1-rc1 — 2026-11-25

Milestone 1 release candidate: coach-only exhibition football. Awaiting creative director sign-off and playtest.

### Added
- `core`: seeded random streams, integer field geometry, shared types, rules constants, starter playbook as data
  (8 offensive plays, 4 defensive calls), deterministic team generation with stable player IDs.
- `football-ai`: quarterback read, ball-carrier steering, and an AI coach (play calls, fourth downs, tries, timeouts).
- `match-sim`: 60 Hz integer play simulation with AI controlling all 22 players; game rules for downs, clock,
  scoring, kickoffs, punts, field goals, tries, safeties, turnovers and timeouts; one play event per snap or kick;
  decision log and replay; instant replay of the last play.
- `client`: Phaser field renderer with generated placeholder pixel art, title screen, play-call cards with diagrams,
  defensive calls, watch speeds (normal, fast, skip), automatic replay of scoring plays and turnovers that were
  fast-forwarded, score bug, synthesized sound, final summary.
- Tools: `npm run sim` (headless balance report), `tools/browser-check.mjs` (drives the built client in Chrome).
- Tests: determinism, seed-plus-decisions replay, scoring invariants, headless speed, banned randomness and
  package dependency rules.

### Not in this milestone
- Penalties, overtime, fatigue, substitutions, injuries, a play clock for the human coach, full box scores.
- Final art, school names and audio. Team names and colours are placeholders pending decision D11.

### Tuning baseline (200 AI-versus-AI games, equal teams)
- 19.2 points and 54.5 offensive plays per team; 62.7% completions; 1.9 sacks and 1.0 turnovers per team.
