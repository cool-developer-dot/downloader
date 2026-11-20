import { extractLinks } from '@/browser/services/link-intake';

import { expandUrlPattern, isUrlPattern } from './url-pattern';

/** Batch Add with patterns can stand for more links than a paste: at most this many per run. */
export const MAX_BULK_LINKS = 500;

/**
 * The links a Batch Add text stands for, in order and without duplicates: plain links as pasted, and each line that
 * holds a pattern (#485) expanded into its links. Pure.
 */
export function batchLinksFromText(text: string, max = MAX_BULK_LINKS): { links: string[]; truncated: boolean } {
  const links: string[] = [];
  const seen = new Set<string>();
  let truncated = false;
  const add = (url: string) => {
    if (seen.has(url)) return;
    if (links.length >= max) {
      truncated = true;
      return;
    }
    seen.add(url);
    links.push(url);
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:https?|ftp):\/\/\S+$/i.test(trimmed) && isUrlPattern(trimmed)) {
      const expanded = expandUrlPattern(trimmed, max);
      expanded.urls.forEach(add);
      if (expanded.truncated) truncated = true;
      continue;
    }
    extractLinks(trimmed, max).forEach(add);
  }
  return { links, truncated };
}
