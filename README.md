# Friday Night Dynasty

A coach-only high school football dynasty simulator by Tiny Mana Studios. You call the plays; the players carry them out.

Current state: **Milestone 1 release candidate** (exhibition game). See `CHANGELOG.md`.

## Run it

    npm install
    npm run dev        # play in the browser with hot reload
    npm run build      # single-file build in dist/index.html
    npm test           # automated tests
    npm run sim -- 200 # 200 headless AI-versus-AI games with a balance report
    node tools/browser-check.mjs   # after a build: plays a full game in headless Chrome

## Layout

    packages/core         IDs, seeded randomness, geometry, types, rules, playbook data, team generation
    packages/football-ai  on-field decisions and the AI coach          (depends on core)
    packages/match-sim    play simulation, game rules, play events     (depends on core, football-ai)
    apps/client           Phaser renderer and coach interface          (depends on everything)
    tools/                headless runner and browser check
    tests/                automated tests

## Rules every simulation package follows

- No `Math.random`, `Date.now` or timers. All randomness comes from named seeded streams in `core`.
- Positions are integers (256 units to a yard) on a fixed 60 Hz step. No trigonometric or power functions.
- A game is fully described by its seed and its list of coaching decisions. Replaying them reproduces every play.
- Statistics are derived only from play events.

`tests/rules.test.ts` enforces the first two and the package dependency table.

## Releasing an update

1. Add an entry at the top of `site/devnotes.json` (version, date, title, items tagged new, improved or fixed).
   Update a roadmap item's `status` there when a milestone moves (done, testing, next, planned).
2. Add the matching section to `CHANGELOG.md` and bump `version` in `package.json`.
3. Run `npm test`, then `npm run build:site`. Optionally `node tools/site-shots.mjs` to refresh the screenshots.
4. Deploy the `site/` folder to any static host (it includes a `_headers` file for Cloudflare Pages and Netlify).
