import { describe, expect, it } from 'vitest';
import { REGULAR_WEEKS, createDynasty, loadDynasty, nextSeason, playWeek } from '@fnd/league';
import { MAX_SAVE_BYTES, MemoryStore, checkSave, createApi, type SaveMeta } from '@fnd/online';

/** Permanent saves: one save per coach on the server, guarded by revision so an older copy cannot overwrite a newer one. */

function world() {
  const store = new MemoryStore();
  let clock = 5_000_000;
  const api = createApi(store, () => clock);
  const call = async (body: Record<string, unknown>) => (await api(body)).data as { ok: boolean; error?: { code: string }; token?: string; save?: SaveMeta | null; data?: unknown; conflict?: boolean };
  const enter = async (name: string, pin = '1234'): Promise<string> => (await call({ action: 'enter', name, pin })).token as string;
  return { call, enter, tick: (ms: number) => { clock += ms; } };
}

describe('saves on the server', () => {
  it('a coach with nothing saved has no save', async () => {
    const w = world();
    const t = await w.enter('COACH A');
    expect((await w.call({ action: 'saveInfo', token: t })).save).toBeNull();
    const l = await w.call({ action: 'saveLoad', token: t });
    expect(l.save).toBeNull();
    expect(l.data).toBeNull();
  });

  it('keeps a save and gives it back on another device', async () => {
    const w = world();
    const laptop = await w.enter('COACH A');
    const r = await w.call({ action: 'saveStore', token: laptop, data: { v: 1, n: 7 }, label: 'Marlow Creek, year 2, week 3', base: null });
    expect(r.ok).toBe(true);
    expect(r.conflict).toBe(false);
    expect(r.save).toMatchObject({ rev: 1, label: 'Marlow Creek, year 2, week 3' });
    const phone = await w.enter('COACH A');
    const got = await w.call({ action: 'saveLoad', token: phone });
    expect(got.data).toEqual({ v: 1, n: 7 });
    expect(got.save!.rev).toBe(1);
  });

  it('refuses an older copy instead of overwriting, unless the coach insists', async () => {
    const w = world();
    const a = await w.enter('COACH A');
    const b = await w.enter('COACH A');
    await w.call({ action: 'saveStore', token: a, data: { n: 1 }, label: 'one', base: null });
    w.tick(1000);
    expect((await w.call({ action: 'saveStore', token: a, data: { n: 2 }, label: 'two', base: 1 })).save!.rev).toBe(2);
    // The second device still thinks revision 1 is the latest.
    const stale = await w.call({ action: 'saveStore', token: b, data: { n: 99 }, label: 'stale', base: 1 });
    expect(stale.ok).toBe(true);
    expect(stale.conflict).toBe(true);
    expect(stale.save).toMatchObject({ rev: 2, label: 'two' });
    expect((await w.call({ action: 'saveLoad', token: b })).data).toEqual({ n: 2 });
    // A device that has never seen a save cannot overwrite one either.
    expect((await w.call({ action: 'saveStore', token: b, data: { n: 99 }, label: 'blind', base: null })).conflict).toBe(true);
    const forced = await w.call({ action: 'saveStore', token: b, data: { n: 99 }, label: 'mine', base: 1, force: true });
    expect(forced.conflict).toBe(false);
    expect(forced.save!.rev).toBe(3);
    expect((await w.call({ action: 'saveLoad', token: a })).data).toEqual({ n: 99 });
  });

  it('keeps each coach to his own save, and needs a session', async () => {
    const w = world();
    const a = await w.enter('COACH A');
    const b = await w.enter('COACH B');
    await w.call({ action: 'saveStore', token: a, data: { who: 'a' }, label: 'a', base: null });
    expect((await w.call({ action: 'saveInfo', token: b })).save).toBeNull();
    const out = await w.call({ action: 'saveLoad', token: 'not-a-token' });
    expect(out.ok).toBe(false);
    expect(out.error!.code).toBe('signed_out');
  });

  it('turns away what is not a save, and what is too large', async () => {
    const w = world();
    const t = await w.enter('COACH A');
    for (const data of [null, 'text', 5, [1, 2]]) expect((await w.call({ action: 'saveStore', token: t, data, label: 'x', base: null })).error!.code).toBe('bad_save');
    const big = await w.call({ action: 'saveStore', token: t, data: { blob: 'x'.repeat(MAX_SAVE_BYTES) }, label: 'x', base: null });
    expect(big.error!.code).toBe('bad_save');
    expect((await w.call({ action: 'saveInfo', token: t })).save).toBeNull();
  });

  it('cleans the label', () => {
    const c = checkSave({ a: 1 }, `  <b>Year 3</b>\n${'y'.repeat(200)}`);
    expect(c.ok && c.label.length).toBe(80);
    expect(c.ok && /[<>\n]/.test(c.label)).toBe(false);
    const none = checkSave({ a: 1 }, 42);
    expect(none.ok && none.label).toBe('Saved game');
  });

  it('a twelve-season dynasty fits with room to spare and loads back the same', { timeout: 240_000 }, async () => {
    let d = createDynasty('OH', 21, 3, { quarterMinutes: 4 });
    for (let y = 0; y < 12; y++) {
      for (let wk = 0; wk <= REGULAR_WEEKS; wk++) d = playWeek(d);
      if (y < 11) d = nextSeason(d);
    }
    const c = checkSave({ fnd: 'save', v: 1, dynasty: d }, 'long');
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.bytes).toBeLessThan(MAX_SAVE_BYTES / 2);
    const w = world();
    const t = await w.enter('COACH A');
    await w.call({ action: 'saveStore', token: t, data: { dynasty: d }, label: 'long', base: null });
    const back = (await w.call({ action: 'saveLoad', token: t })).data as { dynasty: unknown };
    expect(loadDynasty(back.dynasty)).toEqual(loadDynasty(JSON.parse(JSON.stringify(d))));
  });
});
