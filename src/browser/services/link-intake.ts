/**
 * Links that enter VidoraX in new ways (H7): the clipboard monitor, Batch Add and Import Links from File. Pure.
 * Every link keeps the app's rules: YouTube is refused, and so is any private or local address (SSRF guard), before
 * anything is fetched.
 */

import { isPrivateOrLocalHostname } from '@/media-detection/utils/url';

import { isYouTubeLink } from './pasted-link';

export const MAX_BATCH_LINKS = 50;

export type LinkVerdict = 'ok' | 'youtube' | 'private' | 'invalid';

/** Trailing characters a URL inside prose usually does not own. */
function trimTrailing(url: string): string {
  let out = url;
  while (/[.,;:!?'")\]}>]$/.test(out)) {
    const last = out[out.length - 1];
    // Keep a closing bracket that has its opening one in the URL (e.g. Wikipedia's `_(film)`).
    if ((last === ')' && out.split('(').length > out.split(')').length - 1) || (last === ']' && out.includes('['))) {
      break;
    }
    out = out.slice(0, -1);
  }
  return out;
}

/** Every http(s) URL in `text`, in order, without duplicates (compared without a trailing slash or fragment). */
export function extractLinks(text: string, max = MAX_BATCH_LINKS): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  for (const raw of matches) {
    const url = trimTrailing(raw);
    let key: string;
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      key = parsed.toString().replace(/\/$/, '').toLowerCase();
    } catch {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    found.push(url);
    if (found.length >= max) {
      break;
    }
  }
  return found;
}

/** The app's rules for a link: refused before any request when it is YouTube or a private/local address. */
export function classifyIntakeLink(url: string): LinkVerdict {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid';
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
    return 'invalid';
  }
  if (isYouTubeLink(url)) {
    return 'youtube';
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    return 'private';
  }
  return 'ok';
}

/** A short, stable, non-reversible hash (cyrb53) — all the clipboard monitor ever stores about a link. */
export function linkHash(url: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < url.length; i += 1) {
    const ch = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Pure: what the clipboard monitor offers for `text` — the first link in it, when it is an allowed http(s) link
 * not offered before (`lastHash`). Null otherwise.
 */
export function clipboardOffer(
  text: string | null | undefined,
  lastHash: string | null | undefined,
): { url: string; hash: string } | null {
  if (!text) {
    return null;
  }
  const url = extractLinks(text.slice(0, 4096), 1)[0];
  if (!url || classifyIntakeLink(url) !== 'ok') {
    return null;
  }
  const hash = linkHash(url);
  return hash === lastHash ? null : { url, hash };
}

export type BatchOutcome = 'added' | 'duplicate' | 'needs-review' | 'refused';

/**
 * Pure: how one Batch Add link ended. Only an analyzer result of exactly one verified video (`SUPPORTED`) that the
 * normal handoff accepted is "added" (or "duplicate" when the engine already has it); anything else needs review.
 */
export function batchOutcomeFor(input: {
  verdict: LinkVerdict;
  analysisStatus?: string | null;
  enqueue?: { ok: boolean; duplicate?: string | null; deduped?: boolean } | null;
}): BatchOutcome {
  if (input.verdict !== 'ok') {
    return 'refused';
  }
  if (input.analysisStatus !== 'SUPPORTED' || !input.enqueue) {
    return 'needs-review';
  }
  if (!input.enqueue.ok) {
    return 'needs-review';
  }
  return input.enqueue.duplicate || input.enqueue.deduped ? 'duplicate' : 'added';
}
