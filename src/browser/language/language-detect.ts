/**
 * B23 #263 — the page's language: from `<html lang>`, otherwise from the script of its text. Arabic-script text is
 * told apart by its letters: Urdu's own letters (ٹ ڈ ڑ ں ے ھ ۃ ۓ) mean Urdu; otherwise Persian's (پ چ ژ گ ک ی) mean
 * Persian; otherwise Arabic. Latin text can't be told apart by script (null). Pure; tested under Node.
 */

export const LANGUAGE_MESSAGE_SCRIPT = `(function () {
  try {
    var root = document.documentElement;
    var body = document.body;
    var sample = body ? String(body.innerText || body.textContent || '').slice(0, 3000) : '';
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'vidorax_annotate', kind: 'lang',
      lang: root && root.getAttribute('lang') || '', sample: sample }));
  } catch (e) {}
})();
true;`;

const URDU_LETTERS = /[\u0679\u0688\u0691\u06BA\u06D2\u06BE\u06C3\u06D3]/g;
const PERSIAN_LETTERS = /[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/g;

const SCRIPTS: { lang: string; re: RegExp }[] = [
  { lang: 'arabic-script', re: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g },
  { lang: 'ja', re: /[\u3040-\u30FF]/g },
  { lang: 'ko', re: /[\uAC00-\uD7AF\u1100-\u11FF]/g },
  { lang: 'zh', re: /[\u4E00-\u9FFF]/g },
  { lang: 'ru', re: /[\u0400-\u04FF]/g },
  { lang: 'hi', re: /[\u0900-\u097F]/g },
  { lang: 'bn', re: /[\u0980-\u09FF]/g },
  { lang: 'pa', re: /[\u0A00-\u0A7F]/g },
  { lang: 'ta', re: /[\u0B80-\u0BFF]/g },
  { lang: 'th', re: /[\u0E00-\u0E7F]/g },
  { lang: 'el', re: /[\u0370-\u03FF]/g },
  { lang: 'he', re: /[\u0590-\u05FF]/g },
  { lang: 'latin', re: /[A-Za-z\u00C0-\u024F]/g },
];

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

/** `<html lang>` → its primary language ('ur-PK' → 'ur'), or null. */
export function languageFromAttribute(lang: string): string | null {
  const primary = lang.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/** The language of a text sample by its script, or null (too little text, or Latin). */
export function languageFromText(sample: string): string | null {
  const text = sample.slice(0, 4000);
  let best: { lang: string; n: number } | null = null;
  for (const s of SCRIPTS) {
    const n = count(text, s.re);
    if (!best || n > best.n) best = { lang: s.lang, n };
  }
  if (!best || best.n < 20) return null;
  if (best.lang === 'latin') return null;
  // Japanese pages mix kana with kanji: any amount of kana is Japanese.
  if (best.lang === 'zh' && count(text, /[\u3040-\u30FF]/g) >= 10) return 'ja';
  if (best.lang !== 'arabic-script') return best.lang;
  if (count(text, URDU_LETTERS) >= 3) return 'ur';
  if (count(text, PERSIAN_LETTERS) >= 3) return 'fa';
  return 'ar';
}

/**
 * The page's language: `<html lang>` first, except where the text contradicts it in script (a page marked 'en' but
 * written in Urdu — common on Urdu news sites).
 */
export function detectPageLanguage(input: { lang: string; sample: string }): string | null {
  const attr = languageFromAttribute(input.lang);
  const byText = languageFromText(input.sample);
  if (byText && (!attr || attr === 'en')) return byText;
  return attr ?? byText;
}

export type TranslateOfferInput = {
  language: string | null;
  appLanguage: string;
  host: string;
  offeredHosts: ReadonlySet<string>;
  neverLanguages: readonly string[];
  neverSites: readonly string[];
  enabled: boolean;
  incognito: boolean;
};

/** Offer "Translate this page?" once per site, not in the app's language, not where the user said never. */
export function shouldOfferTranslate(input: TranslateOfferInput): boolean {
  if (!input.enabled || input.incognito || !input.language || !input.host) return false;
  if (input.language === input.appLanguage) return false;
  if (input.offeredHosts.has(input.host)) return false;
  if (input.neverLanguages.includes(input.language) || input.neverSites.includes(input.host)) return false;
  return true;
}

/** A JSON list of short strings (settings), cleaned; at most `max`. */
export function parseStringList(raw: unknown, max = 200): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 253))].slice(-max);
  } catch {
    return [];
  }
}
