import {
  DEFENSE_FRONTS, DEFENSE_SCHEMES, OFFENSE_PLAYS, Rng, defKindRules, draftFromFront, draftFromPlay, exhibitionTeams, formationOf, frontById,
  playFromDraft, schemeById, toFront, toScheme, validateDefPlay, validateOffPlay,
  type DefAssign, type DefDraft, type DefFront, type DefPlay, type DefScheme, type Group, type OffAssign, type OffDraft, type OffPlay, type Pt, type SchemeKind,
} from '@fnd/core';
import { Game, PlaySim } from '@fnd/match-sim';

/**
 * The play designer: drag players into place, give each a job, check the play is legal and try it on the practice field.
 * It only builds data; the engine and the server validate that data again before it is ever run.
 */

export interface DesignerHost {
  saveOffense(play: OffPlay): void;
  saveDefense(def: DefPlay): void;
  close(): void;
  /** Shows one practice run on the field. */
  watch(make: (seed: number) => PlaySim, label: string): void;
}

const SCALE = 10;
const HALF = 27;
const snap = (n: number): number => Math.round(n * 2) / 2;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Fresh starters for practice runs, the same for every design so results compare. */
const practiceTeams = exhibitionTeams(4242);
const practiceGame = new Game(4242, practiceTeams);

export function practiceSim(play: OffPlay, front: DefFront, scheme: DefScheme, seed: number): PlaySim {
  const formation = formationOf(play);
  const off = practiceGame.lineup(0, formation.slots);
  const def = practiceGame.lineup(1, front.slots);
  return new PlaySim({ play, formation, front, scheme, offPlayers: off, defPlayers: def, offEnergy: off.map(() => 100), defEnergy: def.map(() => 100), los: 30, rng: new Rng(seed) });
}

export interface PracticeStats {
  runs: number;
  yards: number;
  complete: number;
  passes: number;
  sacks: number;
  turnovers: number;
  touchdowns: number;
  firstDowns: number;
}

export function practice(pairs: { play: OffPlay; front: DefFront; scheme: DefScheme }[], runsEach: number): PracticeStats {
  const s: PracticeStats = { runs: 0, yards: 0, complete: 0, passes: 0, sacks: 0, turnovers: 0, touchdowns: 0, firstDowns: 0 };
  let n = 0;
  for (const p of pairs) for (let i = 0; i < runsEach; i++) {
    const sim = practiceSim(p.play, p.front, p.scheme, 1000 + n++ * 7919);
    while (!sim.done) sim.step();
    const r = sim.result!;
    s.runs++;
    s.yards += r.yards;
    if (r.kind === 'pass' && !r.sack) s.passes++;
    if (r.complete) s.complete++;
    if (r.sack) s.sacks++;
    if (r.turnover) s.turnovers++;
    if (r.touchdown) s.touchdowns++;
    if (r.yards >= 10) s.firstDowns++;
  }
  return s;
}

function statsHtml(s: PracticeStats, allowed: boolean): string {
  const pc = (a: number, b: number): string => (b ? `${Math.round((100 * a) / b)}%` : '–');
  return `<table class="pr"><tr><th>${allowed ? 'Yards allowed' : 'Average gain'}</th><th>Completions</th><th>Sacks</th><th>Turnovers</th><th>10+ yards</th></tr>`
    + `<tr><td><b>${(s.yards / s.runs).toFixed(1)}</b></td><td>${pc(s.complete, s.passes)}</td><td>${pc(s.sacks, s.runs)}</td><td>${pc(s.turnovers, s.runs)}</td><td>${pc(s.firstDowns, s.runs)}</td></tr></table>`
    + `<div class="sl-note">${s.runs} practice runs from your own 30, with fresh starters on both sides.</div>`;
}

const allDefenses = (): { front: DefFront; scheme: DefScheme }[] => DEFENSE_FRONTS.flatMap((front) => DEFENSE_SCHEMES.map((scheme) => ({ front, scheme })));

