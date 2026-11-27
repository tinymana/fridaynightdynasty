// Exercises the play designer in headless Chrome: draw a play, check legality, practise it, save it, carry it into a game.
import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/fnd-shots';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1200 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(`check failed: ${name}`); };
const text = (sel) => page.$eval(sel, (e) => e.textContent);
const centre = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
try {
  await page.goto(`${pathToFileURL('site/play/index.html').href}?lowres`);
  await sleep(400);
  await page.click('#title');
  await sleep(150);
  await page.click('#editBook');
  await page.click('#newPlay');
  await sleep(100);
  check('a new play starts out legal', (await text('#dsProblems')).startsWith('Legal pass play'));

  // Drag a lineman into the backfield: only six on the line, so the play is illegal and cannot be saved.
  const [lx, ly] = await centre('#dsField rect[data-i]');
  await page.mouse.move(lx, ly); await page.mouse.down(); await page.mouse.move(lx, ly + 60, { steps: 4 }); await page.mouse.up();
  await sleep(50);
  const bad = await text('#dsProblems');
  check('an illegal formation is explained in words', bad.length > 10 && !bad.startsWith('Legal'));
  check('an illegal play cannot be saved', await page.$eval('#dsSave', (b) => b.disabled));
  await page.screenshot({ path: `${out}/designer-illegal.png` });
  const [mx, my] = await centre('#dsField rect[data-i]');
  await page.mouse.move(mx, my); await page.mouse.down(); await page.mouse.move(lx, ly, { steps: 4 }); await page.mouse.up();
  await sleep(50);
  check('dragging him back makes it legal again', (await text('#dsProblems')).startsWith('Legal'));

  // Give the selected receiver a new route by clicking the field.
  const wr = await page.evaluateHandle(() => [...document.querySelectorAll('#dsField g[data-i]')].find((g) => g.textContent === 'WR'));
  const wb = await wr.boundingBox();
  await page.mouse.click(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await sleep(50);
  await page.click('#dsSide [data-job="route"]');
  const f = await (await page.$('#dsField')).boundingBox();
  await page.mouse.click(f.x + f.width * 0.5, f.y + f.height * 0.2);
  await sleep(50);
  check('a clicked point extends the route', (await page.$$eval('#dsField polyline', (l) => l.length)) >= 1 && (await text('#dsProblems')).startsWith('Legal'));
  await page.$eval('#dsName', (e) => { e.value = ''; });
  await page.type('#dsName', 'Wildcat Special');
  await page.click('#dsRun');
  await sleep(200);
  const stats = await text('#dsStats');
  check('the practice field reports results', /Average gain/.test(stats) && /practice runs/.test(stats));
  console.log('   practice:', stats.replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: `${out}/designer-offense.png` });

  await page.click('#dsWatch');
  for (let i = 0; i < 400 && !(await st()).practice?.done; i++) await sleep(50);
  await sleep(200);
  check('a practice run plays out on the field', (await st()).practice?.done === true && (await text('#banner')).includes('Practice run 1'));
  await page.screenshot({ path: `${out}/designer-watch.png` });
  await page.click('#prBack');
  await page.click('#dsSave');
  await sleep(100);
  check('the saved play appears under My plays', (await st()).myPlays === 1 && (await text('#bookList')).includes('Wildcat Special'));

  // A defense: make everyone drop, which no pressure call can claim; then save a legal one.
  await page.click('#newDef');
  await sleep(100);
  check('a new defense starts out legal', (await text('#dsProblems')).startsWith('Legal defense'));
  check('pressure needs five rushers', await page.$eval('#dsSide [data-kind="blitz"]', (b) => b.disabled));
  const lb = await page.evaluateHandle(() => [...document.querySelectorAll('#dsField g[data-i]')].find((g) => g.textContent === 'LB'));
  const lbb = await lb.boundingBox();
  await page.mouse.click(lbb.x + lbb.width / 2, lbb.y + lbb.height / 2);
  await sleep(50);
  await page.click('#dsSide [data-job="rush"]');
  await sleep(50);
  check('adding a rusher unlocks pressure', !(await page.$eval('#dsSide [data-kind="blitz"]', (b) => b.disabled)));
  await page.click('#dsSide [data-kind="blitz"]');
  await page.$eval('#dsName', (e) => { e.value = ''; });
  await page.type('#dsName', 'Stag Hunter');
  await page.click('#dsRun');
  await sleep(300);
  check('defense practice reports yards allowed', /Yards allowed/.test(await text('#dsStats')));
  await page.screenshot({ path: `${out}/designer-defense.png` });
  await page.click('#dsSave');
  await sleep(100);
  check('the saved defense appears under My defenses', (await st()).myDefs === 1 && (await text('#bookList')).includes('Stag Hunter'));

  // Put the play in the book.
  const id = await page.$eval('.mine [data-act]', (e) => e.dataset.act);
  await page.click('[data-act="b:toss"]');
  await page.click(`[data-act="${id}"]`);
  check('a book with a designed play can be saved', !(await page.$eval('#bookSave', (b) => b.disabled)));
  await page.screenshot({ path: `${out}/designer-book.png` });
  await page.click('#bookSave');
  await page.reload();
  await sleep(400);
  await page.click('#title');
  await sleep(150);
  const s0 = await st();
  check('designs and the book survive a reload', s0.myPlays === 1 && s0.myDefs === 1 && s0.book.includes(id.slice(2)));

  // Call both in a game.
  await page.click('#goExhibition').catch(() => {}); await page.click('[data-team=\"0\"]');
  await page.evaluate(() => { window.__fnd.setSpeed(0); window.__fnd.setPlayClock(false); });
  let usedOff = false, usedDef = false;
  for (let i = 0; i < 4000 && !(usedOff && usedDef); i++) {
    const s = await st();
    if (s.mode === 'final') break;
    if (s.mode !== 'choose') { await sleep(20); continue; }
    let acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
    if (acts.includes('tab:@mine') && !acts.includes(`p:${id.slice(2)}`)) { await page.click('#panel [data-act="tab:@mine"]'); acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act)); }
    const pick = acts.includes('snap') ? 'snap' : acts.includes(`p:${id.slice(2)}`) ? `p:${id.slice(2)}` : acts.find((a) => a.startsWith('m:')) ?? (acts.includes('f:@custom') ? 'f:@custom' : acts.includes('pat') ? 'pat' : acts.find((a) => a.startsWith('d:')) ?? acts[0]);
    await page.click(`#panel [data-act="${pick}"]`).catch(() => {});
    if (pick.startsWith('p:c_')) { usedOff = true; await sleep(30); check('the designed play is named when called', (await text('#panel')).includes('Wildcat Special') || (await text('#calls')).includes('Wildcat Special')); }
    // A flag or the end of a quarter before the snap means the call was never run: wait for one that is.
    if (pick.startsWith('m:') && !usedDef) { await sleep(30); if ((await text('#calls')).includes('Stag Hunter') || (await text('#panel')).includes('Stag Hunter')) { usedDef = true; check('the designed defense is named when called', true); } }
    await sleep(20);
  }
  check('designed play and defense were both called in a game', usedOff && usedDef);
  await page.screenshot({ path: `${out}/designer-game.png` });
} catch (e) {
  errors.push(String(e));
} finally {
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}
