/**
 * B2 — tab groups, the timeline and group history: the pure rules (tested under Node). The tab list itself (order,
 * pins, B1's sorts) stays in the browser store; groups are a layer over it: a group is shown as one block where its
 * first tab is, its tabs in list order (pinned tabs first, as the list has them). Incognito tabs group only with
 * incognito tabs, and those groups are never saved, put in the timeline or in group history.
 */

export const GROUP_COLORS = {
  grey: '#5F6368',
  blue: '#1A73E8',
  red: '#D93025',
  yellow: '#F9AB00',
  green: '#1E8E3E',
  pink: '#D01884',
  purple: '#A142F4',
  cyan: '#007B83',
} as const;
export type GroupColor = keyof typeof GROUP_COLORS;
export const GROUP_COLOR_IDS = Object.keys(GROUP_COLORS) as GroupColor[];

export const MAX_GROUP_NAME = 40;
export const MAX_CLOSED_GROUPS = 10;

export type TabGroup = { id: string; name: string; color: GroupColor; collapsed: boolean; incognito: boolean };
export type GroupsState = { groups: TabGroup[]; membership: Readonly<Record<string, string>> };
export const EMPTY_GROUPS: GroupsState = { groups: [], membership: {} };

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === 'string' && value in GROUP_COLORS;
}

export function cleanGroupName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_GROUP_NAME) : '';
}

/** The colour after the last group's (a new group gets a different one). */
export function nextColor(state: GroupsState): GroupColor {
  const last = state.groups[state.groups.length - 1]?.color;
  const at = last ? GROUP_COLOR_IDS.indexOf(last) : -1;
  return GROUP_COLOR_IDS[(at + 1) % GROUP_COLOR_IDS.length];
}

function dropEmpty(groups: TabGroup[], membership: Record<string, string>): TabGroup[] {
  const used = new Set(Object.values(membership));
  return groups.filter((g) => used.has(g.id));
}

/** A new group of `tabIds` (each leaves its old group). Tabs of the other kind (incognito / normal) are left out. */
export function createGroup(
  state: GroupsState,
  input: { id: string; name: string; color: GroupColor; tabIds: readonly string[]; incognito: boolean },
  isIncognito: (tabId: string) => boolean,
): GroupsState {
  const ids = input.tabIds.filter((id) => isIncognito(id) === input.incognito);
  if (!ids.length) return state;
  const membership = { ...state.membership };
  for (const id of ids) membership[id] = input.id;
  const group: TabGroup = { id: input.id, name: cleanGroupName(input.name), color: input.color, collapsed: false, incognito: input.incognito };
  return { groups: dropEmpty([...state.groups, group], membership), membership };
}

/** Moves a tab into a group of its own kind; anything else changes nothing. */
export function addToGroup(state: GroupsState, tabId: string, groupId: string, isIncognito: (tabId: string) => boolean): GroupsState {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group || group.incognito !== isIncognito(tabId) || state.membership[tabId] === groupId) return state;
  const membership = { ...state.membership, [tabId]: groupId };
  return { groups: dropEmpty(state.groups, membership), membership };
}

export function removeFromGroup(state: GroupsState, tabId: string): GroupsState {
  if (!(tabId in state.membership)) return state;
  const membership = { ...state.membership };
  delete membership[tabId];
  return { groups: dropEmpty(state.groups, membership), membership };
}

export function updateGroup(state: GroupsState, groupId: string, patch: { name?: string; color?: GroupColor; collapsed?: boolean }): GroupsState {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            ...(patch.name !== undefined ? { name: cleanGroupName(patch.name) } : {}),
            ...(patch.color && isGroupColor(patch.color) ? { color: patch.color } : {}),
            ...(patch.collapsed !== undefined ? { collapsed: patch.collapsed } : {}),
          }
        : g,
    ),
  };
}

/** The group goes; its tabs stay open, ungrouped. */
export function ungroup(state: GroupsState, groupId: string): GroupsState {
  const membership = Object.fromEntries(Object.entries(state.membership).filter(([, g]) => g !== groupId));
  return { groups: state.groups.filter((g) => g.id !== groupId), membership };
}

