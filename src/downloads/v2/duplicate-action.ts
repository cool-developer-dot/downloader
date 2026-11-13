/**
 * H12, Duplicate Action (#386): what happens when the user asks for a video they already downloaded. Pure.
 *
 * - Skip (the default) is today's answer: "Video already downloaded", nothing new starts.
 * - Ask shows that answer and offers Skip, Keep both or Replace.
 * - Keep both downloads it again as a separate library item named "Title (2)", "Title (3)", …
 * - Replace downloads it again and deletes the old item once the new one completed (verified); if the new one
 *   fails or is cancelled, the old one stays.
 *
 * A download chosen this way carries `allowDuplicate` for that one request: the engine skips its identity check and
 * its same-bytes check for it. Every other request is checked exactly as before.
 */

import type { EnqueueRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

export type DuplicateAction = 'skip' | 'ask' | 'keep_both' | 'replace';

export const DUPLICATE_ACTIONS: readonly DuplicateAction[] = ['skip', 'ask', 'keep_both', 'replace'];
export const DEFAULT_DUPLICATE_ACTION: DuplicateAction = 'skip';

export function normalizeDuplicateAction(raw: unknown): DuplicateAction {
  return typeof raw === 'string' && (DUPLICATE_ACTIONS as readonly string[]).includes(raw)
    ? (raw as DuplicateAction)
    : DEFAULT_DUPLICATE_ACTION;
}

const COPY_SUFFIX = /^(.*) \((\d{1,4})\)$/;

/** "Clip" → "Clip (2)", or the next number free among [existingTitles] ("Clip (3)" when "Clip (2)" exists). */
export function uniqueCopyTitle(title: string, existingTitles: readonly string[]): string {
  const trimmed = title.trim();
  const base = COPY_SUFFIX.exec(trimmed)?.[1]?.trim() || trimmed;
  let highest = 1;
  for (const existing of existingTitles) {
    const value = existing.trim();
    if (value === base) {
      continue;
    }
    const match = COPY_SUFFIX.exec(value);
    if (match && match[1]?.trim() === base) {
      highest = Math.max(highest, Number(match[2]));
    }
  }
  return `${base} (${highest + 1})`;
}

/** The video a request is for, as the engine recognises it: the offer's own link, else the link itself. */
export function duplicateKey(request: Pick<EnqueueRequest, 'url' | 'identityUrl'>): string {
  return (request.identityUrl ?? request.url).trim();
}

type Bypass = { title: string | null };

/** Requests the user chose to download although they have the video, while that one download is being started. */
const bypasses = new Map<string, Bypass>();

export function armDuplicateBypass(key: string, bypass: Bypass): void {
  bypasses.set(key, bypass);
}

export function disarmDuplicateBypass(key: string): void {
  bypasses.delete(key);
}

export function hasDuplicateBypass(request: Pick<EnqueueRequest, 'url' | 'identityUrl'>): boolean {
  return bypasses.has(duplicateKey(request));
}

/**
 * Marks a request the user chose to download again: `allowDuplicate`, and the "(2)" title of Keep both. Leaves any
 * other request untouched.
 */
export function applyDuplicateBypass(request: EnqueueRequest): void {
  const bypass = bypasses.get(duplicateKey(request));
  if (!bypass) {
    return;
  }
  request.allowDuplicate = true;
  if (bypass.title) {
    request.title = bypass.title;
  }
}

export function resetDuplicateBypassesForTests(): void {
  bypasses.clear();
}
