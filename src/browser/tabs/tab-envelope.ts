/**
 * Reading and writing the persisted tab envelope (MMKV `vidorax.mmkv.browser.tabs.v1`). Pure — the URL rules come in
 * as parameters so `tab-envelope.test.ts` runs under Node.
 *
 * Envelopes are read **by the fields they have, not by their version number** (another branch may raise the version
 * too, and an unknown version must never cost the user their tabs):
 * - tabs carrying a numeric `position` (written since B1, schema 2) come back in that order — the user's drag order;
 * - tabs without one (schema 1) come back as before: most recently used first;
 * - `pinned` is read when present (false otherwise), and pinned tabs always lead.
 * Unknown fields are ignored; broken entries are dropped; at most `maxTabs` survive (the active tab always does).
 */

export type EnvelopeTab = {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  desktopMode: boolean;
  desktopModeSource: 'default' | 'user' | 'platform';
  pinned: boolean;
};

export type ParsedTabsEnvelope = {
  activeTabId: string;
  tabs: EnvelopeTab[];
  updatedAt: number;
};

export type EnvelopeRules = {
  homeUrl: string;
  isHomeUrl: (url: string) => boolean;
  /** Removes auth secrets from a restored page URL. */
  sanitizeUrl: (url: string) => string;
  maxTabs: number;
  now: number;
};

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

type RawTab = Partial<EnvelopeTab> & { position?: unknown };

function readTab(raw: unknown, rules: EnvelopeRules): (EnvelopeTab & { position: number | null }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as RawTab;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  const home = url !== '' && rules.isHomeUrl(url);
  if (!id || !(home || isHttpUrl(url))) return null;
  const createdAt = typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : rules.now;
  const lastActiveAt =
    typeof obj.lastActiveAt === 'number' && Number.isFinite(obj.lastActiveAt) ? obj.lastActiveAt : createdAt;
  const source = obj.desktopModeSource;
  return {
    id,
    url: home ? rules.homeUrl : rules.sanitizeUrl(url),
    title: typeof obj.title === 'string' ? obj.title.slice(0, 255) : '',
    createdAt,
    lastActiveAt,
    desktopMode: Boolean(obj.desktopMode),
    desktopModeSource: source === 'user' || source === 'platform' ? source : 'default',
    pinned: obj.pinned === true,
    position: typeof obj.position === 'number' && Number.isFinite(obj.position) ? obj.position : null,
  };
}

export function parseTabsEnvelope(raw: unknown, rules: EnvelopeRules): ParsedTabsEnvelope | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { activeTabId?: unknown; tabs?: unknown; updatedAt?: unknown };
  const list = Array.isArray(obj.tabs) ? obj.tabs : [];
  const seen = new Set<string>();
  const tabs: (EnvelopeTab & { position: number | null })[] = [];
  for (const entry of list) {
    const tab = readTab(entry, rules);
    if (!tab || seen.has(tab.id)) continue;
    seen.add(tab.id);
    tabs.push(tab);
  }
  if (tabs.length === 0) return null;

  const positioned = tabs.every((t) => t.position != null);
  const ordered = positioned
    ? tabs.map((t, i) => ({ t, i })).sort((a, b) => a.t.position! - b.t.position! || a.i - b.i).map((x) => x.t)
    : [...tabs].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const withPins = [...ordered.filter((t) => t.pinned), ...ordered.filter((t) => !t.pinned)];

  let activeTabId = typeof obj.activeTabId === 'string' ? obj.activeTabId.trim() : '';
  if (!withPins.some((t) => t.id === activeTabId)) {
    activeTabId = (positioned ? [...withPins].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] : withPins[0])!.id;
  }

  // Over the limit: keep the active tab plus the first others, in order.
  let kept = withPins;
  if (kept.length > rules.maxTabs) {
    const keepIds = new Set([activeTabId, ...kept.filter((t) => t.id !== activeTabId).slice(0, rules.maxTabs - 1).map((t) => t.id)]);
    kept = kept.filter((t) => keepIds.has(t.id));
  }

  return {
    activeTabId,
    tabs: kept.map(({ position: _position, ...tab }) => tab),
    updatedAt: typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : rules.now,
  };
}

/** Schema 2 tab row: schema 1's fields plus `pinned` and `position` (the list order). */
export function envelopeTabsForWrite<T extends Omit<EnvelopeTab, 'pinned'> & { pinned?: boolean }>(
  tabs: readonly T[],
): (EnvelopeTab & { position: number })[] {
  return tabs.map((tab, position) => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    createdAt: tab.createdAt,
    lastActiveAt: tab.lastActiveAt,
    desktopMode: tab.desktopMode,
    desktopModeSource: tab.desktopModeSource,
    pinned: tab.pinned === true,
    position,
  }));
}
