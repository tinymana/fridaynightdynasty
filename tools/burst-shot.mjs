// Shows each move call-out over the field so the bursts can be looked at without waiting for a broken tackle.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 900 });
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(600); await page.click('#title'); await sleep(150); await page.click('#goExhibition'); await page.click('[data-team="0"]');
await sleep(1500);
const kinds = [['juke', 'JUKE!', 22], ['truck', 'TRUCKED!', 35], ['stiffArm', 'STIFF ARM!', 4], ['spin', 'SPIN!', 28], ['dive', 'DIVES!', 41]];
const stage = await page.$('#stage');
for (const [k, word, n] of kinds) {
  await page.evaluate((k, word, n) => {
    const el = document.getElementById('moveTag');
    el.innerHTML = `<span class="burst"><b>${word}</b><small>#${n}</small></span>`;
    el.className = `k-${k}`;
    el.style.left = '50%';
    el.style.top = '40%';
  }, k, word, n);
  await sleep(450);
  const box = await stage.boundingBox();
  await page.screenshot({ path: `/tmp/fnd-shots/burst-${k}.png`, clip: { x: box.x + box.width / 2 - 150, y: box.y + box.height * 0.4 - 90, width: 300, height: 180 } });
}
await page.evaluate(() => { document.getElementById('moveTag').classList.add('hidden'); window.__fnd.band(true, true); });
await sleep(1800);
await stage.screenshot({ path: '/tmp/fnd-shots/band.png' });
await browser.close();
