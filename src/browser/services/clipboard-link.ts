/**
 * The link to open from what the user copied ("Paste link" on Downloads / Home): the first http(s) URL in the text,
 * whether the clipboard holds the link alone or a caption with a link in it ("Watch this! https://…").
 *
 * Stricter than shared-text handling on purpose — clipboard text is often not meant as a link:
 * - only `http://` / `https://`, and only where a URL starts a word (`intent://…;S.browser_fallback_url=https://…`
 *   or `?next=https://…` inside another link is not a second link);
 * - no bare hosts (`v1.2`, `file.txt` are not links);
 * - closing punctuation that ends a sentence (`.`, `,`, `!`, `?`, `;`, `:`, quotes, `)` without a matching `(`) is
 *   not part of the link.
 */

import { isYouTubeLink } from './pasted-link';

// The authority must start right after `//` (`https:///x` is not a link, although the URL parser would accept it).
const URL_START = /(^|[\s(<\[{"'“‘«])(https?:\/\/[^\s<>"'“”‘’«»/][^\s<>"'“”‘’«»]*)/gi;
const TRAILING_PUNCTUATION = /[.,!?;:…]+$/;

function trimTrailing(url: string): string {
  let out = url;
  for (;;) {
    const before = out;
    out = out.replace(TRAILING_PUNCTUATION, '');
    // A ")" closes the text's own parenthesis unless the link opened one (Wikipedia-style `/Foo_(bar)`).
    while (out.endsWith(')') && count(out, '(') < count(out, ')')) {
      out = out.slice(0, -1);
    }
    while ((out.endsWith(']') && count(out, '[') < count(out, ']')) || (out.endsWith('}') && count(out, '{') < count(out, '}'))) {
      out = out.slice(0, -1);
    }
    if (out === before) {
      return out;
    }
  }
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

function hasHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function linkFromClipboardText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  for (const match of text.matchAll(URL_START)) {
    const candidate = trimTrailing(match[2]);
    if (hasHost(candidate)) {
      return candidate;
    }
  }
  return null;
}

export type ClipboardPasteDecision =
  /** Load it in the browser through the pasted-link path (direct analyzer first). */
  | { kind: 'open'; url: string }
  /** A YouTube link: refused with the usual message, nothing loads. */
  | { kind: 'youtube'; url: string }
  /** Nothing to open: show the browser with the address bar focused so the user can paste or type. */
  | { kind: 'focus' };

export function decideClipboardPaste(text: string | null | undefined): ClipboardPasteDecision {
  const url = linkFromClipboardText(text);
  if (!url) {
    return { kind: 'focus' };
  }
  return isYouTubeLink(url) ? { kind: 'youtube', url } : { kind: 'open', url };
}
