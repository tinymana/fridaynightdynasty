// Plays a solo dynasty in headless Chrome: start one, coach a game, let the assistant coach the rest, win or lose the title, start year 2, reload.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1100 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(`check failed: ${name}`); };
const text = (sel) => page.$eval(sel, (e) => e.textContent);
const waitFor = async (f, ms = 60000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await sleep(100); } return false; };
try {
  await page.goto(pathToFileURL('site/play/index.html').href);
  await sleep(400);
  await page.click('#title');
  await sleep(150);
  await page.select('#quarterPick', '4');
  await page.click('#dynastyBtn');
  await page.select('#dyState', 'OH');
  await sleep(100);
  check('eight schools are offered for the state', (await page.$$('#dyBody [data-school]')).length === 8 && (await text('#dyBody')).includes('Ohio league'));
  const before = await text('#dyBody .dy-pick');
  await page.click('#dyShuffle');
  await sleep(100);
  check('drawing new schools changes the league', (await text('#dyBody .dy-pick')) !== before);
  await page.screenshot({ path: `${out}/dynasty-new.png` });
  await page.click('#dyBody [data-school="2"]');
  await sleep(150);
  let s = await st();
  check('the dynasty starts in year 1, week 1', s.dynasty && s.dynasty.year === 1 && s.dynasty.week === 0 && s.dynasty.user === 2);
  check('standings list all eight schools', (await page.$$('#dyBody table tr')).length === 9);
  await page.screenshot({ path: `${out}/dynasty-week1.png` });

  // Coach week 1.
  await page.click('#dyPlay');
  await page.evaluate(() => { window.__fnd.setSpeed(0); window.__fnd.setPlayClock(false); });
  check('the game is played with the dynasty quarter length', (await st()).setup.quarterMinutes === 4);
  for (let i = 0; i < 20000; i++) {
    s = await st();
    if (s.mode === 'final') break;
    if (s.mode === 'choose') {
      const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
      const prompt = await text('#prompt');
      let pick = acts.filter((a) => a.startsWith('p:') || a.startsWith('d:') || a.startsWith('k:') || a === 'pat');
      if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
      if (pick.length) await page.click(`#panel [data-act="${pick[i % pick.length]}"]`).catch(() => {});
    }
    await sleep(15);
  }
  check('the coached game reaches the final whistle', (await st()).mode === 'final');
  check('the league catches up after the game', await waitFor(async () => (await st()).dynasty.week === 1));
  check('the button returns to the dynasty', (await text('#again')) === 'Back to the dynasty');
  await page.click('#again');
  await sleep(150);
  s = await st();
  check('week 1 has four results recorded', s.dynasty.results === 4 && (await text('#dyBody')).includes('Week 1 results'));
  await page.screenshot({ path: `${out}/dynasty-standings.png` });

  // The assistant coaches the rest of the season.
  for (let w = 1; w <= 7; w++) {
    await page.click('#dySim');
    check(`${w === 7 ? 'the championship' : `week ${w + 1}`} is played`, await waitFor(async () => (await st()).dynasty.week === w + 1, 120000));
    await sleep(100);
  }
  s = await st();
  check('the season ends with 29 games and one champion', s.dynasty.results === 29 && s.dynasty.history === 1 && /champions/.test(await text('#dyBody')));
  await page.screenshot({ path: `${out}/dynasty-champion.png` });
  await page.click('#dyNext');
  await sleep(150);
  s = await st();
  check('year 2 starts fresh with the trophy case kept', s.dynasty.year === 2 && s.dynasty.week === 0 && s.dynasty.results === 0 && (await text('#dyBody')).includes('Trophy case'));
  await page.reload();
  await sleep(400);
  await page.click('#title');
  await sleep(150);
  s = await st();
  check('the dynasty survives a reload', s.dynasty && s.dynasty.year === 2 && s.dynasty.history === 1 && (await text('#dynastyBtn')) === 'Continue dynasty');
  check('the menu shows the career line', /year 2/.test(await text('#dynastyLine')));
  // An exhibition game still works after a dynasty game.
  await page.click('[data-team="1"]');
  await sleep(200);
  check('an exhibition can still be started', (await st()).mode !== 'menu' && (await text('#s0 .ab')).includes('MCW'));
} catch (e) {
  errors.push(String(e));
} finally {
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}
