/**
 * A coach's saved game, kept on the server under his coach name so it follows him from one device to the next.
 * The server does not read what is inside: a solo dynasty is the coach's own business, and everything in it is
 * checked again by the game when it is loaded.
 */

/** The most a save may weigh, as JSON text. A long dynasty with full record books is well under this. */
export const MAX_SAVE_BYTES = 1_500_000;
const MAX_LABEL = 80;

export interface SaveMeta {
  /** Goes up by one with every save. A browser says which one it last saw, so an older copy cannot quietly overwrite a newer one. */
  rev: number;
  /** When it was saved, in milliseconds. */
  at: number;
  /** One line a coach can recognise it by: the school, the year, the week. */
  label: string;
  bytes: number;
}

export interface StoredSave {
  meta: SaveMeta;
  data: unknown;
}

/** Checks what a browser sent to be saved. Returns the size as JSON text, or a reason it cannot be kept. */
export function checkSave(data: unknown, label: unknown): { ok: true; bytes: number; label: string } | { ok: false; reason: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'A save is required.' };
  let text: string;
  try {
    text = JSON.stringify(data);
  } catch {
    return { ok: false, reason: 'That save cannot be read.' };
  }
  if (text.length > MAX_SAVE_BYTES) return { ok: false, reason: 'That save is too large to keep on the server. Download it as a file instead.' };
  const clean = typeof label === 'string' ? label.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_LABEL) : '';
  return { ok: true, bytes: text.length, label: clean || 'Saved game' };
}
