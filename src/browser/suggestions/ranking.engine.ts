import {
  SUGGESTION_BASE_SCORES,
  SUGGESTION_MATCH_BONUS,
} from './constants';
import type { OmniboxSuggestion, RankableCandidate } from './types';

function visitBonus(visitCount: number | undefined): number {
  if (!visitCount || visitCount < 1) {
    return 0;
  }

  return Math.min(
    visitCount * SUGGESTION_MATCH_BONUS.visitCountUnit,
    SUGGESTION_MATCH_BONUS.visitCountCap,
  );
}

function matchBonus(candidate: RankableCandidate): number {
  let bonus = 0;

  if (candidate.exactTitle) {
    bonus += SUGGESTION_MATCH_BONUS.exactTitle;
  }
  if (candidate.titleStartsWith) {
    bonus += SUGGESTION_MATCH_BONUS.titleStartsWith;
  }
  if (candidate.hostnameStartsWith) {
    bonus += SUGGESTION_MATCH_BONUS.hostnameStartsWith;
  }
  if (candidate.urlStartsWith) {
    bonus += SUGGESTION_MATCH_BONUS.urlStartsWith;
  }
  if (candidate.titleIncludes) {
    bonus += SUGGESTION_MATCH_BONUS.titleIncludes;
  }
  if (candidate.hostnameIncludes) {
    bonus += SUGGESTION_MATCH_BONUS.hostnameIncludes;
  }
  if (candidate.urlIncludes) {
    bonus += SUGGESTION_MATCH_BONUS.urlIncludes;
  }

  return bonus;
}

/**
 * Deterministic base score by suggestion kind / match class.
 * Future AI ranking plugs in by adjusting scores before sort — never replace this order contract.
 */
export function scoreCandidate(candidate: RankableCandidate): number {
  let base: number = SUGGESTION_BASE_SCORES.search;

  switch (candidate.kind) {
    case 'exact_url':
      base = SUGGESTION_BASE_SCORES.exact_url;
      break;
    case 'bookmark':
      base = candidate.exactUrl || candidate.exactTitle
        ? SUGGESTION_BASE_SCORES.bookmark_exact
        : SUGGESTION_BASE_SCORES.bookmark_partial;
      break;
    case 'history':
      base = candidate.exactUrl || candidate.exactTitle
        ? SUGGESTION_BASE_SCORES.history_exact
        : SUGGESTION_BASE_SCORES.history_partial;
      break;
    case 'frequent':
      base = SUGGESTION_BASE_SCORES.frequent;
      break;
    case 'domain':
      base = SUGGESTION_BASE_SCORES.domain;
      break;
    case 'recent_search':
      base = SUGGESTION_BASE_SCORES.recent_search;
      break;
    case 'search':
      base = SUGGESTION_BASE_SCORES.search;
      break;
    case 'remote_suggest':
      base = SUGGESTION_BASE_SCORES.remote_suggest;
      break;
    default:
      base = SUGGESTION_BASE_SCORES.search;
  }

  return base + matchBonus(candidate) + visitBonus(candidate.visitCount);
}

/**
 * Rank candidates deterministically:
 * 1. Exact URL
 * 2. Exact Bookmark
 * 3. Exact History
 * 4. Frequently Visited
 * 5. Partial Bookmark
 * 6. Partial History
 * 7. Domain Match
 * 8. Search Suggestion
 */
export function rankSuggestions(
  candidates: RankableCandidate[],
  query: string,
  limit: number,
): OmniboxSuggestion[] {
  const scored = candidates.map((candidate) => ({
    ...candidate,
    score: scoreCandidate(candidate),
    query,
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // Stable tie-breakers for deterministic order.
    const titleCmp = a.title.localeCompare(b.title);
    if (titleCmp !== 0) {
      return titleCmp;
    }

    return a.url.localeCompare(b.url);
  });

  const seen = new Set<string>();
  const results: OmniboxSuggestion[] = [];

  for (const item of scored) {
    const dedupeKey = `${item.kind}:${item.url.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    // Prefer bookmark over history for the same URL when both appear.
    const urlKey = item.url.toLowerCase();
    if (item.kind === 'history' && seen.has(`bookmark:${urlKey}`)) {
      continue;
    }
    if (item.kind === 'frequent' && (seen.has(`bookmark:${urlKey}`) || seen.has(`history:${urlKey}`))) {
      continue;
    }

    seen.add(dedupeKey);
    if (item.kind === 'bookmark') {
      seen.add(`bookmark:${urlKey}`);
    }
    if (item.kind === 'history') {
      seen.add(`history:${urlKey}`);
    }

    results.push({
      id: item.id,
      kind: item.kind,
      source: item.source,
      title: item.title,
      subtitle: item.subtitle,
      url: item.url,
      hostname: item.hostname,
      faviconUrl: item.faviconUrl,
      score: item.score,
      visitCount: item.visitCount,
      visitedAt: item.visitedAt,
      bookmarked: item.bookmarked,
      query,
    });

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

export const searchRankingEngine = {
  scoreCandidate,
  rankSuggestions,
} as const;
