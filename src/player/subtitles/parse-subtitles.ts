/**
 * P3 #603 Subtitle Formats: SRT, WebVTT and ASS / SSA, read into plain cues. Pure.
 *
 * - SRT: numbered blocks, `hh:mm:ss,mmm --> hh:mm:ss,mmm`. HTML-like tags (<i>, <b>, <u>, <font>) and ASS override
 *   blocks some SRT files carry (`{\an8}`) are removed.
 * - WebVTT: the header, NOTE / STYLE / REGION blocks and cue settings are skipped; cue tags (<v Name>, <c.class>, <i>,
 *   <ruby>, karaoke timestamps) are removed and entities decoded. `X-TIMESTAMP-MAP` is ignored: VidoraX's own saved
 *   files (H19) are already on the video's timeline.
 * - ASS / SSA: the [Events] section's Dialogue lines, read by its Format line. Only the text is kept: override blocks
 *   `{…}` are removed, `\N` is a new line, `\n` a space, `\h` a no-break space, and drawings (`\p1` … `\p0`) are left
 *   out. What is dropped is reported in `unsupported` (see ASS_FEATURES).
 *
 * Times are milliseconds; a cue that ends before it starts, or has no text, is left out.
 */

import type { SubtitleCue } from './cues';

export const SUBTITLE_FORMATS = ['srt', 'vtt', 'ass'] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

/** File extensions read as subtitles (`.ssa` is read as ASS). */
export const SUBTITLE_EXTENSIONS: Readonly<Record<string, SubtitleFormat>> = { srt: 'srt', vtt: 'vtt', ass: 'ass', ssa: 'ass' };

/**
 * ASS / SSA features the Player does not draw; the text still shows, in the user's subtitle style (P4):
 * - position: \pos, \move, \org — every line sits at the subtitle position instead.
 * - alignment: \an, \a — the same.
 * - fade: \fad, \fade.   - animation: \t.   - karaoke: \k, \K, \kf, \ko.   - drawing: \p (the shapes are left out).
 * - colour: \c, \1c–\4c, \alpha, \1a–\4a.   - font: \fn, \fs, \fsp, \fscx, \fscy.   - text style: \b, \i, \u, \s.
 * - border / shadow: \bord, \shad, \be, \blur and their x / y forms.   - rotation: \fr, \frx, \fry, \frz, \fax, \fay.
 * - clip: \clip, \iclip.   - reset: \r.   - wrap: \q.
 * - styles: the [V4+ Styles] fonts, colours, sizes and margins.   - effects: Effect field (Karaoke, Scroll, Banner).
 * - layers: Layer numbers (overlapping lines are stacked instead).   - margins: per-line MarginL / R / V.
 */
export const ASS_FEATURES = [
  'position',
  'alignment',
  'fade',
  'animation',
  'karaoke',
  'drawing',
  'colour',
  'font',
  'text style',
  'border / shadow',
  'rotation',
  'clip',
  'reset',
  'wrap',
  'styles',
  'effects',
  'layers',
  'margins',
] as const;
export type AssFeature = (typeof ASS_FEATURES)[number];

export type ParsedSubtitles = {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  /** ASS / SSA only: the features the file uses that are not drawn, in ASS_FEATURES order. */
  unsupported: AssFeature[];
};

const NBSP = String.fromCharCode(0xa0);
const LRM = String.fromCharCode(0x200e);
const RLM = String.fromCharCode(0x200f);

function normalizeText(text: string): string {
  const unixed = text.replace(/\r\n?/g, '\n');
  return unixed.charCodeAt(0) === 0xfeff ? unixed.slice(1) : unixed;
}

/** "1:02:03,5" / "02:03.500" → ms. Hours optional; the fraction is a decimal fraction (",5" is 500 ms). */
function clockMs(hours: string | undefined, minutes: string, seconds: string, fraction: string | undefined): number | null {
  const h = hours ? Number(hours) : 0;
  const m = Number(minutes);
  const s = Number(seconds);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s) || m > 59 || s > 59) {
    return null;
  }
  const ms = fraction ? Math.round(Number(`0.${fraction}`) * 1000) : 0;
  return ((h * 60 + m) * 60 + s) * 1000 + ms;
}

const TIMING = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?(.*)$/;

