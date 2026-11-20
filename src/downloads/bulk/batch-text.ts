import { extractLinks } from '@/browser/services/link-intake';
import { MAX_MIRRORS } from '@/downloads/v2/sources';

import { expandUrlPattern, isUrlPattern } from './url-pattern';

/** Batch Add with patterns can stand for more links than a paste: at most this many per run. */
export const MAX_BULK_LINKS = 500;

/**
 * The links a Batch Add text stands for, in order and without duplicates: plain links as pasted, each line that
 * holds a pattern (#485) expanded into its links, and a line `link | mirror | mirror` (#347) as one link with its
 * mirrors. Pure.
 */
export function batchLinksFromText(
  text: string,
  max = MAX_BULK_LINKS,
): { links: string[]; truncated: boolean; mirrors: Readonly<Record<string, string[]>> } {
  const links: string[] = [];
  const mirrors: Record<string, string[]> = {};
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
    if (trimmed.includes('|')) {
      const [first, ...rest] = trimmed.split('|');
      const url = extractLinks(first ?? '', 1)[0];
      if (!url) continue;
      const known = seen.has(url);
      add(url);
      const extra = rest.flatMap((part) => extractLinks(part, 1)).filter((mirror) => mirror !== url);
      if (!known && seen.has(url) && extra.length > 0) mirrors[url] = [...new Set(extra)].slice(0, MAX_MIRRORS);
      continue;
    }
    extractLinks(trimmed, max).forEach(add);
  }
  return { links, truncated, mirrors };
}
