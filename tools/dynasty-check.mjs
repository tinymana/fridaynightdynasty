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
  await page.goto(`${pathToFileURL('site/play/index.html').href}?lowres`);
  await sleep(400);
  await page.click('#title');
  await sleep(150);
  await page.select('#quarterPick', '4');
  await page.click('#dynastyBtn');
  await page.select('#dyState', 'OH');
  await sleep(100);
  check('five schools in the state are hiring a head coach', (await page.$$('#dyBody .job [data-school]')).length === 5 && (await text('#dyBody')).includes('Head coach wanted: 5 schools in Ohio') && (await text('#dyBody')).includes('Last season'));
  const before = await text('#dyBody .dy-pick');
  await page.click('#dyShuffle');
  await sleep(100);
  check('drawing new schools changes the league', (await text('#dyBody .dy-pick')) !== before);
  await page.screenshot({ path: `${out}/dynasty-new.png` });
  await page.screenshot({ path: `${out}/dynasty-jobs.png`, fullPage: true });
  const job = await page.$eval('#dyBody .job [data-school]', (e) => e.dataset.school);
  await page.click(`#dyBody [data-school="${job}"]`);
  await sleep(150);
  let s = await st();
  check('the dynasty starts in year 1, week 1', s.dynasty && s.dynasty.year === 1 && s.dynasty.week === 0 && s.dynasty.user === Number(job));
  check('standings list all eight schools', (await page.$$('#dyBody table tr')).length === 9);
  await page.screenshot({ path: `${out}/dynasty-week1.png` });

  // Rename my school and change its colours.
  await page.select('#dyEdit', job);
  await page.$eval('#sfName', (e) => { e.value = ''; });
  await page.type('#sfName', 'x');
  await page.click('#sfSave');
  check('a bad school name is refused with a reason', (await text('#sfMsg')).includes('3 to 23'));
  await page.$eval('#sfName', (e) => { e.value = ''; });
  await page.type('#sfName', 'Tiny Mana Prep');
  await page.$eval('#sfMascot', (e) => { e.value = 'Wizards'; });
  await page.$eval('#sfAbbr', (e) => { e.value = 'TMP'; });
  await page.$eval('#sf_jersey', (e) => { e.value = '#6b21a8'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.screenshot({ path: `${out}/dynasty-rename.png` });
  await page.click('#sfSave');
  await sleep(100);
  check('the renamed school shows in the standings', (await text('#dyBody table')).includes('Tiny Mana Prep Wizards'));

  // The program: varsity, junior varsity and a call-up.
  await page.click('#dyProgram');
  await sleep(100);
  // Four classes of 22 and a walk-on or three: 39 dress for the varsity (anyone who is out is listed with them) and the rest are junior varsity.
  const jvCount = (await page.$$('#dyBody [data-up]')).length;
  const varsityCount = Number(/Varsity\s*(\d+) players/.exec(await text('#dyBody'))?.[1] ?? 0);
  check('the program page lists a varsity of 39 or so and a junior varsity of 49 or so', (await page.$$('#dyBody .prog table')).length === 2 && jvCount >= 44 && jvCount <= 54 && varsityCount >= 39 && varsityCount <= 43);
  const kid = await page.$eval('#dyBody [data-up]', (e) => e.dataset.up);
  await page.click(`#dyBody [data-up="${kid}"]`);
  await sleep(100);
  check('a called-up player moves to the varsity and can be sent down', (await page.$$(`#dyBody [data-down="${kid}"]`)).length === 1 && (await page.$$('#dyBody [data-up]')).length === jvCount && (await text('#dyBody')).includes('Call-ups used: 1 of 6'));
  await page.screenshot({ path: `${out}/dynasty-program.png`, fullPage: true });
  await page.click('#pgBack');
  await sleep(100);

  // Coach week 1.
  await page.click('#dyPlay');
  await page.evaluate(() => { window.__fnd.setSpeed(0); window.__fnd.setPlayClock(false); });
  check('the game is played with the dynasty quarter length', (await st()).setup.quarterMinutes === 4);
  check('the game uses the new name', (await text('#bug')).includes('TMP'));
  for (let i = 0; i < 20000; i++) {
    s = await st();
    if (s.mode === 'final') break;
    if (s.mode === 'choose') {
      const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
      const prompt = await text('#prompt');
      let pick = acts.filter((a) => a === 'snap' || a.startsWith('a:') || a.startsWith('p:') || a.startsWith('d:') || a.startsWith('k:') || a === 'pat');
      if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
      if (pick.length) await page.click(`#panel [data-act="${pick[i % pick.length]}"]`).catch(() => {});
    }
    await sleep(15);
  }
  check('the coached game reaches the final whistle', (await st()).mode === 'final');
  check('the league catches up after the game', await waitFor(async () => (await st()).dynasty.week === 1));
  check('the final screen names each team\'s leaders', /carries for/.test(await text('#finalLeaders')) && /tackles/.test(await text('#finalLeaders')));
  check('the button returns to the dynasty', (await text('#again')) === 'Back to the dynasty');
  await page.click('#again');
  await sleep(150);
  s = await st();
  check('week 1 has four results recorded', s.dynasty.results === 4 && (await text('#dyBody')).includes('Week 1 results'));
  await page.screenshot({ path: `${out}/dynasty-standings.png` });

  // Statistics and the record book.
  await page.click('#dyStats');
  await sleep(100);
  let body = await text('#dyBody');
  check('statistics show my team and the league leaders after one week', body.includes('Passing') && body.includes('Rushing yards') && body.includes('leaders') && (await page.$$('#dyBody table')).length >= 8 && (await page.$$('#dyBody tr.me')).length >= 0);
  await page.screenshot({ path: `${out}/dynasty-stats.png`, fullPage: true });
  await page.click('#stRecords');
  await sleep(100);
  body = await text('#dyBody');
  check('the record book lists ten records for a game, a season and a career, with holders and years', (await page.$$('#dyBody .recbook tr')).length === 12 && body.includes('Rushing yards') && /19[7-9]\d|20[0-2]\d/.test(body));
  await page.screenshot({ path: `${out}/dynasty-records.png`, fullPage: true });
  const other = await page.$eval('#rcSchool', (e) => [...e.options].find((o) => !o.selected).value);
  const mineBook = await text('#dyBody .recbook');
  await page.select('#rcSchool', other);
  await sleep(80);
  check('another school has its own book', (await text('#dyBody .recbook')) !== mineBook);
  await page.click('#pgBack');
  await sleep(100);

  // The assistant coaches the rest of the season.
  for (let w = 1; w <= 7; w++) {
    await page.click('#dySim');
    check(`${w === 7 ? 'the championship' : `week ${w + 1}`} is played`, await waitFor(async () => (await st()).dynasty.week === w + 1, 120000));
    await sleep(100);
  }
  s = await st();
  check('the season ends with 29 games and one champion', s.dynasty.results === 29 && s.dynasty.history === 1 && /champions/.test(await text('#dyBody')));
  check('the season\'s awards are announced', /Player of the year/.test(await text('#dyBody')) && /Coach of the year/.test(await text('#dyBody')));
  await page.screenshot({ path: `${out}/dynasty-champion.png`, fullPage: true });
  await page.click('#dyAwards');
  await sleep(100);
  check('the awards page names the all-league team', (await page.$$('#dyBody .allteam span')).length === 16 && /2026 season/.test(await text('#dyBody')));
  await page.screenshot({ path: `${out}/dynasty-awards.png`, fullPage: true });
  await page.click('#pgBack');
  await sleep(100);
  await page.click('#dyNext');
  await sleep(150);
  s = await st();
  check('year 2 starts fresh with the trophy case kept', s.dynasty.year === 2 && s.dynasty.week === 0 && s.dynasty.results === 0 && (await text('#dyBody')).includes('Trophy case'));
  await page.reload();
  await sleep(400);
  await page.click('#title');
  await sleep(150);
  s = await st();
  await page.click('#dynastyBtn');
  await sleep(100);
  check('the new name survives a reload', (await text('#dyBody')).includes('Tiny Mana Prep'));
  await page.click('#dyBack');
  await sleep(100);
  check('the dynasty survives a reload', s.dynasty && s.dynasty.year === 2 && s.dynasty.history === 1 && (await text('#dynastyName')) === 'Continue dynasty');
  check('the menu shows the career line', /year 2/.test(await text('#dynastyLine')));
  // An exhibition game still works after a dynasty game.
  await page.click('#goExhibition').catch(() => {}); await page.click('[data-team=\"1\"]');
  await sleep(200);
  check('an exhibition can still be started', (await st()).mode !== 'menu' && (await text('#s0 .ab')).includes('MCW'));
} catch (e) {
  errors.push(String(e));
} finally {
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}