/** Closed tabs leave their groups; empty groups go. */
export function pruneTabs(state: GroupsState, openTabIds: ReadonlySet<string>): GroupsState {
  const entries = Object.entries(state.membership).filter(([id]) => openTabIds.has(id));
  if (entries.length === Object.keys(state.membership).length) return state;
  const membership = Object.fromEntries(entries);
  return { groups: dropEmpty(state.groups, membership), membership };
}

export function tabIdsOf(state: GroupsState, groupId: string, orderedTabIds: readonly string[]): string[] {
  return orderedTabIds.filter((id) => state.membership[id] === groupId);
}

/** The site a tab groups under: its host without "www." ('' for the start page and non-web pages). */
export function siteOf(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/**
 * #258 Group by site: ungrouped normal tabs of the same site (two or more) become one group per site, named after
 * it. Incognito tabs are never touched here.
 */
export function groupBySite(
  state: GroupsState,
  tabs: readonly { id: string; url: string; incognito: boolean }[],
  newId: () => string,
): GroupsState {
  const bySite = new Map<string, string[]>();
  for (const tab of tabs) {
    if (tab.incognito || state.membership[tab.id]) continue;
    const site = siteOf(tab.url);
    if (!site) continue;
    bySite.set(site, [...(bySite.get(site) ?? []), tab.id]);
  }
  let next = state;
  for (const [site, ids] of bySite) {
    if (ids.length < 2) continue;
    next = createGroup(next, { id: newId(), name: site, color: nextColor(next), tabIds: ids, incognito: false }, () => false);
  }
  return next;
}

export type TabRow = { kind: 'tab'; tabId: string; groupId: string | null } | { kind: 'group'; group: TabGroup; tabIds: string[] };

/**
 * The switcher's rows for `orderedTabIds` (B1's order or sort): a group's header where its first tab is, then its tabs
 * in that order (hidden while collapsed); ungrouped tabs as they are.
 */
export function layoutRows(state: GroupsState, orderedTabIds: readonly string[]): TabRow[] {
  const rows: TabRow[] = [];
  const shown = new Set<string>();
  for (const id of orderedTabIds) {
    const groupId = state.membership[id];
    const group = groupId ? state.groups.find((g) => g.id === groupId) : undefined;
    if (!group) {
      rows.push({ kind: 'tab', tabId: id, groupId: null });
      continue;
    }
    if (shown.has(group.id)) continue;
    shown.add(group.id);
    const members = tabIdsOf(state, group.id, orderedTabIds);
    rows.push({ kind: 'group', group, tabIds: members });
    if (!group.collapsed) for (const member of members) rows.push({ kind: 'tab', tabId: member, groupId: group.id });
  }
  return rows;
}

// ---- saving (schema 3 of the tab envelope) ----

export type SavedGroup = { id: string; name: string; color: GroupColor; collapsed: boolean };

/** What the envelope stores: normal groups only, and only for the saved tabs. */
export function groupsForSave(state: GroupsState, savedTabIds: readonly string[]): { groups: SavedGroup[]; membership: Record<string, string> } {
  const normal = new Map(state.groups.filter((g) => !g.incognito).map((g) => [g.id, g]));
  const membership: Record<string, string> = {};
  for (const id of savedTabIds) {
    const groupId = state.membership[id];
    if (groupId && normal.has(groupId)) membership[id] = groupId;
  }
  const used = new Set(Object.values(membership));
  const groups = [...normal.values()].filter((g) => used.has(g.id)).map(({ id, name, color, collapsed }) => ({ id, name, color, collapsed }));
  return { groups, membership };
}

/**
 * Groups from a saved envelope, read by the fields it has (any schema): `groups` (id, name, color, collapsed) and each
 * tab's `groupId`. Unknown fields are ignored; a missing or broken part is simply no groups.
 */
export function groupsFromSave(raw: unknown, keptTabIds: ReadonlySet<string>): GroupsState {
  if (!raw || typeof raw !== 'object') return EMPTY_GROUPS;
  const obj = raw as { groups?: unknown; tabs?: unknown };
  const groups: TabGroup[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(obj.groups) ? obj.groups.slice(0, 200) : []) {
    if (!entry || typeof entry !== 'object') continue;
    const g = entry as Record<string, unknown>;
    const id = typeof g.id === 'string' ? g.id.slice(0, 64) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    groups.push({ id, name: cleanGroupName(g.name), color: isGroupColor(g.color) ? g.color : 'grey', collapsed: g.collapsed === true, incognito: false });
  }
  const membership: Record<string, string> = {};
  for (const entry of Array.isArray(obj.tabs) ? obj.tabs : []) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as Record<string, unknown>;
    if (typeof t.id === 'string' && keptTabIds.has(t.id) && typeof t.groupId === 'string' && seen.has(t.groupId)) membership[t.id] = t.groupId;
  }
  return { groups: dropEmpty(groups, membership), membership };
}

