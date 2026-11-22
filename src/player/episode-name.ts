/**
 * P6 #733 Next Episode Prompt: does the next video look like the next episode of this one? Only then does the
 * "Next: …" card show. Pure (unit-tested). Names are compared without their file extension, in lower case, with dots,
 * underscores, dashes and runs of spaces read as one space.
 *
 * The next one is the next episode when:
 * 1. both have a season and episode ("S01E02", "s1e2", "1x02"): the same show, and the next episode of the season or
 *    the first of the next season;
 * 2. both have an episode word and number ("Ep 3", "Ep. 3", "Episode 4", "E04", Urdu "قسط 5"): the same show and the
 *    next number;
 * 3. or the names are the same except for one number, which is one more ("Drama 12" → "Drama 13").
 */

type Episode = { show: string; season: number | null; episode: number };

const EXTENSION = /\.[a-z0-9]{2,4}$/i;
const SEASON_EPISODE = /(?:^|[^a-z0-9])s(\d{1,3})\s?e(\d{1,4})(?![0-9])/i;
const CROSS_EPISODE = /(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?![0-9])/i;
const EPISODE_WORD = /(?:^|[^a-z0-9])(?:episode|ep\.?|e)\s?(\d{1,4})(?![0-9])/i;
const URDU_EPISODE = /قسط\s?(\d{1,4})(?![0-9])/;

/** A name made comparable: no extension, lower case, separators as single spaces. */
export function normalizeEpisodeName(name: string): string {
  return name
    .trim()
    .replace(EXTENSION, '')
    .toLowerCase()
    .replace(/[._\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function showOf(normalized: string, matchIndex: number): string {
  return normalized.slice(0, matchIndex).replace(/[\s([]+$/, '').trim();
}

/** The season and episode a name carries, if any (with the show's name before them). */
export function parseEpisode(name: string): Episode | null {
  const normalized = normalizeEpisodeName(name);
  const seasonEpisode = SEASON_EPISODE.exec(normalized) ?? CROSS_EPISODE.exec(normalized);
  if (seasonEpisode) {
    return {
      show: showOf(normalized, seasonEpisode.index),
      season: Number(seasonEpisode[1]),
      episode: Number(seasonEpisode[2]),
    };
  }
  const word = EPISODE_WORD.exec(normalized) ?? URDU_EPISODE.exec(normalized);
  if (word) {
    return { show: showOf(normalized, word.index), season: null, episode: Number(word[1]) };
  }
  return null;
}

/** Splits a name into alternating text and number runs ("drama 12 hd" → ["drama ", "12", " hd"]). */
function runs(normalized: string): string[] {
  return normalized.match(/\d+|\D+/g) ?? [];
}

/** Rule 3: the same name except one number, which is one more. */
function nextByNumber(current: string, next: string): boolean {
  const a = runs(current);
  const b = runs(next);
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  let differing = 0;
  let isNext = false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) {
      continue;
    }
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (!numeric) {
      return false;
    }
    differing += 1;
    isNext = Number(y) === Number(x) + 1;
  }
  return differing === 1 && isNext;
}

/** Whether `nextName` looks like the episode after `currentName`. */
export function looksLikeNextEpisode(currentName: string | null, nextName: string | null): boolean {
  if (!currentName || !nextName) {
    return false;
  }
  const current = parseEpisode(currentName);
  const next = parseEpisode(nextName);
  if (current && next && current.show === next.show) {
    if (current.season != null && next.season != null) {
      return (
        (next.season === current.season && next.episode === current.episode + 1) ||
        (next.season === current.season + 1 && next.episode === 1)
      );
    }
    if (current.season == null && next.season == null) {
      return next.episode === current.episode + 1;
    }
  }
  return nextByNumber(normalizeEpisodeName(currentName), normalizeEpisodeName(nextName));
}