function parseTiming(line: string): { startMs: number; endMs: number; settings: string } | null {
  const match = TIMING.exec(line);
  if (!match) {
    return null;
  }
  const startMs = clockMs(match[1], match[2]!, match[3]!, match[4]);
  const endMs = clockMs(match[5], match[6]!, match[7]!, match[8]);
  if (startMs == null || endMs == null) {
    return null;
  }
  return { startMs, endMs, settings: (match[9] ?? '').trim() };
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: NBSP,
  lrm: LRM,
  rlm: RLM,
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const cp = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Text of an SRT / WebVTT cue: tags out (<i>, <v Name>, <00:01.000>, <ruby>…<rt>…</rt>), entities decoded. */
function cleanMarkup(lines: readonly string[]): string {
  return lines
    .map((line) =>
      decodeEntities(
        line
          .replace(/<rt>[\s\S]*?<\/rt>/gi, '')
          .replace(/<[^>]*>/g, '')
          .replace(/\{\\[^}]*\}/g, ''),
      ).trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n');
}

function pushCue(out: SubtitleCue[], startMs: number, endMs: number, text: string): void {
  if (text && endMs > startMs && startMs >= 0) {
    out.push({ startMs, endMs, text });
  }
}

/** #603 SRT. Tolerates a missing index, '.' for ',', and the next block's number left without a blank line. */
export function parseSrt(input: string): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  let startMs = 0;
  let endMs = 0;
  let text: string[] | null = null;
  for (const line of normalizeText(input).split('\n')) {
    const timing = line.includes('-->') ? parseTiming(line) : null;
    if (timing) {
      if (text) {
        // A block that ran into this one: its last line is this block's number.
        if (text.length > 0 && /^\s*\d+\s*$/.test(text[text.length - 1]!)) {
          text.pop();
        }
        pushCue(out, startMs, endMs, cleanMarkup(text));
      }
      startMs = timing.startMs;
      endMs = timing.endMs;
      text = [];
      continue;
    }
    if (!text) {
      continue;
    }
    if (line.trim() === '') {
      pushCue(out, startMs, endMs, cleanMarkup(text));
      text = null;
      continue;
    }
    text.push(line);
  }
  if (text) {
    pushCue(out, startMs, endMs, cleanMarkup(text));
  }
  return out;
}

/** #603 WebVTT. */
export function parseVtt(input: string): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  normalizeText(input)
    .split(/\n[ \t]*\n/)
    .forEach((block, index) => {
      let lines = block.split('\n');
      while (lines.length > 0 && lines[0]!.trim() === '') {
        lines.shift();
      }
      const first = lines[0]?.trim() ?? '';
      if (!first || /^(NOTE|STYLE|REGION)(\s|$)/.test(first)) {
        return;
      }
      if (index === 0 && /^WEBVTT/.test(first)) {
        // The header and its lines (Kind, Language, X-TIMESTAMP-MAP …); in a sloppy file a cue follows directly.
        const timingAt = lines.findIndex((line) => line.includes('-->'));
        if (timingAt < 0) {
          return;
        }
        lines = lines.slice(timingAt);
      }
      const timingAt = lines.findIndex((line) => line.includes('-->'));
      if (timingAt < 0 || timingAt > 1) {
        return;
      }
      const timing = parseTiming(lines[timingAt]!);
      if (timing) {
        pushCue(out, timing.startMs, timing.endMs, cleanMarkup(lines.slice(timingAt + 1)));
      }
    });
  return out;
}

const DEFAULT_ASS_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];

