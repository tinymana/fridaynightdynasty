// Photographs the letter grades on the program page and the sideline depth chart, at phone and desk size. Run: node tools/grades-shot.mjs
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = []; const facts = {};
for (const [tag, vp] of [['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['desk', { width: 1100, height: 900 }]]) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport(vp);
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  await page.goto(pathToFileURL('site/play/index.html').href + '?lowres');
  await sleep(400); await page.click('#title'); await sleep(150);
  await page.click('#dynastyBtn'); await page.select('#dyState', 'OH'); await sleep(100);
  const job = await page.$eval('#dyBody .job [data-school]', (e) => e.dataset.school);
  await page.click(`#dyBody [data-school="${job}"]`); await sleep(150);
  await page.click('#dyProgram'); await sleep(150);
  await page.screenshot({ path: `/tmp/fnd-shots/gr-${tag}-program.png`, clip: { x: 0, y: 0, width: vp.width, height: 1500 } });
  facts[`${tag} grades`] = [...new Set(await page.$$eval('#dyBody td .gr', (e) => e.map((x) => x.textContent)))].length;
  facts[`${tag} sideways`] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.reload(); await sleep(400); await page.click('#title'); await sleep(150);
  await page.click('#goExhibition'); await sleep(150); await page.click('[data-team="0"]'); await sleep(2800);
  await page.click('#sidelineBtn'); await sleep(200);
  const grp = await page.$('#slTabs [data-tab="depth"], #slTabs button:nth-child(2)');
  facts[`${tag} tabs`] = await page.$$eval('#slTabs button', (e) => e.map((x) => x.textContent));
  for (const b of await page.$$('#slTabs button')) { if (/depth/i.test(await b.evaluate((x) => x.textContent))) await b.click(); }
  await sleep(200);
  await page.screenshot({ path: `/tmp/fnd-shots/gr-${tag}-sideline.png` });
  facts[`${tag} sideline sideways`] = await page.evaluate(() => { const b = document.querySelector('.sl-box'); return b ? b.scrollWidth - b.clientWidth : -1; });
}
console.log(JSON.stringify({ facts, errors }, null, 1));
await browser.close();
