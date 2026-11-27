import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h] of [[1440, 900], [1000, 700]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.goto(pathToFileURL('/home/claude/fridaynightdynasty/site/play/index.html').href + '?lowres');
  await new Promise((r) => setTimeout(r, 600)); await page.click('#title'); await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `/tmp/fnd-shots/menu-wide-${w}.png` });
  await page.close();
}
await browser.close();
