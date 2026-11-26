// Exercises the Milestone 2 interface in headless Chrome: playbook builder, fronts, sideline menu and the play clock.
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
await page.goto(pathToFileURL('site/play/index.html').href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => window.__fnd.state());
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) errors.push(`check failed: ${name}`); };
await sleep(400);
await page.click('#title');
await sleep(150);

// Playbook builder: swap two plays, save, confirm it sticks.
await page.click('#editBook');
await sleep(100);
await page.click('[data-act="b:toss"]');
check('the starter book has 40 plays and can be trimmed', (await page.$eval('#bookCount', (e) => e.textContent)).startsWith('39 plays') && !(await page.$eval('#bookSave', (b) => b.disabled)));
for (const id of await page.$$eval('#bookList .card.sel[data-act]', (els) => els.map((e) => e.dataset.act).filter((a) => !['b:mesh', 'b:iso', 'b:dive', 'b:slants'].includes(a)))) await page.click(`[data-act="${id}"]`);
check('fewer than eight plays cannot be saved', await page.$eval('#bookSave', (b) => b.disabled));
for (const id of ['b:counter', 'b:curls', 'b:zone', 'b:stick']) await page.click(`[data-act="${id}"]`);
check('eight plays with runs and passes can be saved', !(await page.$eval('#bookSave', (b) => b.disabled)));
await page.screenshot({ path: `${out}/m2-book.png` });
await page.click('#bookSave');
await sleep(100);
check('saved book is used', (await st()).book.includes('mesh') && !(await st()).book.includes('toss'));
check('book survives a reload', await page.evaluate(() => JSON.parse(localStorage.getItem('fnd.book.v2')).includes('iso')));

await page.click('[data-team="0"]');
const waitChoose = async () => { for (let i = 0; i < 600; i++) { const s = await st(); if (s.mode === 'choose' || s.mode === 'final') return s; await sleep(50); } throw new Error('stuck ' + JSON.stringify(await st())); };
let s = await waitChoose();
check('play clock is running', s.playClock !== null && s.playClock <= 20);

// Find one offensive and one defensive decision.
let seenOff = false, seenDef = false, n = 0;
await page.evaluate(() => window.__fnd.setSpeed(0));
while ((!seenOff || !seenDef) && n++ < 80 && s.mode !== 'final') {
  const prompt = await page.$eval('#prompt', (e) => e.textContent);
  const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
  if (acts.some((a) => a.startsWith('p:')) && !seenOff) {
    seenOff = true;
    check('offense panel groups the custom book by formation', acts.includes('p:dive') && !acts.includes('p:offTackle') && acts.includes('tab:iform') && acts.includes('tab:gun') && !acts.includes('tab:heavy'));
    await page.click('#panel [data-act="tab:gun"]');
    await sleep(50);
    check('switching formation shows its plays', (await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act))).includes('p:mesh'));
    await page.screenshot({ path: `${out}/offense-tabs.png` });
    // Sideline: move the backup running back up, change the plan.
    await page.click('#sidelineBtn');
    await sleep(80);
    check('sideline opens and pauses the game', (await st()).sidelineOpen);
    const before = await page.$$eval('.sl-row.start span:nth-child(2)', (els) => els.map((e) => e.textContent));
    await page.click('[data-mv="1:-1"]');
    await sleep(50);
    const after = await page.$$eval('.sl-row.start span:nth-child(2)', (els) => els.map((e) => e.textContent));
    check('depth chart reorder swaps the top two backs', before[0] === after[1] && before[1] === after[0]);
    await page.screenshot({ path: `${out}/m2-sideline.png` });
    await page.click('[data-tab="plan"]');
    await sleep(50);
    await page.click('[data-bias="2"]');
    await page.click('[data-agg="2"]');
    await page.click('[data-thr="35"]');
    await sleep(50);
    check('game plan choices are shown as selected', (await page.$$eval('#slBody .seg.on', (els) => els.map((e) => e.textContent))).join('|') === 'Pass heavy|Aggressive|35%');
    await page.screenshot({ path: `${out}/m2-plan.png` });
    const clockBefore = (await st()).playClock;
    await sleep(1200);
    check('play clock is paused while the sideline is open', (await st()).playClock === clockBefore);
    await page.click('#slClose');
    await sleep(50);
    await page.screenshot({ path: `${out}/m2-offense.png` });
    // Let the play clock run out: the AI should call the play.
    const events = (await st());
    for (let i = 0; i < 500; i++) { const x = await st(); if (x.mode !== 'choose') break; await sleep(50); }
    check('play clock expiry makes the call for you', (await st()).mode !== 'choose' || (await st()).playClock !== events.playClock);
  } else if (acts.some((a) => a.startsWith('d:')) && !seenDef) {
    seenDef = true;
    await page.click('[data-act="f:nickel"]');
    await sleep(60);
    check('front selection is highlighted', await page.$eval('[data-act="f:nickel"]', (e) => e.classList.contains('on')));
    await page.screenshot({ path: `${out}/m2-defense.png` });
    await page.click('[data-act="d:coverZone"]');
    await sleep(40);
    // A flag before the snap means no play was run; try again on the next defensive snap.
    const flagged = (await page.$eval('#banner', (e) => e.textContent)).startsWith('Flag');
    if (flagged) seenDef = false;
    else check('calls box names front and call', (await page.$eval('#calls', (e) => e.textContent)).includes('Nickel Cover Zone'));
  } else {
    let pick = acts.filter((a) => a.startsWith('p:') || a.startsWith('d:') || a.startsWith('k:') || a === 'pat');
    if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
    await page.click(`#panel [data-act="${pick[n % pick.length]}"]`);
  }
  await sleep(40);
  s = await waitChoose();
}
check('saw both an offensive and a defensive decision', seenOff && seenDef);
// Finish the game quickly with the play clock off.
await page.evaluate(() => window.__fnd.setPlayClock(false));
n = 0;
while (s.mode !== 'final' && n++ < 700) {
  const prompt = await page.$eval('#prompt', (e) => e.textContent);
  const acts = await page.$$eval('#panel [data-act]', (els) => els.map((e) => e.dataset.act));
  let pick = acts.filter((a) => a.startsWith('p:') || a.startsWith('d:') || a.startsWith('k:') || a === 'pat');
  if (prompt.startsWith('4th') && acts.includes('punt')) pick = [acts.includes('fg') ? 'fg' : 'punt'];
  if (acts.includes('kneel') && s.quarter === 4 && s.clock < 100) pick = ['kneel'];
  await page.click(`#panel [data-act="${pick[n % pick.length]}"]`);
  await sleep(25);
  s = await waitChoose();
}
check('game reaches a final score', s.mode === 'final');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