const ASS_TAG_FEATURES: [RegExp, AssFeature][] = [
  [/^(pos|move|org)\b/, 'position'],
  [/^an?\d/, 'alignment'],
  [/^fade?\b/, 'fade'],
  [/^t\(/, 'animation'],
  [/^(k|K|kf|ko)\d/, 'karaoke'],
  [/^p\d/, 'drawing'],
  [/^(\d?c&|\d?c\b|alpha|\da&)/, 'colour'],
  [/^(fn|fs\d|fsp|fscx|fscy|fs\b)/, 'font'],
  [/^(b|i|u|s)\d/, 'text style'],
  [/^(x|y)?(bord|shad)|^be\b|^be\d|^blur/, 'border / shadow'],
  [/^(fr[xyz]?|fa[xy])/, 'rotation'],
  [/^i?clip/, 'clip'],
  [/^r/, 'reset'],
  [/^q\d/, 'wrap'],
];

function assTime(value: string): number | null {
  const match = /^\s*(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\s*$/.exec(value);
  return match ? clockMs(match[1], match[2]!, match[3]!, match[4]) : null;
}

/** The text of one Dialogue line: override blocks out (noting what they asked for), drawings left out. */
function assText(raw: string, seen: Set<AssFeature>): string {
  let text = '';
  let drawing = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (ch === '{') {
      const close = raw.indexOf('}', i + 1);
      if (close < 0) {
        break;
      }
      const block = raw.slice(i + 1, close);
      for (const tag of block.split('\\').slice(1)) {
        const name = tag.trim();
        const drawingLevel = /^p(\d+)/.exec(name);
        if (drawingLevel) {
          drawing = Number(drawingLevel[1]) > 0;
        }
        for (const [pattern, feature] of ASS_TAG_FEATURES) {
          if (pattern.test(name)) {
            seen.add(feature);
            break;
          }
        }
      }
      i = close + 1;
      continue;
    }
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1]!;
      if (next === 'N') {
        if (!drawing) text += '\n';
        i += 2;
        continue;
      }
      if (next === 'n') {
        if (!drawing) text += ' ';
        i += 2;
        continue;
      }
      if (next === 'h') {
        if (!drawing) text += NBSP;
        i += 2;
        continue;
      }
    }
    if (!drawing) {
      text += ch;
    }
    i += 1;
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** #603 ASS / SSA (v4 and v4+). */
export function parseAss(input: string): { cues: SubtitleCue[]; unsupported: AssFeature[] } {
  const lines = normalizeText(input).split('\n');
  const out: SubtitleCue[] = [];
  const seen = new Set<AssFeature>();
  let section = '';
  let format = DEFAULT_ASS_FORMAT;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1]!.trim().toLowerCase();
      continue;
    }
    if (/styles$/.test(section) && /^Style\s*:/i.test(line)) {
      seen.add('styles');
      continue;
    }
    if (section !== 'events') {
      continue;
    }
    const formatLine = /^Format\s*:(.*)$/i.exec(line);
    if (formatLine) {
      format = formatLine[1]!.split(',').map((field) => field.trim().toLowerCase());
      continue;
    }
    const dialogue = /^Dialogue\s*:(.*)$/i.exec(rawLine.trimStart());
    if (!dialogue) {
      continue;
    }
    // The Text field is last and may itself contain commas.
    const fields: string[] = [];
    let rest = dialogue[1]!;
    for (let k = 0; k < format.length - 1; k += 1) {
      const comma = rest.indexOf(',');
      if (comma < 0) {
        fields.push(rest);
        rest = '';
        continue;
      }
      fields.push(rest.slice(0, comma));
      rest = rest.slice(comma + 1);
    }
    fields.push(rest);
    const field = (name: string) => {
      const at = format.indexOf(name);
      return at >= 0 ? (fields[at] ?? '') : '';
    };
    const startMs = assTime(field('start'));
    const endMs = assTime(field('end'));
    if (startMs == null || endMs == null) {
      continue;
    }
    if (field('effect').trim()) seen.add('effects');
    const layer = Number(field('layer').trim() || '0');
    if (Number.isFinite(layer) && layer !== 0) seen.add('layers');
    if (['marginl', 'marginr', 'marginv'].some((name) => Number(field(name).trim() || '0') !== 0)) seen.add('margins');
    pushCue(out, startMs, endMs, assText(field('text'), seen));
  }
  return { cues: out, unsupported: ASS_FEATURES.filter((feature) => seen.has(feature)) };
}

/** The format of a subtitle file, from its extension, or failing that its first lines; null when it is none of them. */
export function detectSubtitleFormat(fileName: string | null | undefined, text: string): SubtitleFormat | null {
  const extension = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension && SUBTITLE_EXTENSIONS[extension]) {
    return SUBTITLE_EXTENSIONS[extension]!;
  }
  const head = normalizeText(text).slice(0, 2000);
  if (/^\s*WEBVTT/.test(head)) return 'vtt';
  if (/^\s*\[Script Info\]/im.test(head) || /^\s*\[Events\]/im.test(head)) return 'ass';
  if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(head)) return 'srt';
  return null;
}

/** Reads a subtitle file's text in its format (see `detectSubtitleFormat`). */
export function parseSubtitles(text: string, format: SubtitleFormat): ParsedSubtitles {
  if (format === 'ass') {
    const { cues, unsupported } = parseAss(text);
    return { format, cues, unsupported };
  }
  return { format, cues: format === 'vtt' ? parseVtt(text) : parseSrt(text), unsupported: [] };
}
