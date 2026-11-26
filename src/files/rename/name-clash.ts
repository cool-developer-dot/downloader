/**
 * Files F5 · #797 Conflict resolution: when a rename or a move would give a folder two files of the same name. Pure.
 * Names clash ignoring case. Keep both adds " (2)" before the extension, or the next free number: " (2)" steps up to
 * " (3)", and so on.
 */

import { splitExtension } from './batch-rename';

export type ClashChoice = 'keep-both' | 'replace' | 'skip';

/** The existing name `name` clashes with in `existingNames` (ignoring case), or null. */
export function findClash(name: string, existingNames: readonly string[]): string | null {
  const key = name.toLocaleLowerCase();
  return existingNames.find((existing) => existing.toLocaleLowerCase() === key) ?? null;
}

const NUMBERED = /^(.*) \((\d+)\)$/;

/** "clip.mp4" → "clip (2).mp4"; "clip (2).mp4" → "clip (3).mp4"; the first number no name in the folder has. */
export function keepBothName(name: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((existing) => existing.toLocaleLowerCase()));
  const [base, extension] = splitExtension(name);
  const match = NUMBERED.exec(base);
  const stem = match ? match[1]! : base;
  let number = match ? Number(match[2]) + 1 : 2;
  let candidate = `${stem} (${number})${extension}`;
  while (taken.has(candidate.toLocaleLowerCase())) {
    number += 1;
    candidate = `${stem} (${number})${extension}`;
  }
  return candidate;
}
