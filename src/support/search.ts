import type { SupportCategory, SupportFaqItem } from './types';

export type SupportSearchTranslate = (key: string) => string;

export type SupportSearchHit = {
  readonly item: SupportFaqItem;
  readonly score: number;
};

function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,،;|/]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function contains(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}

function startsWithWord(haystack: string, needle: string): boolean {
  if (haystack.startsWith(needle)) {
    return true;
  }
  return haystack.split(/\s+/).some((word) => word.startsWith(needle));
}

/**
 * Local ranked FAQ search. Instant, offline, no React Query / network / FS.
 *
 * Ranking:
 * 1. Exact / starts-with question
 * 2. Question contains
 * 3. Keyword / category contains
 * 4. Answer contains (lowest)
 */
export function searchSupportFaqs(input: {
  query: string;
  faqs: readonly SupportFaqItem[];
  categories: readonly SupportCategory[];
  t: SupportSearchTranslate;
}): SupportFaqItem[] {
  const needle = normalizeQuery(input.query);
  if (!needle) {
    return [];
  }

  const categoryTitleById = new Map(
    input.categories.map((c) => [c.id, normalizeQuery(input.t(c.titleKey))]),
  );

  const hits: SupportSearchHit[] = [];

  for (const item of input.faqs) {
    const question = normalizeQuery(input.t(item.questionKey));
    const answer = normalizeQuery(input.t(item.answerKey));
    const categoryTitle = categoryTitleById.get(item.categoryId) ?? '';
    const keywords = item.keywordsKey
      ? splitKeywords(input.t(item.keywordsKey))
      : [];

    let score = 0;

    if (question === needle) {
      score = 100;
    } else if (startsWithWord(question, needle) || question.startsWith(needle)) {
      score = 80;
    } else if (contains(question, needle)) {
      score = 60;
    } else if (
      keywords.some(
        (kw) => kw === needle || contains(kw, needle) || contains(needle, kw),
      ) ||
      contains(categoryTitle, needle)
    ) {
      score = 40;
    } else if (contains(answer, needle)) {
      score = 20;
    }

    if (score > 0) {
      hits.push({ item, score });
    }
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.item.id.localeCompare(b.item.id);
  });

  return hits.map((hit) => hit.item);
}