interface Drag {
  index: number;
  moved: boolean;
}

/** Shared field: converts between yards and SVG units, and reports drags and clicks in yards. */
function field(svg: SVGSVGElement, top: number, bottom: number, onDrag: (i: number, at: Pt) => void, onPick: (i: number) => void, onClick: (at: Pt) => void): { X: (l: number) => number; Y: (d: number) => number } {
  const X = (l: number): number => (l + HALF) * SCALE;
  const Y = (d: number): number => (top - d) * SCALE;
  svg.setAttribute('viewBox', `0 0 ${HALF * 2 * SCALE} ${(top - bottom) * SCALE}`);
  const toYards = (ev: PointerEvent): Pt => {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return [snap(top - p.y / SCALE), snap(p.x / SCALE - HALF)];
  };
  let drag: Drag | null = null;
  svg.onpointerdown = (ev) => {
    const el = (ev.target as Element).closest('[data-i]');
    if (el) {
      drag = { index: Number(el.getAttribute('data-i')), moved: false };
      svg.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    } else onClick(toYards(ev));
  };
  svg.onpointermove = (ev) => {
    if (!drag) return;
    drag.moved = true;
    onDrag(drag.index, toYards(ev));
  };
  svg.onpointerup = () => {
    if (drag && !drag.moved) onPick(drag.index);
    else if (drag) onPick(drag.index);
    drag = null;
  };
  return { X, Y };
}

const lines = (X: (l: number) => number, Y: (d: number) => number, top: number, bottom: number): string => {
  let out = `<rect x="0" y="0" width="${HALF * 2 * SCALE}" height="${(top - bottom) * SCALE}" fill="#226f30"/>`;
  for (let d = Math.ceil(bottom / 5) * 5; d <= top; d += 5) out += `<line x1="0" x2="${HALF * 2 * SCALE}" y1="${Y(d)}" y2="${Y(d)}" stroke="rgba(255,255,255,${d === 0 ? 0 : 0.18})"/>`;
  out += `<line x1="0" x2="${HALF * 2 * SCALE}" y1="${Y(0)}" y2="${Y(0)}" stroke="#4f8ef7" stroke-width="2"/>`;
  out += `<line x1="${X(-26.67)}" x2="${X(-26.67)}" y1="0" y2="${(top - bottom) * SCALE}" stroke="#fff" stroke-width="2"/><line x1="${X(26.67)}" x2="${X(26.67)}" y1="0" y2="${(top - bottom) * SCALE}" stroke="#fff" stroke-width="2"/>`;
  return out;
};

// ------------------------------------------------------------------ offense

