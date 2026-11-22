/**
 * P3 #601 Subtitle Encoding: turning a subtitle file's bytes into text. Pure; no TextDecoder (Hermes may not have one,
 * and Node's would hide that in tests), so every decoder is here, with the two legacy code pages as built-in tables.
 *
 * Automatic detection: a byte-order mark (UTF-8, UTF-16 LE / BE); UTF-16 without one (many zero bytes); valid UTF-8;
 * otherwise a legacy Windows code page — Windows-1256 (Arabic / Urdu) when the high bytes form words, as Arabic script
 * does, else Windows-1252 (Western). The user can always choose one by hand.
 */

export const SUBTITLE_ENCODINGS = ['auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1256', 'windows-1252'] as const;
export type SubtitleEncoding = (typeof SUBTITLE_ENCODINGS)[number];
export type ResolvedEncoding = Exclude<SubtitleEncoding, 'auto'>;

export function isSubtitleEncoding(value: unknown): value is SubtitleEncoding {
  return typeof value === 'string' && (SUBTITLE_ENCODINGS as readonly string[]).includes(value);
}

/** Display names; they are the standard names in every language, so they are not translated. */
export const ENCODING_NAMES: Record<ResolvedEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  'windows-1256': 'Windows-1256',
  'windows-1252': 'Windows-1252',
};

const REPLACEMENT = 0xfffd;

/** Windows-1256 bytes 0x80–0xFF → code points (every byte is defined). */
const WINDOWS_1256: readonly number[] = [
  0x20ac, 0x067e, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0679, 0x2039, 0x0152, 0x0686, 0x0698, 0x0688,
  0x06af, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x06a9, 0x2122, 0x0691, 0x203a, 0x0153, 0x200c, 0x200d, 0x06ba,
  0x00a0, 0x060c, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00a9, 0x06be, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af,
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x061b, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x061f,
  0x06c1, 0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0626, 0x0627, 0x0628, 0x0629, 0x062a, 0x062b, 0x062c, 0x062d, 0x062e, 0x062f,
  0x0630, 0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x00d7, 0x0637, 0x0638, 0x0639, 0x063a, 0x0640, 0x0641, 0x0642, 0x0643,
  0x00e0, 0x0644, 0x00e2, 0x0645, 0x0646, 0x0647, 0x0648, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x0649, 0x064a, 0x00ee, 0x00ef,
  0x064b, 0x064c, 0x064d, 0x064e, 0x00f4, 0x064f, 0x0650, 0x00f7, 0x0651, 0x00f9, 0x0652, 0x00fb, 0x00fc, 0x200e, 0x200f, 0x06d2,
];

/** Windows-1252 bytes 0x80–0xFF → code points; the five undefined bytes map to the C1 control of the same value. */
const WINDOWS_1252: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
  0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af,
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x00ba, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x00bf,
  0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c6, 0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cb, 0x00cc, 0x00cd, 0x00ce, 0x00cf,
  0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4, 0x00d5, 0x00d6, 0x00d7, 0x00d8, 0x00d9, 0x00da, 0x00db, 0x00dc, 0x00dd, 0x00de, 0x00df,
  0x00e0, 0x00e1, 0x00e2, 0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x00ec, 0x00ed, 0x00ee, 0x00ef,
  0x00f0, 0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f7, 0x00f8, 0x00f9, 0x00fa, 0x00fb, 0x00fc, 0x00fd, 0x00fe, 0x00ff,
];

export type DetectedEncoding = { encoding: ResolvedEncoding; bom: boolean };

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** True when the bytes are well-formed UTF-8 (no overlongs, surrogates or code points past U+10FFFF). */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    let need: number;
    let min: number;
    let cp: number;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      min = 0x80;
      cp = b & 0x1f;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      min = 0x800;
      cp = b & 0x0f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      min = 0x10000;
      cp = b & 0x07;
    } else {
      return false;
    }
    for (let k = 1; k <= need; k += 1) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) {
        return false;
      }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return false;
    }
    i += need + 1;
  }
  return true;
}

/**
 * UTF-16 without a byte-order mark: text that is mostly ASCII (subtitle timings, digits, punctuation) puts a zero in
 * every other byte. Which side the zeros are on gives the byte order. Null when it does not look like UTF-16.
 */
function sniffUtf16(bytes: Uint8Array): ResolvedEncoding | null {
  const sample = Math.min(bytes.length - (bytes.length % 2), 4096);
  if (sample < 8) {
    return null;
  }
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i] === 0) evenZeros += 1;
    if (bytes[i + 1] === 0) oddZeros += 1;
  }
  const pairs = sample / 2;
  if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.05) return 'utf-16le';
  if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.05) return 'utf-16be';
  return null;
}

