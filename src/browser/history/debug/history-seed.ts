/**
 * B10 test aid — old history entries to try the time ranges and the 5,000-entry search on a debug build. Pure.
 * Only `HistorySeedRow` (debug builds only) uses it; release bundles never include either file.
 */

export type SeedVisit = { url: string; title: string; visitedAt: string };

const SITES: readonly { host: string; title: string }[] = [
  { host: 'en.wikipedia.org', title: 'Lahore — Wikipedia' },
  { host: 'ur.wikipedia.org', title: 'لاہور — ویکیپیڈیا' },
  { host: 'www.bbc.com', title: 'BBC News' },
  { host: 'www.bbc.com', title: 'بی بی سی اردو' },
  { host: 'developer.android.com', title: 'Android Developers' },
  { host: 'news.ycombinator.com', title: 'Hacker News' },
  { host: 'www.dawn.com', title: 'Dawn — Pakistan news' },
  { host: 'example.com', title: 'Example Domain' },
];

/** The first entries fall in each range (minutes ago); the rest spread evenly over 8 weeks. */
const RANGE_MARKERS_MIN = [5, 30, 3 * 60, 20 * 60, 3 * 24 * 60, 6 * 24 * 60, 14 * 24 * 60, 27 * 24 * 60, 40 * 24 * 60];
const SPAN_MS = 56 * 24 * 60 * 60 * 1000;

export function planHistorySeed(count: number, nowMs: number): SeedVisit[] {
  const total = Math.max(0, Math.min(10_000, Math.trunc(count)));
  const visits: SeedVisit[] = [];
  for (let i = 0; i < total; i += 1) {
    const site = SITES[i % SITES.length];
    const ageMs =
      i < RANGE_MARKERS_MIN.length ? RANGE_MARKERS_MIN[i] * 60_000 : Math.round(((i + 1) / total) * SPAN_MS);
    visits.push({
      url: `https://${site.host}/seed/${i}`,
      title: `${site.title} ${i}`,
      visitedAt: new Date(nowMs - ageMs).toISOString(),
    });
  }
  return visits;
}