// ---- #259 timeline ----

export type TimelineEntry = { kind: 'open' | 'closed'; id: string; url: string; title: string; at: number };
export type Timeline = { today: TimelineEntry[]; yesterday: TimelineEntry[]; earlier: TimelineEntry[] };

/** Open (by last use) and recently closed (by closing time) tabs, newest first, by the phone's calendar day. */
export function timelineSections(
  open: readonly { id: string; url: string; title: string; lastActiveAt: number; incognito: boolean }[],
  closed: readonly { id: string; url: string; title: string; closedAt: number }[],
  now: number,
): Timeline {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const entries: TimelineEntry[] = [
    ...open.filter((t) => !t.incognito).map((t) => ({ kind: 'open' as const, id: t.id, url: t.url, title: t.title, at: t.lastActiveAt })),
    ...closed.map((t) => ({ kind: 'closed' as const, id: t.id, url: t.url, title: t.title, at: t.closedAt })),
  ].sort((a, b) => b.at - a.at);
  return {
    today: entries.filter((e) => e.at >= today),
    yesterday: entries.filter((e) => e.at < today && e.at >= yesterday.getTime()),
    earlier: entries.filter((e) => e.at < yesterday.getTime()),
  };
}

// ---- #288 group history ----

export type ClosedGroup = { id: string; name: string; color: GroupColor; tabs: { url: string; title: string }[]; closedAt: number };

/** Newest first, at most 10; a group without tabs isn't kept. */
export function pushClosedGroup(list: readonly ClosedGroup[], entry: ClosedGroup): ClosedGroup[] {
  if (!entry.tabs.length) return [...list];
  return [entry, ...list.filter((g) => g.id !== entry.id)].slice(0, MAX_CLOSED_GROUPS);
}

export function closedGroupsFromSave(raw: unknown): ClosedGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: ClosedGroup[] = [];
  for (const entry of raw.slice(0, MAX_CLOSED_GROUPS)) {
    if (!entry || typeof entry !== 'object') continue;
    const g = entry as Record<string, unknown>;
    const tabs = Array.isArray(g.tabs)
      ? g.tabs
          .filter((t): t is { url: string; title?: unknown } => !!t && typeof (t as { url?: unknown }).url === 'string')
          .map((t) => ({ url: t.url, title: typeof t.title === 'string' ? t.title.slice(0, 255) : '' }))
      : [];
    if (typeof g.id !== 'string' || !tabs.length) continue;
    out.push({
      id: g.id,
      name: cleanGroupName(g.name),
      color: isGroupColor(g.color) ? g.color : 'grey',
      tabs,
      closedAt: typeof g.closedAt === 'number' && Number.isFinite(g.closedAt) ? g.closedAt : 0,
    });
  }
  return out;
}

/** At the tab limit, what fits is restored and the rest is reported. */
export function restorePlan(group: ClosedGroup, openCount: number, maxTabs: number): { open: ClosedGroup['tabs']; skipped: number } {
  const room = Math.max(0, maxTabs - openCount);
  const open = group.tabs.slice(0, room);
  return { open, skipped: group.tabs.length - open.length };
}
