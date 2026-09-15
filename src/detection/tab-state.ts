/**
 * Pure per-tab reducers behind the detection store. Each returns the same object when nothing changed, so
 * zustand selectors on unchanged tabs do not re-render.
 *
 * Rules: a tab is reset only when a new top-level document starts. Candidates merge by key (sources are
 * unioned, the metadata of the most trustworthy provenance wins, lastSeenAt is bumped). A site-keyed
 * candidate absorbs `url:` items that share one of its sources, and a `url:` candidate for media a site item
 * already owns merges into that item. At most MAX_ITEMS_PER_TAB items, least recently seen evicted first.
 */
import type {
  CandidateProvenance,
  CandidateSource,
  DetectorMessage,
  ItemAvailability,
  MediaItem,
  PageCandidate,
  PlayerHint,
  TabMedia,
} from './types.ts';
import { groupingKey, isPolicyBlockedUrl, isUnderDirectoryOf } from './url.ts';

export const MAX_ITEMS_PER_TAB = 60;
const MAX_SOURCES_PER_ITEM = 24;
const MAX_PLAYER_FRAMES = 8;

export interface TrackedItem extends MediaItem {
  /** Provenance of the most trustworthy candidate merged so far; its metadata wins. */
  provenance: CandidateProvenance;
  /** Bumped when sources change, so a resolution started for older sources is discarded. */
  revision: number;
  /** Last time the network showed this item's media being fetched (range requests or segments). */
  activeAt: number | null;
}

export interface TabState extends TabMedia {
  items: Record<string, TrackedItem>;
  /** Increments on every top-level document start; async work for an older document is discarded. */
  documentId: number;
  pageTitle: string | null;
  /** User-Agent reported by the main frame. */
  userAgent: string | null;
  /** Latest player hints per frame URL. */
  players: Record<string, PlayerHint[]>;
}

export interface CandidateOrigin {
  /** Frame (or observed Referer) the media was found in. */
  frameUrl: string;
  userAgent: string;
}

const PROVENANCE_RANK: Record<CandidateProvenance, number> = {
  json: 4,
  'manifest-body': 3,
  dom: 2,
  'web-download': 1,
  network: 0,
};

export function startDocument(previous: TabState | undefined, url: string): TabState {
  return {
    documentUrl: url,
    currentUrl: url,
    items: {},
    order: [],
    drmDetected: false,
    policyBlocked: isPolicyBlockedUrl(url) ? 'youtube' : null,
    documentId: (previous?.documentId ?? 0) + 1,
    pageTitle: null,
    userAgent: previous?.userAgent ?? null,
    players: {},
  };
}

/** SPA navigation: only the current URL changes; items stay. */
export function changeUrl(tab: TabState | undefined, url: string): TabState {
  if (!tab) {
    return startDocument(undefined, url);
  }
  return tab.currentUrl === url ? tab : { ...tab, currentUrl: url };
}

export function applyMessage(tab: TabState, message: DetectorMessage, now: number): TabState {
  const { frame } = message;
  switch (message.type) {
    case 'hello':
      return frame.isMain && frame.userAgent && frame.userAgent !== tab.userAgent
        ? { ...tab, userAgent: frame.userAgent }
        : tab;
    case 'nav': {
      if (!frame.isMain) {
        return tab;
      }
      const pageTitle = message.title ?? (message.url === tab.currentUrl ? tab.pageTitle : null);
      return message.url === tab.currentUrl && pageTitle === tab.pageTitle
        ? tab
        : { ...tab, currentUrl: message.url, pageTitle };
    }
    case 'candidates': {
      const origin = { frameUrl: frame.url, userAgent: frame.userAgent };
      return message.candidates.reduce((next, candidate) => upsertCandidate(next, candidate, origin, now), tab);
    }
    case 'players':
      return setPlayers(tab, frame.url, message.players);
    case 'drm':
      return tab.drmDetected ? tab : { ...tab, drmDetected: true };
    case 'policy':
      return tab.policyBlocked === message.blocked ? tab : { ...tab, policyBlocked: message.blocked };
  }
}

