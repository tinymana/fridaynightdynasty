# Changelog

## 0.8.0 — 2026-11-26

Penalties, a run-first retune held by a realism scorecard, and school renaming.

### Added
- Penalties (`PenaltyKind`, play type `penalty`, `PlayFlags.foul`): false start and offside before the snap,
  holding on a play the offense gained on, pass interference on an incompletion. Half the distance near a goal
  line. The officials' random stream is keyed to the snap, separate from the play's.
- `tests/realism.test.ts`: 16 measures over 150 AI games, each with a target range. `tools/realism.ts` prints them.
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
