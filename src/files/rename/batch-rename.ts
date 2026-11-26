/**
 * Files F5 · #793 Batch rename, #794 Auto numbering: new names for many files at once. Pure.
 *
 * Four modes work on the name without its extension, and the extension is always kept:
 * - Replace text (every match; ignoring case unless asked);
 * - Add a prefix and/or a suffix;
 * - Number them: "Trip 01, Trip 02, …" — a start number, 1–4 digits, before or after the name (or a new name);
 * - Change case: UPPER, lower, Title or Sentence.
 *
 * Every result says what is wrong with it: empty, over 120 characters, holding any of / \ : * ? " < > |, or the
 * same as another new name in the batch (ignoring case).
 */

export type RenameMode =
  | { kind: 'replace'; find: string; replaceWith: string; matchCase?: boolean }
  | { kind: 'affix'; prefix: string; suffix: string }
  | { kind: 'number'; start: number; digits: number; position: 'before' | 'after'; text?: string }
  | { kind: 'case'; to: 'upper' | 'lower' | 'title' | 'sentence' };

export type RenameProblem = 'empty' | 'too-long' | 'illegal-characters' | 'duplicate';

export type RenameResult = { from: string; to: string; problem: RenameProblem | null };

export const MAX_NAME_LENGTH = 120;
export const ILLEGAL_NAME_CHARACTERS = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'] as const;
export const MIN_DIGITS = 1;
export const MAX_DIGITS = 4;

/** "a.b.mp4" → ["a.b", ".mp4"]; no extension → [name, ""]; ".mp4" (only an extension) → [".mp4", ""]. */
export function splitExtension(name: string): [base: string, extension: string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) {
    return [name, ''];
  }
  return [name.slice(0, dot), name.slice(dot)];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(text: string): string {
  return text.toLocaleLowerCase().replace(/(^|[\s_\-.(])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toLocaleUpperCase());
}

function sentenceCase(text: string): string {
  const lower = text.toLocaleLowerCase();
  return lower.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
}

function pad(value: number, digits: number): string {
  const clamped = Math.min(MAX_DIGITS, Math.max(MIN_DIGITS, Math.trunc(digits) || MIN_DIGITS));
  return String(Math.max(0, Math.trunc(value))).padStart(clamped, '0');
}

/** The new name of the file at `index` of the batch, as its new base and its (kept) extension. */
export function renameParts(name: string, index: number, mode: RenameMode): { base: string; extension: string } {
  const [base, extension] = splitExtension(name);
  let next = base;
  switch (mode.kind) {
    case 'replace':
      if (mode.find) {
        next = base.replace(new RegExp(escapeRegExp(mode.find), mode.matchCase ? 'g' : 'gi'), () => mode.replaceWith);
      }
      break;
    case 'affix':
      next = `${mode.prefix}${base}${mode.suffix}`;
      break;
    case 'number': {
      const number = pad(mode.start + index, mode.digits);
      const text = mode.text?.trim() ? mode.text.trim() : base;
      next = mode.position === 'before' ? `${number} ${text}` : `${text} ${number}`;
      break;
    }
    case 'case':
      next =
        mode.to === 'upper'
          ? base.toLocaleUpperCase()
          : mode.to === 'lower'
            ? base.toLocaleLowerCase()
            : mode.to === 'title'
              ? titleCase(base)
              : sentenceCase(base);
      break;
    default:
      break;
  }
  return { base: next.trim(), extension };
}

/** The new name (extension kept) of the file at `index` of the batch. */
export function renameOne(name: string, index: number, mode: RenameMode): string {
  const { base, extension } = renameParts(name, index, mode);
  return `${base}${extension}`;
}

/** What is wrong with one new name on its own (null when it is fine); `base` is its name without the extension. */
export function nameProblem(name: string, base: string = splitExtension(name)[0]): RenameProblem | null {
  if (!base.trim()) {
    return 'empty';
  }
  if ([...name].length > MAX_NAME_LENGTH) {
    return 'too-long';
  }
  if (ILLEGAL_NAME_CHARACTERS.some((character) => name.includes(character))) {
    return 'illegal-characters';
  }
  return null;
}

/** New names for the batch, each with its problem; two results that are the same name (ignoring case) both say so. */
export function batchRename(names: readonly string[], mode: RenameMode): RenameResult[] {
  const results: RenameResult[] = names.map((from, index) => {
    const { base, extension } = renameParts(from, index, mode);
    const to = `${base}${extension}`;
    return { from, to, problem: nameProblem(to, base) };
  });
  const seen = new Map<string, number>();
  for (const result of results) {
    const key = result.to.toLocaleLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return results.map((result) =>
    result.problem === null && (seen.get(result.to.toLocaleLowerCase()) ?? 0) > 1 ? { ...result, problem: 'duplicate' } : result,
  );
}

/** Whether the batch can be applied: something changes and no result has a problem. */
export function canApplyRename(results: readonly RenameResult[]): boolean {
  return results.length > 0 && results.every((result) => result.problem === null) && results.some((result) => result.to !== result.from);
}
