/**
 * Text matching for the browser's search boxes (tabs, history, bookmarks, notes) that works for Urdu as well as
 * English. Pure.
 *
 * Folding: Unicode NFKC, lower case, Eastern Arabic / Extended Arabic-Indic digits → 0–9, Arabic diacritics
 * (harakat, tatweel) removed, and the letters keyboards type in two ways unified — Arabic yeh/kaf/heh vs. their
 * Urdu/Persian forms, hamza-on-yeh, alef variants. So "پاکستان" typed with an Arabic ك or with ی/ي both match.
 */

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/g;

const LETTER_FOLDS: Readonly<Record<string, string>> = {
  'ي': 'ی', // ي Arabic yeh → ی Farsi yeh
  'ى': 'ی', // ى alef maksura → ی
  'ے': 'ے', // ے stays (distinct Urdu letter)
  'ك': 'ک', // ك Arabic kaf → ک keheh
  'ه': 'ہ', // ه heh → ہ heh goal (Urdu)
  'ە': 'ہ', // ە ae → ہ
  'ة': 'ہ', // ة teh marbuta → ہ
  'أ': 'ا', // أ → ا
  'إ': 'ا', // إ → ا
  'آ': 'ا', // آ → ا
  'ٱ': 'ا', // ٱ → ا
  'ئ': 'ی', // ئ → ی
  'ؤ': 'و', // ؤ → و
};

/** ۰۱۲… (U+06F0) and ٠١٢… (U+0660) to ASCII digits. */
export function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** The comparable form of a text: see the file comment. */
export function foldSearchText(text: string): string {
  if (!text) return '';
  let out = text.normalize('NFKC').toLowerCase();
  out = toAsciiDigits(out).replace(ARABIC_DIACRITICS, '');
  let folded = '';
  for (const ch of out) {
    folded += LETTER_FOLDS[ch] ?? ch;
  }
  return folded.replace(/\s+/g, ' ').trim();
}

/** True when every word of `query` appears in at least one of `fields` (folded, any order). Empty query: true. */
export function matchesSearch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const needle = foldSearchText(query);
  if (!needle) return true;
  const haystack = fields.map((f) => foldSearchText(f ?? '')).join('\n');
  return needle.split(' ').every((word) => haystack.includes(word));
}
