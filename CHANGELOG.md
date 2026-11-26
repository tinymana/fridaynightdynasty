# Changelog

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
