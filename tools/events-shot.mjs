// Screenshots of the team news and the program with players out. Run: node tools/events-shot.mjs
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1100 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
await page.goto(pathToFileURL('site/play/index.html').href + '?lowres');
await sleep(400); await page.click('#title'); await sleep(150);
await page.select('#quarterPick', '4');
await page.click('#dynastyBtn'); await page.select('#dyState', 'OH'); await sleep(100);
const job = await page.$eval('#dyBody .job [data-school]', (e) => e.dataset.school);
await page.click(`#dyBody [data-school="${job}"]`); await sleep(150);
for (let w = 1; w <= 5; w++) { await page.click('#dySim'); for (let t = 0; t < 600 && (await st()).dynasty.week !== w; t++) await sleep(100); await sleep(80); }
await page.screenshot({ path: '/tmp/fnd-shots/events-season.png', fullPage: true });
const news = await page.$$eval('#dyBody .dy-game', (els) => els.map((e) => e.textContent).filter((t) => /camp|After week/.test(t)));
await page.click('#dyProgram'); await sleep(150);
await page.screenshot({ path: '/tmp/fnd-shots/events-program.png', fullPage: true });
const tags = await page.$$eval('#dyBody .tag-out, #dyBody .tag-new, #dyBody .tag-star', (els) => els.map((e) => e.textContent));
console.log(JSON.stringify({ news, tags, errors }, null, 1));
await browser.close();