export function upsertCandidate(
  tab: TabState,
  candidate: PageCandidate,
  origin: CandidateOrigin,
  now: number,
): TabState {
  const sources = candidate.sources.filter(isAllowedSource);
  const key = sources.length ? canonicalKey(candidate.key, sources) : null;
  if (!key) {
    return tab;
  }
  const incoming: PageCandidate = { ...candidate, key, sources };
  const identities = new Set(sources.map(sourceIdentity));
  const overlapping = tab.order.filter(
    (existingKey) =>
      existingKey !== key &&
      tab.items[existingKey].sources.some((source) => {
        const identity = sourceIdentity(source);
        return identity !== null && identities.has(identity);
      }),
  );
  const isUrlKey = key.startsWith('url:');
  const targetKey = (isUrlKey && overlapping.find((existingKey) => !existingKey.startsWith('url:'))) || key;
  const absorbed = isUrlKey ? [] : overlapping.filter((existingKey) => existingKey.startsWith('url:'));

  let item = mergeCandidate(tab.items[targetKey], targetKey, incoming, origin, now);
  for (const absorbedKey of absorbed) {
    item = absorbItem(item, tab.items[absorbedKey]);
  }

  const items = { ...tab.items, [targetKey]: item };
  for (const absorbedKey of absorbed) {
    delete items[absorbedKey];
  }
  const removed = new Set([targetKey, ...absorbed]);
  const order = [...tab.order.filter((existingKey) => !removed.has(existingKey)), targetKey];
  for (const evicted of order.splice(0, Math.max(0, order.length - MAX_ITEMS_PER_TAB))) {
    delete items[evicted];
  }
  return { ...tab, items, order };
}

/** Marks items whose media `url` belongs to: the progressive file itself, or a segment under a manifest. */
export function markActivity(tab: TabState, url: string, at: number): TabState {
  const key = cachedGroupingKey(url);
  let items = tab.items;
  for (const itemKey of tab.order) {
    const item = tab.items[itemKey];
    if ((item.activeAt ?? 0) >= at || !item.sources.some((source) => sourceServes(source, url, key))) {
      continue;
    }
    if (items === tab.items) {
      items = { ...tab.items };
    }
    items[itemKey] = { ...item, activeAt: at };
  }
  return items === tab.items ? tab : { ...tab, items };
}

/** Ignored when the item is gone or its sources changed since the resolution started. */
export function setItemAvailability(
  tab: TabState,
  key: string,
  revision: number,
  availability: ItemAvailability,
): TabState {
  const item = tab.items[key];
  if (!item || item.revision !== revision || item.availability === availability) {
    return tab;
  }
  return { ...tab, items: { ...tab.items, [key]: { ...item, availability } } };
}

function mergeCandidate(
  base: TrackedItem | undefined,
  key: string,
  candidate: PageCandidate,
  origin: CandidateOrigin,
  now: number,
): TrackedItem {
  if (!base) {
    return {
      key,
      site: candidate.site,
      title: candidate.title ?? '',
      thumbnailUrl: candidate.thumbnailUrl ?? null,
      durationSec: candidate.durationSec ?? null,
      contentUrl: candidate.contentUrl ?? null,
      sources: candidate.sources.slice(0, MAX_SOURCES_PER_ITEM),
      frameUrl: origin.frameUrl,
      userAgent: origin.userAgent,
      firstSeenAt: now,
      lastSeenAt: now,
      availability: { status: 'unresolved' },
      provenance: candidate.provenance,
      revision: 0,
      activeAt: null,
    };
  }
  const wins = PROVENANCE_RANK[candidate.provenance] > PROVENANCE_RANK[base.provenance];
  const pick = <T>(current: T | null, next: T | undefined): T | null =>
    wins ? (next ?? current) : (current ?? next ?? null);
  const { sources, changed } = mergeSources(base.sources, candidate.sources);
  return {
    ...base,
    site: candidate.site !== 'web' && (wins || base.site === 'web') ? candidate.site : base.site,
    title: (wins ? candidate.title || base.title : base.title || candidate.title) ?? '',
    thumbnailUrl: pick(base.thumbnailUrl, candidate.thumbnailUrl),
    durationSec: pick(base.durationSec, candidate.durationSec),
    contentUrl: pick(base.contentUrl, candidate.contentUrl),
    sources,
    frameUrl: (wins ? origin.frameUrl || base.frameUrl : base.frameUrl || origin.frameUrl),
    userAgent: (wins ? origin.userAgent || base.userAgent : base.userAgent || origin.userAgent),
    lastSeenAt: now,
    provenance: wins ? candidate.provenance : base.provenance,
    revision: changed ? base.revision + 1 : base.revision,
    availability: changed ? { status: 'unresolved' } : base.availability,
  };
}

function absorbItem(target: TrackedItem, other: TrackedItem): TrackedItem {
  const merged = mergeCandidate(
    target,
    target.key,
    {
      key: other.key,
      site: other.site,
      title: other.title || undefined,
      thumbnailUrl: other.thumbnailUrl ?? undefined,
      durationSec: other.durationSec ?? undefined,
      contentUrl: other.contentUrl ?? undefined,
      sources: other.sources,
      provenance: other.provenance,
    },
    { frameUrl: other.frameUrl, userAgent: other.userAgent },
    target.lastSeenAt,
  );
  return {
    ...merged,
    firstSeenAt: Math.min(target.firstSeenAt, other.firstSeenAt),
    activeAt: Math.max(target.activeAt ?? 0, other.activeAt ?? 0) || null,
  };
}

