// Screenshots the main menu and its two pages, desktop and phone width.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, w, h] of [['desk', 1000, 900], ['phone', 390, 800]]) {
  await page.setViewport({ width: w, height: h });
  await page.goto(pathToFileURL('site/play/index.html').href);
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.screenshot({ path: `${out}/menu-${name}.png` });
  await page.keyboard.press('1');
  await sleep(150);
  await page.screenshot({ path: `${out}/menu-${name}-exhibition.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('3');
  await sleep(150);
  await page.screenshot({ path: `${out}/menu-${name}-online.png` });
  console.log(name, await page.$eval('#setup', (e) => e.dataset.page));
}
console.log(JSON.stringify({ errors }));
await browser.close();
