import type { TeamColors } from '@fnd/core';
import { checkIdentity, type SchoolIdentity } from '@fnd/league';

/** A small form for renaming a school and choosing its colours. Used by the commissioner of a league and in a solo dynasty. */

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const PARTS: { key: keyof TeamColors; label: string }[] = [{ key: 'jersey', label: 'Jersey' }, { key: 'helmet', label: 'Helmet' }, { key: 'pants', label: 'Pants' }, { key: 'trim', label: 'Trim' }];

export function schoolFormHtml(s: SchoolIdentity): string {
  return `<div class="sf" id="sf"><h3>Rename ${esc(s.name)} ${esc(s.mascot)}</h3>
    <div class="orow"><label class="pick">School <input id="sfName" maxlength="23" value="${esc(s.name)}"></label>
      <label class="pick">Mascot <input id="sfMascot" maxlength="17" value="${esc(s.mascot)}"></label>
      <label class="pick">Short name <input id="sfAbbr" maxlength="4" value="${esc(s.abbr)}" style="width:70px;text-transform:uppercase"></label></div>
    <div class="orow">${PARTS.map((p) => `<label class="pick">${p.label} <input type="color" id="sf_${p.key}" value="${hex(s.colors[p.key])}"></label>`).join('')}
      <span class="swatch sf-preview" id="sfPreview"></span></div>
    <div class="orow"><button class="seg on" id="sfSave">Save</button><button class="seg" id="sfCancel">Cancel</button><span id="sfMsg" class="sl-note" role="status" aria-live="polite"></span></div></div>`;
}

/** Wires up a form drawn with `schoolFormHtml`. `others` are the league's other schools, for the duplicate-name check. */
export function bindSchoolForm(root: HTMLElement, others: readonly SchoolIdentity[], onSave: (s: SchoolIdentity) => void | Promise<void>, onCancel: () => void): void {
  const q = <T extends HTMLElement>(id: string): T => root.querySelector(`#${id}`) as T;
  const read = (): unknown => ({
    name: q<HTMLInputElement>('sfName').value, mascot: q<HTMLInputElement>('sfMascot').value, abbr: q<HTMLInputElement>('sfAbbr').value,
    colors: Object.fromEntries(PARTS.map((p) => [p.key, parseInt(q<HTMLInputElement>(`sf_${p.key}`).value.slice(1), 16)])),
  });
  const preview = (): void => {
    const c = (read() as { colors: Record<string, number> }).colors;
    q('sfPreview').style.background = `linear-gradient(90deg, ${hex(c['jersey'])} 0 60%, ${hex(c['trim'])} 60% 80%, ${hex(c['helmet'])} 80%)`;
  };
  PARTS.forEach((p) => q(`sf_${p.key}`).addEventListener('input', preview));
  preview();
  q('sfCancel').addEventListener('click', onCancel);
  q('sfSave').addEventListener('click', () => {
    const r = checkIdentity(read(), others);
    if (!r.ok) {
      q('sfMsg').textContent = r.problem;
      return;
    }
    q('sfMsg').textContent = '';
    void Promise.resolve(onSave(r.value)).catch((e: unknown) => { q('sfMsg').textContent = e instanceof Error ? e.message : 'That change was refused.'; });
  });
}
