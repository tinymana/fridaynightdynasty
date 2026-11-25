# Changelog

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
