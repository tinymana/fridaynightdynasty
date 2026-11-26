import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Stands in for the lint rules in the architecture plan until a full linter is configured. */

const ROOT = join(__dirname, '..', 'packages');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });

const ALLOWED: Record<string, string[]> = {
  core: [],
  'football-ai': ['core'],
  'match-sim': ['core', 'football-ai'],
  online: ['core', 'football-ai', 'match-sim'],
};
/** Packages that must be deterministic. The online package is allowed a clock and real randomness. */
const SIM_PACKAGES = ['core', 'football-ai', 'match-sim'];

describe('simulation packages', () => {
  it('never use ambient randomness, wall-clock time, or non-portable math', () => {
    const banned = [/Math\.random/, /Date\.now/, /new Date\(/, /performance\.now/, /setTimeout/, /setInterval/, /Math\.(sin|cos|tan|atan2?|pow|exp|log)\(/];
    for (const f of SIM_PACKAGES.flatMap((p) => files(join(ROOT, p)))) {
      const src = readFileSync(f, 'utf8');
      for (const re of banned) expect(re.test(src), `${f} uses ${re}`).toBe(false);
    }
  });

  it('the room logic takes the time as an argument, so it can be tested and replayed', () => {
    const src = readFileSync(join(ROOT, 'online', 'src', 'room.ts'), 'utf8');
    for (const re of [/Math\.random/, /Date\.now/, /new Date\(/]) expect(re.test(src)).toBe(false);
  });

  it('only import the packages the architecture allows', () => {
    for (const [pkg, allowed] of Object.entries(ALLOWED)) {
      for (const f of files(join(ROOT, pkg))) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/from '(@fnd\/[a-z-]+|phaser|node:[a-z]+)'/g)) {
          const dep = m[1].replace('@fnd/', '');
          expect(allowed.includes(dep), `${pkg} may not import ${m[1]} (${f})`).toBe(true);
        }
      }
    }
  });
});