/**
 * Windows-1256 or Windows-1252 for bytes that are not Unicode. Arabic-script text is made of high bytes, so its words
 * are runs of three or more; Western text uses a high byte here and there inside ASCII words.
 */
function guessLegacy(bytes: Uint8Array): ResolvedEncoding {
  let high = 0;
  let longRuns = 0;
  let run = 0;
  for (let i = 0; i <= bytes.length; i += 1) {
    const b = i < bytes.length ? bytes[i]! : 0x20;
    if (b >= 0xc0) {
      high += 1;
      run += 1;
    } else {
      if (run >= 3) longRuns += run;
      run = 0;
    }
  }
  return high > 0 && longRuns / high >= 0.5 ? 'windows-1256' : 'windows-1252';
}

/** The encoding of a subtitle file, as automatic detection decides it. */
export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  if (hasUtf8Bom(bytes)) return { encoding: 'utf-8', bom: true };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bom: true };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bom: true };
  const utf16 = sniffUtf16(bytes);
  if (utf16) return { encoding: utf16, bom: false };
  if (isValidUtf8(bytes)) return { encoding: 'utf-8', bom: false };
  return { encoding: guessLegacy(bytes), bom: false };
}

function pushCodePoint(out: string[], cp: number): void {
  out.push(String.fromCodePoint(cp));
}

function decodeUtf8(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = hasUtf8Bom(bytes) ? 3 : 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out.push(String.fromCharCode(b));
      i += 1;
      continue;
    }
    const need = b >= 0xf0 && b <= 0xf4 ? 3 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xc2 && b <= 0xdf ? 1 : -1;
    if (need < 0) {
      pushCodePoint(out, REPLACEMENT);
      i += 1;
      continue;
    }
    let cp = b & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
    let ok = true;
    for (let k = 1; k <= need; k += 1) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (!ok || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      pushCodePoint(out, REPLACEMENT);
      i += 1;
      continue;
    }
    pushCodePoint(out, cp);
    i += need + 1;
  }
  return out.join('');
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let i = 0;
  if (bytes.length >= 2) {
    const bom = littleEndian ? bytes[0] === 0xff && bytes[1] === 0xfe : bytes[0] === 0xfe && bytes[1] === 0xff;
    if (bom) i = 2;
  }
  const units: number[] = [];
  for (; i + 1 < bytes.length; i += 2) {
    units.push(littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!);
  }
  const out: string[] = [];
  for (let k = 0; k < units.length; k += 1) {
    const unit = units[k]!;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = units[k + 1];
      if (next !== undefined && next >= 0xdc00 && next <= 0xdfff) {
        pushCodePoint(out, 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00));
        k += 1;
        continue;
      }
      pushCodePoint(out, REPLACEMENT);
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      pushCodePoint(out, REPLACEMENT);
      continue;
    }
    out.push(String.fromCharCode(unit));
  }
  if (bytes.length % 2 === 1) {
    pushCodePoint(out, REPLACEMENT);
  }
  return out.join('');
}

function decodeTable(bytes: Uint8Array, table: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    out.push(String.fromCharCode(b < 0x80 ? b : table[b - 0x80]!));
  }
  return out.join('');
}

export type DecodedSubtitle = { text: string; encoding: ResolvedEncoding };

/** The file's text in `encoding` ('auto' detects it). A leading byte-order mark never reaches the text. */
export function decodeSubtitleBytes(bytes: Uint8Array, encoding: SubtitleEncoding = 'auto'): DecodedSubtitle {
  const resolved = encoding === 'auto' ? detectEncoding(bytes).encoding : encoding;
  let text: string;
  switch (resolved) {
    case 'utf-8':
      text = decodeUtf8(bytes);
      break;
    case 'utf-16le':
      text = decodeUtf16(bytes, true);
      break;
    case 'utf-16be':
      text = decodeUtf16(bytes, false);
      break;
    case 'windows-1256':
      text = decodeTable(bytes, WINDOWS_1256);
      break;
    case 'windows-1252':
      text = decodeTable(bytes, WINDOWS_1252);
      break;
  }
  return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding: resolved };
}

/** Bytes of `text` in a legacy code page (for tests: makes Windows-1256 / 1252 files). Unknown characters → `?`. */
export function encodeLegacy(text: string, encoding: 'windows-1256' | 'windows-1252'): Uint8Array {
  const table = encoding === 'windows-1256' ? WINDOWS_1256 : WINDOWS_1252;
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
      continue;
    }
    const index = table.indexOf(cp);
    out.push(index >= 0 ? 0x80 + index : 0x3f);
  }
  return Uint8Array.from(out);
}
