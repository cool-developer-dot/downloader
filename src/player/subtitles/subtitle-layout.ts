/**
 * P4: right-to-left subtitle lines (#600) and where one or two subtitles go (#599). Pure.
 */

import type { SubtitleAnchor, SubtitleStyle } from './subtitle-style';

// ── #600 RTL ─────────────────────────────────────────────────────────────────────────────────────────────────────

const RLM = String.fromCharCode(0x200f);

/** Hebrew, Arabic (with Urdu, Persian), Syriac, Thaana, N'Ko and the Arabic presentation forms. */
function isStrongRtl(code: number): boolean {
  return (
    (code >= 0x0590 && code <= 0x08ff) ||
    (code >= 0xfb1d && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff) ||
    (code >= 0x10800 && code <= 0x10fff) ||
    (code >= 0x1e800 && code <= 0x1efff)
  );
}

/**
 * Letters of left-to-right scripts: every cased letter (Latin, Greek, Cyrillic, Armenian, Georgian …) and the main
 * uncased ones (Indic, Thai, Lao, Hangul, kana, CJK). Digits and punctuation are not counted. (No `\p{L}`: the app's
 * JavaScript engine is not relied on for Unicode property escapes.)
 */
function isStrongLtr(char: string, code: number): boolean {
  if (isStrongRtl(code)) {
    return false;
  }
  if (char.toLowerCase() !== char.toUpperCase()) {
    return true;
  }
  return (
    (code >= 0x0900 && code <= 0x0eff) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

/**
 * The direction of one subtitle line: right-to-left when it has more right-to-left letters than left-to-right ones
 * (so "WiFi کا پاس ورڈ 1234 ہے" is an Urdu line with an English word, and "Hello دوست" an English one). On a tie the
 * first letter decides; a line with no letters (numbers, "♪") is left-to-right.
 */
export function lineDirection(line: string): 'rtl' | 'ltr' {
  let rtl = 0;
  let ltr = 0;
  let first: 'rtl' | 'ltr' | null = null;
  for (const char of line) {
    const code = char.codePointAt(0)!;
    if (isStrongRtl(code)) {
      rtl += 1;
      first ??= 'rtl';
    } else if (isStrongLtr(char, code)) {
      ltr += 1;
      first ??= 'ltr';
    }
  }
  if (rtl !== ltr) {
    return rtl > ltr ? 'rtl' : 'ltr';
  }
  return first ?? 'ltr';
}

export type SubtitleLine = {
  /** The text to draw. A right-to-left line starts with a right-to-left mark, so Android lays the whole line out
   * right to left (an English word or a number inside it stays in its place). */
  text: string;
  direction: 'rtl' | 'ltr';
};

/** A cue's text as lines, each with its own direction (a dual-language cue mixes them). */
export function subtitleLines(text: string): SubtitleLine[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const direction = lineDirection(line);
      return { text: direction === 'rtl' && !line.startsWith(RLM) ? `${RLM}${line}` : line, direction };
    });
}

// ── #599 Dual subtitles ──────────────────────────────────────────────────────────────────────────────────────────

export type SubtitleTrackSlot = 'primary' | 'secondary';

export type SubtitleBlock = {
  anchor: SubtitleAnchor;
  /** % of the picture's height from the anchored edge. */
  marginPercent: number;
  /** The subtitles in this block, top to bottom. */
  tracks: SubtitleTrackSlot[];
};

/**
 * Where the subtitles go. Checklist #599 says only "two languages together", so the layout is VidoraX's:
 * - One subtitle: at the style's edge and distance.
 * - Second "next to the first": one block; the second sits on the side away from the edge (above a bottom subtitle,
 *   below a top one), so the first stays where the user put it.
 * - Second "at the top": its own block at the top; with the first also at the top, they share one block.
 * - When the first is a track inside the video, the player draws it at the bottom where VidoraX can't measure it, so
 *   the second goes to the top.
 * - With the first off, the second shows alone where the first would be (or at the top).
 */
export function planSubtitleBlocks(input: {
  /** VidoraX draws the first subtitle (a file is showing). */
  primary: boolean;
  /** The player draws the first subtitle (a track inside the video). */
  primaryNative: boolean;
  secondary: boolean;
  style: Pick<SubtitleStyle, 'anchor' | 'marginPercent' | 'secondPosition'>;
}): SubtitleBlock[] {
  const { anchor, marginPercent, secondPosition } = input.style;
  const at = (blockAnchor: SubtitleAnchor, tracks: SubtitleTrackSlot[]): SubtitleBlock => ({
    anchor: blockAnchor,
    marginPercent,
    tracks,
  });
  if (!input.secondary) {
    return input.primary ? [at(anchor, ['primary'])] : [];
  }
  if (input.primaryNative) {
    return [at('top', ['secondary'])];
  }
  if (!input.primary) {
    return [at(secondPosition === 'top' ? 'top' : anchor, ['secondary'])];
  }
  if (secondPosition === 'top' && anchor === 'bottom') {
    return [at('bottom', ['primary']), at('top', ['secondary'])];
  }
  // One block; the second is on the side away from the edge.
  return [at(anchor, anchor === 'bottom' ? ['secondary', 'primary'] : ['primary', 'secondary'])];
}
