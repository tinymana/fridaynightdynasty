// Screenshots of the game book: each tab for a league game, opened from the dynasty page. Run: node tools/book-shot.mjs
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1100 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(`check failed: ${name}`); };
await page.goto(pathToFileURL('site/play/index.html').href + '?lowres');
await sleep(400); await page.click('#title'); await sleep(150);
await page.select('#quarterPick', '8');
await page.click('#dynastyBtn'); await page.select('#dyState', 'TX'); await sleep(100);
const job = await page.$eval('#dyBody .job [data-school]', (e) => e.dataset.school);
await page.click(`#dyBody [data-school="${job}"]`); await sleep(150);
await page.click('#dySim'); for (let t = 0; t < 600 && (await st()).dynasty.week !== 1; t++) await sleep(100); await sleep(100);
check('three other games offer a game book and my own does not', (await page.$$('#dyBody [data-book]')).length === 3);
await page.click('#dyBody [data-book]'); await sleep(200);
const final = await page.$eval('#dyBody .result', (e) => e.textContent);
const total = await page.$$eval('#dyBook .gb-line tr', (rows) => rows.slice(1).map((r) => r.lastElementChild.textContent));
check('the points by quarter add up to the score shown', final.includes(total[0]) && final.includes(total[1]));
for (const tab of ['summary', 'box', 'drives', 'plays']) {
  await page.click(`#dyBook [data-gb="${tab}"]`); await sleep(120);
  await page.screenshot({ path: `/tmp/fnd-shots/book-${tab}.png` });
}
check('the play-by-play starts with the opening kickoff', (await page.$eval('#dyBook .gb-play', (e) => e.textContent)).includes('Kickoff'));
check('the box score names its players', !(await page.$eval('#dyBook', (e) => e.textContent)).includes('Unknown'));
await page.click('#bkBack'); await sleep(100);
check('back returns to the season', (await page.$$('#dyBody #dySim, #dyBody #dyPlay')).length > 0);
console.log(errors.length ? `errors: ${errors.join('; ')}` : 'errors: none');
await browser.close();
