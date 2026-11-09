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

const URDU_LETTERS = /[ٹڈڑںےھۃۓ]/g;
const PERSIAN_LETTERS = /[پچژگکی]/g;

const SCRIPTS: { lang: string; re: RegExp }[] = [
  { lang: 'arabic-script', re: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g },
  { lang: 'ja', re: /[぀-ヿ]/g },
  { lang: 'ko', re: /[가-힯ᄀ-ᇿ]/g },
  { lang: 'zh', re: /[一-鿿]/g },
  { lang: 'ru', re: /[Ѐ-ӿ]/g },
  { lang: 'hi', re: /[ऀ-ॿ]/g },
  { lang: 'bn', re: /[ঀ-৿]/g },
  { lang: 'pa', re: /[਀-੿]/g },
  { lang: 'ta', re: /[஀-௿]/g },
  { lang: 'th', re: /[฀-๿]/g },
  { lang: 'el', re: /[Ͱ-Ͽ]/g },
  { lang: 'he', re: /[֐-׿]/g },
  { lang: 'latin', re: /[A-Za-zÀ-ɏ]/g },
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
  if (best.lang === 'zh' && count(text, /[぀-ヿ]/g) >= 10) return 'ja';
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