export function openOffenseDesigner(root: HTMLElement, start: OffDraft, host: DesignerHost): void {
  const d: OffDraft = JSON.parse(JSON.stringify(start));
  let sel = d.slots.findIndex((s) => s.group === 'WR');
  let lastStats = '';
  const TOP = 26;
  const BOTTOM = -13;

  root.innerHTML = `
    <div class="ds-bar"><input id="dsName" maxlength="24" aria-label="Play name"><select id="dsFrom" aria-label="Start from a library play"><option value="">Start from…</option>${OFFENSE_PLAYS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
      <button class="seg" id="dsCancel">Cancel</button><button class="seg on" id="dsSave">Save play</button></div>
    <div class="ds-main"><svg id="dsField" class="ds-field" role="img" aria-label="Play diagram. Drag a player to move him."></svg><div class="ds-side" id="dsSide"></div></div>
    <div id="dsProblems" class="ds-problems" role="status" aria-live="polite"></div>
    <div class="ds-practice"><span class="lbl">Practice field</span><select id="dsVs" aria-label="Defense to practise against"><option value="all">Every front and call</option>${DEFENSE_FRONTS.flatMap((f) => DEFENSE_SCHEMES.map((s) => `<option value="${f.id}|${s.id}">${f.name} ${s.name}</option>`)).join('')}</select>
      <button class="seg" id="dsRun">Run it 50 times</button><button class="seg" id="dsWatch">Watch one</button></div>
    <div id="dsStats"></div>`;
  const q = <T extends Element>(id: string): T => root.querySelector(`#${id}`) as T;
  const svg = q<SVGSVGElement>('dsField');
  (q<HTMLInputElement>('dsName')).value = d.name;

  const check = () => validateOffPlay(playFromDraft(d));
  const pathPoints = (i: number): Pt[] => {
    const j = d.jobs[i];
    if (j.t !== 'route' && j.t !== 'carry' && j.t !== 'lead') return [];
    const base = d.slots[i].at;
    return j.t === 'route' ? j.pts.map((p) => [base[0] + p[0], base[1] + p[1]] as Pt) : j.pts.map((p) => [p[0], p[1]] as Pt);
  };

  const { X, Y } = field(svg, TOP, BOTTOM,
    (i, at) => {
      d.slots[i].at = [Math.min(-0.5, Math.max(-12, at[0])), Math.max(-25, Math.min(25, at[1]))];
      draw();
    },
    (i) => {
      sel = i;
      draw();
    },
    (at) => {
      const j = d.jobs[sel];
      if (!j || (j.t !== 'route' && j.t !== 'carry' && j.t !== 'lead')) return;
      const max = j.t === 'lead' ? 3 : 4;
      if (j.pts.length >= max) return;
      const base = d.slots[sel].at;
      const p: Pt = j.t === 'route' ? [at[0] - base[0], at[1] - base[1]] : at;
      d.jobs[sel] = { ...j, pts: [...j.pts, p] } as OffAssign;
      draw();
    });

  function draw(): void {
    let out = lines(X, Y, TOP, BOTTOM);
    d.slots.forEach((s, i) => {
      const j = d.jobs[i];
      const pts = pathPoints(i);
      if (pts.length) {
        const all = [s.at, ...pts];
        const colour = j.t === 'carry' ? '#f2c14e' : '#fff';
        out += `<polyline points="${all.map((p) => `${X(p[1])},${Y(p[0])}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="${j.t === 'carry' ? 4 : 2.5}" ${j.t === 'lead' ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round"/>`;
        pts.forEach((p) => { out += `<circle cx="${X(p[1])}" cy="${Y(p[0])}" r="3.5" fill="${colour}"/>`; });
        if (j.t === 'route' && j.go) {
          const a = all[all.length - 2];
          const b = all[all.length - 1];
          out += `<line x1="${X(b[1])}" y1="${Y(b[0])}" x2="${X(b[1] + (b[1] - a[1]) * 0.6)}" y2="${Y(b[0] + (b[0] - a[0]) * 0.6)}" stroke="#fff" stroke-width="2.5" stroke-dasharray="3 3"/>`;
        }
      }
    });
    d.slots.forEach((s, i) => {
      const x = X(s.at[1]);
      const y = Y(s.at[0]);
      const on = i === sel;
      const fill = d.jobs[i].t === 'carry' ? '#f2c14e' : s.group === 'QB' ? '#9fd0ff' : '#f3f1e7';
      out += s.group === 'OL'
        ? `<rect data-i="${i}" x="${x - 7}" y="${y - 7}" width="14" height="14" fill="${fill}" stroke="${on ? '#d8262c' : '#111'}" stroke-width="${on ? 3 : 1}" style="cursor:grab"/>`
        : `<g data-i="${i}" style="cursor:grab"><circle cx="${x}" cy="${y}" r="9" fill="${fill}" stroke="${on ? '#d8262c' : '#111'}" stroke-width="${on ? 3 : 1}"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9" font-weight="700" fill="#111" pointer-events="none">${s.group}</text></g>`;
    });
    svg.innerHTML = out;
    drawSide();
    const r = check();
    q<HTMLElement>('dsProblems').innerHTML = r.ok
      ? `<span class="good">Legal ${r.value.kind} play.</span>`
      : r.problems.map((p) => `<div>${esc(p)}</div>`).join('');
    (q<HTMLButtonElement>('dsSave')).disabled = !r.ok;
    q<HTMLElement>('dsSave').style.opacity = r.ok ? '1' : '0.4';
  }

  function drawSide(): void {
    const s = d.slots[sel];
    const j = d.jobs[sel];
    const skill = s.group === 'RB' || s.group === 'WR' || s.group === 'TE';
    const job = (t: string, label: string): string => `<button class="seg${j.t === t ? ' on' : ''}" data-job="${t}">${label}</button>`;
    let html = `<div class="t">Selected: ${s.group}</div>`;
    if (skill) html += `<div class="opts">${(['WR', 'TE', 'RB'] as const).map((g) => `<button class="seg${s.group === g ? ' on' : ''}" data-group="${g}">${g}</button>`).join('')}</div>`;
    html += '<div class="t">Job</div><div class="opts">';
    if (s.group === 'OL') html += job('block', 'Block');
    else if (s.group === 'QB') html += job('qb', 'Hand off or pass') + job('carry', 'Keep the ball');
    else html += job('block', 'Block') + job('route', 'Run a route') + job('carry', 'Carry the ball') + job('lead', 'Lead block');
    html += '</div>';
    if (j.t === 'route' || j.t === 'carry' || j.t === 'lead') {
      html += `<div class="sl-note">Click the field to add up to ${j.t === 'lead' ? 3 : 4} points to his path.</div><div class="opts"><button class="seg" data-path="undo">Remove last point</button><button class="seg" data-path="clear">Clear path</button>${j.t === 'route' ? `<button class="seg${j.go ? ' on' : ''}" data-path="go">Keep running</button>` : ''}</div>`;
    }
    html += `<div class="t">Quarterback</div><div class="sl-note">Drop back ${d.dropDepth} yards</div><input type="range" id="dsDrop" min="1" max="8" value="${d.dropDepth}" aria-label="Drop depth in yards">`
      + `<div class="sl-note">Starts reading after ${(d.readStart / 60).toFixed(1)} seconds</div><input type="range" id="dsRead" min="20" max="100" step="5" value="${d.readStart}" aria-label="Time before the quarterback reads">`;
    const side = q<HTMLElement>('dsSide');
    side.innerHTML = html;
    side.querySelectorAll<HTMLElement>('[data-group]').forEach((el) => el.addEventListener('click', () => {
      s.group = el.dataset.group as Group;
      draw();
    }));
    side.querySelectorAll<HTMLElement>('[data-job]').forEach((el) => el.addEventListener('click', () => {
      const t = el.dataset.job;
      if (t === 'route') d.jobs[sel] = { t: 'route', pts: [[8, 0]], go: false };
      else if (t === 'carry') {
        d.jobs.forEach((x, i) => { if (x.t === 'carry') d.jobs[i] = d.slots[i].group === 'QB' ? { t: 'qb' } : { t: 'block' }; });
        d.jobs[sel] = { t: 'carry', pts: [[2, snap(s.at[1] * 0.3)]] };
      } else if (t === 'lead') d.jobs[sel] = { t: 'lead', pts: [[2, snap(s.at[1] * 0.3)]] };
      else d.jobs[sel] = t === 'qb' ? { t: 'qb' } : { t: 'block' };
      draw();
    }));
    side.querySelectorAll<HTMLElement>('[data-path]').forEach((el) => el.addEventListener('click', () => {
      const cur = d.jobs[sel];
      if (cur.t !== 'route' && cur.t !== 'carry' && cur.t !== 'lead') return;
      if (el.dataset.path === 'go' && cur.t === 'route') d.jobs[sel] = { ...cur, go: !cur.go };
      else d.jobs[sel] = { ...cur, pts: el.dataset.path === 'undo' ? cur.pts.slice(0, -1) : [] } as OffAssign;
      draw();
    }));
    side.querySelector<HTMLInputElement>('#dsDrop')?.addEventListener('change', (ev) => { d.dropDepth = Number((ev.target as HTMLInputElement).value); draw(); });
    side.querySelector<HTMLInputElement>('#dsRead')?.addEventListener('change', (ev) => { d.readStart = Number((ev.target as HTMLInputElement).value); draw(); });
  }

  const against = (): { front: DefFront; scheme: DefScheme }[] => {
    const v = (q<HTMLSelectElement>('dsVs')).value;
    if (v === 'all') return allDefenses();
    const [f, s] = v.split('|');
    return [{ front: frontById(f), scheme: schemeById(s) }];
  };
  q<HTMLInputElement>('dsName').addEventListener('input', (ev) => { d.name = (ev.target as HTMLInputElement).value; draw(); });
  q<HTMLSelectElement>('dsFrom').addEventListener('change', (ev) => {
    const id = (ev.target as HTMLSelectElement).value;
    const p = OFFENSE_PLAYS.find((x) => x.id === id);
    if (!p) return;
    const fresh = draftFromPlay(p, d.id, d.name);
    Object.assign(d, fresh);
    sel = d.slots.findIndex((s) => s.group === 'WR' || s.group === 'RB');
    draw();
  });
  q<HTMLElement>('dsCancel').addEventListener('click', () => host.close());
  q<HTMLElement>('dsSave').addEventListener('click', () => {
    const r = check();
    if (r.ok) host.saveOffense(r.value);
  });
  q<HTMLElement>('dsRun').addEventListener('click', () => {
    const r = check();
    if (!r.ok) return;
    const pairs = against().map((x) => ({ play: r.value, ...x }));
    lastStats = statsHtml(practice(pairs, Math.max(4, Math.round(50 / pairs.length) * (pairs.length > 1 ? 4 : 1))), false);
    q<HTMLElement>('dsStats').innerHTML = lastStats;
  });
  q<HTMLElement>('dsWatch').addEventListener('click', () => {
    const r = check();
    if (!r.ok) return;
    const list = against();
    host.watch((seed) => {
      const x = list[seed % list.length];
      return practiceSim(r.value, x.front, x.scheme, seed);
    }, r.value.name);
  });
  draw();
}

// ------------------------------------------------------------------ defense

const KIND_LABEL: Record<SchemeKind, string> = { balanced: 'Balanced', run: 'Stop the run', pass: 'Stop the pass', blitz: 'Pressure' };

export function openDefenseDesigner(root: HTMLElement, start: DefDraft, host: DesignerHost): void {
  const d: DefDraft = JSON.parse(JSON.stringify(start));
  let sel = d.slots.findIndex((s) => s.group === 'LB');
  const TOP = 27;
  const BOTTOM = -4;
  const ghost = OFFENSE_PLAYS[0];

  root.innerHTML = `
    <div class="ds-bar"><input id="dsName" maxlength="24" aria-label="Defense name"><select id="dsFrom" aria-label="Start from a library defense"><option value="">Start from…</option>${DEFENSE_FRONTS.flatMap((f) => DEFENSE_SCHEMES.map((s) => `<option value="${f.id}|${s.id}">${f.name} ${s.name}</option>`)).join('')}</select>
      <button class="seg" id="dsCancel">Cancel</button><button class="seg on" id="dsSave">Save defense</button></div>
    <div class="ds-main"><svg id="dsField" class="ds-field" role="img" aria-label="Defense diagram. Drag a defender to move him."></svg><div class="ds-side" id="dsSide"></div></div>
    <div id="dsProblems" class="ds-problems" role="status" aria-live="polite"></div>
    <div class="ds-practice"><span class="lbl">Practice field</span><select id="dsVs" aria-label="Offense to practise against"><option value="all">Every library play</option>${OFFENSE_PLAYS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
      <button class="seg" id="dsRun">Run it 50 times</button><button class="seg" id="dsWatch">Watch one</button></div>
    <div id="dsStats"></div>`;
  const q = <T extends Element>(id: string): T => root.querySelector(`#${id}`) as T;
  const svg = q<SVGSVGElement>('dsField');
  (q<HTMLInputElement>('dsName')).value = d.name;
  const check = () => validateDefPlay(d);

  const { X, Y } = field(svg, TOP, BOTTOM,
    (i, at) => {
      d.slots[i].at = [Math.max(0.8, Math.min(25, at[0])), Math.max(-25, Math.min(25, at[1]))];
      draw();
    },
    (i) => {
      sel = i;
      draw();
    },
    (at) => {
      const s = d.slots[sel];
      if (s?.assign.t !== 'zone') return;
      s.assign = { t: 'zone', at: [Math.max(1, Math.min(25, at[0])), Math.max(-24, Math.min(24, at[1]))] };
      draw();
    });

  function draw(): void {
    let out = lines(X, Y, TOP, BOTTOM);
    for (const s of formationOf(ghost).slots) out += `<circle cx="${X(s.at[1])}" cy="${Y(s.at[0])}" r="5" fill="rgba(255,255,255,0.35)"/>`;
    d.slots.forEach((s) => {
      const x = X(s.at[1]);
      const y = Y(s.at[0]);
      if (s.assign.t === 'rush') out += `<line x1="${x}" y1="${y}" x2="${X(s.at[1] * 0.6)}" y2="${Y(-2)}" stroke="#ff6b6b" stroke-width="3"/>`;
      if (s.assign.t === 'zone') out += `<line x1="${x}" y1="${y}" x2="${X(s.assign.at[1])}" y2="${Y(s.assign.at[0])}" stroke="#f2c14e" stroke-width="2"/><ellipse cx="${X(s.assign.at[1])}" cy="${Y(s.assign.at[0])}" rx="42" ry="24" fill="rgba(242,193,78,0.2)" stroke="#f2c14e" stroke-dasharray="5 4"/>`;
    });
    d.slots.forEach((s, i) => {
      const x = X(s.at[1]);
      const y = Y(s.at[0]);
      const on = i === sel;
      const fill = s.assign.t === 'rush' ? '#ff6b6b' : s.assign.t === 'zone' ? '#f2c14e' : '#f3f1e7';
      out += `<g data-i="${i}" style="cursor:grab"><circle cx="${x}" cy="${y}" r="9" fill="${fill}" stroke="${on ? '#4f8ef7' : '#111'}" stroke-width="${on ? 3 : 1}"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="9" font-weight="700" fill="#111" pointer-events="none">${s.group}</text>${s.assign.t === 'read' ? `<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="#f3f1e7"/>` : ''}</g>`;
    });
    svg.innerHTML = out;
    drawSide();
    const r = check();
    q<HTMLElement>('dsProblems').innerHTML = r.ok ? `<span class="good">Legal defense: ${KIND_LABEL[r.value.kind].toLowerCase()}.</span>` : r.problems.map((p) => `<div>${esc(p)}</div>`).join('');
    (q<HTMLButtonElement>('dsSave')).disabled = !r.ok;
    q<HTMLElement>('dsSave').style.opacity = r.ok ? '1' : '0.4';
  }

  function drawSide(): void {
    const s = d.slots[sel];
    const rules = defKindRules(d.slots);
    const job = (t: DefAssign['t'], label: string): string => `<button class="seg${s.assign.t === t ? ' on' : ''}" data-job="${t}">${label}</button>`;
    let html = `<div class="t">Selected: ${s.group}</div><div class="opts">${(['DL', 'LB', 'CB', 'S'] as const).map((g) => `<button class="seg${s.group === g ? ' on' : ''}" data-group="${g}">${g}</button>`).join('')}</div>`
      + `<div class="t">Job</div><div class="opts">${job('rush', 'Rush')}${job('man', 'Cover a man')}${job('zone', 'Drop to a zone')}${job('read', 'Read the play')}</div>`;
    if (s.assign.t === 'man') html += `<div class="sl-note">Starts ${s.assign.cushion} yards off his man</div><input type="range" id="dsCushion" min="1" max="8" step="0.5" value="${s.assign.cushion}" aria-label="Cushion in yards">`;
    if (s.assign.t === 'zone') html += '<div class="sl-note">Click the field to place his zone.</div>';
    html += `<div class="t">This defense is built to</div><div class="opts">${(Object.keys(KIND_LABEL) as SchemeKind[]).map((k) => `<button class="seg${d.kind === k ? ' on' : ''}" data-kind="${k}" ${rules[k] ? 'disabled style="opacity:.4"' : ''} title="${esc(rules[k] ?? '')}">${KIND_LABEL[k]}</button>`).join('')}</div>`
      + '<div class="sl-note">A focused defense gets an edge when it guesses right and pays when it guesses wrong. A focus needs the alignment to back it up.</div>';
    const side = q<HTMLElement>('dsSide');
    side.innerHTML = html;
    side.querySelectorAll<HTMLElement>('[data-group]').forEach((el) => el.addEventListener('click', () => { s.group = el.dataset.group as Group; draw(); }));
    side.querySelectorAll<HTMLElement>('[data-job]').forEach((el) => el.addEventListener('click', () => {
      const t = el.dataset.job;
      s.assign = t === 'rush' ? { t: 'rush' } : t === 'man' ? { t: 'man', cushion: 4 } : t === 'zone' ? { t: 'zone', at: [Math.min(25, s.at[0] + 4), s.at[1]] } : { t: 'read' };
      if (rules[d.kind]) d.kind = 'balanced';
      draw();
    }));
    side.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((el) => el.addEventListener('click', () => { if (!el.disabled) { d.kind = el.dataset.kind as SchemeKind; draw(); } }));
    side.querySelector<HTMLInputElement>('#dsCushion')?.addEventListener('change', (ev) => { if (s.assign.t === 'man') s.assign = { t: 'man', cushion: Number((ev.target as HTMLInputElement).value) }; draw(); });
    if (defKindRules(d.slots)[d.kind]) d.kind = 'balanced';
  }

  const against = (): OffPlay[] => {
    const v = (q<HTMLSelectElement>('dsVs')).value;
    return v === 'all' ? [...OFFENSE_PLAYS] : OFFENSE_PLAYS.filter((p) => p.id === v);
  };
  q<HTMLInputElement>('dsName').addEventListener('input', (ev) => { d.name = (ev.target as HTMLInputElement).value; draw(); });
  q<HTMLSelectElement>('dsFrom').addEventListener('change', (ev) => {
    const [f, s] = (ev.target as HTMLSelectElement).value.split('|');
    if (!f) return;
    Object.assign(d, draftFromFront(frontById(f), schemeById(s), d.id, d.name));
    sel = d.slots.findIndex((x) => x.group === 'LB');
    draw();
  });
  q<HTMLElement>('dsCancel').addEventListener('click', () => host.close());
  q<HTMLElement>('dsSave').addEventListener('click', () => {
    const r = check();
    if (r.ok) host.saveDefense(r.value);
  });
  q<HTMLElement>('dsRun').addEventListener('click', () => {
    const r = check();
    if (!r.ok) return;
    const plays = against();
    const pairs = plays.map((play) => ({ play, front: toFront(r.value), scheme: toScheme(r.value) }));
    q<HTMLElement>('dsStats').innerHTML = statsHtml(practice(pairs, plays.length > 1 ? 4 : 50), true);
  });
  q<HTMLElement>('dsWatch').addEventListener('click', () => {
    const r = check();
    if (!r.ok) return;
    const plays = against();
    host.watch((seed) => practiceSim(plays[seed % plays.length], toFront(r.value), toScheme(r.value), seed), r.value.name);
  });
  draw();
}