/**
 * Union by source identity. A re-sighted source takes the incoming values (fresher signed URL) and keeps
 * fields the incoming one lacks. Only new sources or changed media metadata count as a change; a URL-only
 * refresh keeps resolved options.
 */
function mergeSources(
  existing: CandidateSource[],
  incoming: CandidateSource[],
): { sources: CandidateSource[]; changed: boolean } {
  const sources = [...existing];
  let changed = false;
  for (const source of incoming) {
    const index = sources.findIndex((candidate) => sameSource(candidate, source));
    if (index < 0) {
      if (sources.length < MAX_SOURCES_PER_ITEM) {
        sources.push(source);
        changed = true;
      }
      continue;
    }
    const merged = mergeSource(sources[index], source);
    if (describeSource(merged) !== describeSource(sources[index])) {
      changed = true;
    }
    sources[index] = merged;
  }
  return { sources, changed };
}

function mergeSource(current: CandidateSource, incoming: CandidateSource): CandidateSource {
  const merged: Record<string, unknown> = { ...current };
  for (const [field, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== null) {
      merged[field] = value;
    }
  }
  return merged as unknown as CandidateSource;
}

function describeSource(source: CandidateSource): string {
  switch (source.kind) {
    case 'progressive':
      return [
        source.width,
        source.height,
        source.bitrate,
        source.mimeType,
        source.hasAudio,
        source.watermarked,
        source.sizeBytes,
        source.audioUrl === undefined ? '' : cachedGroupingKey(source.audioUrl),
      ].join('|');
    case 'hls':
      return [source.width, source.height, source.bitrate].join('|');
    case 'dash':
      return '';
  }
}

function sameSource(a: CandidateSource, b: CandidateSource): boolean {
  if (a.kind === 'dash' && b.kind === 'dash' && (a.manifestText || b.manifestText)) {
    return a.url === b.url && a.manifestText === b.manifestText;
  }
  const identity = sourceIdentity(a);
  return identity !== null && identity === sourceIdentity(b);
}

/** Null for inline DASH manifests: their URL is only a base URL (often the page) and identifies nothing. */
function sourceIdentity(source: CandidateSource): string | null {
  if (source.kind === 'dash' && source.manifestText) {
    return null;
  }
  const key = cachedGroupingKey(source.url);
  return key === null ? null : `${source.kind}|${key}`;
}

function sourceServes(source: CandidateSource, url: string, key: string | null): boolean {
  if (source.kind === 'progressive') {
    return (
      key !== null &&
      (cachedGroupingKey(source.url) === key ||
        (source.audioUrl !== undefined && cachedGroupingKey(source.audioUrl) === key))
    );
  }
  return !(source.kind === 'dash' && source.manifestText) && isUnderDirectoryOf(url, source.url);
}

function canonicalKey(key: string, sources: CandidateSource[]): string | null {
  if (!key.startsWith('url:')) {
    return key;
  }
  const grouped = cachedGroupingKey(key.slice(4)) ?? cachedGroupingKey(sources[0].url);
  return grouped === null ? null : `url:${grouped}`;
}

function isAllowedSource(source: CandidateSource): boolean {
  return (
    !isPolicyBlockedUrl(source.url) &&
    !(source.kind === 'progressive' && source.audioUrl !== undefined && isPolicyBlockedUrl(source.audioUrl))
  );
}

function setPlayers(tab: TabState, frameUrl: string, players: PlayerHint[]): TabState {
  if (players.length === 0 && !(frameUrl in tab.players)) {
    return tab;
  }
  // Re-inserting moves the frame to the end, so the oldest frames are evicted first.
  const entries = Object.entries(tab.players).filter(([url]) => url !== frameUrl);
  if (players.length) {
    entries.push([frameUrl, players]);
  }
  return { ...tab, players: Object.fromEntries(entries.slice(-MAX_PLAYER_FRAMES)) };
}

// Grouping keys are recomputed for every merge and activity check; parsing is the hot path on busy feeds.
const MAX_CACHED_KEYS = 2000;
const groupingKeyCache = new Map<string, string | null>();

function cachedGroupingKey(url: string): string | null {
  const cached = groupingKeyCache.get(url);
  if (cached !== undefined) {
    return cached;
  }
  if (groupingKeyCache.size >= MAX_CACHED_KEYS) {
    groupingKeyCache.clear();
  }
  const key = groupingKey(url);
  groupingKeyCache.set(url, key);
  return key;
}
