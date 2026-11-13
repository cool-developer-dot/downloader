import { TABLE_NAMES } from '@/storage/constants';

import type { SiteLimitsState } from '@/browser/blocking/site-limits';

/**
 * B14 #276 / #277 / #278 — the site-blocking SQL, in plain functions over a minimal database interface so tests run
 * them on a real SQLite (`node:sqlite`) with the app's own schema; `site-blocking.repository.ts` runs them on the active
 * browser profile's database (each profile has its own lists, limits, time used and focus timer).
 */

export type SiteBlockingDb = {
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
};

export type SiteListName = 'blocked' | 'focus';

/** Everything, for the given local day's time used (older days are not read). */
export async function loadSiteLimits(db: SiteBlockingDb, day: string): Promise<SiteLimitsState> {
  const lists = await db.getAllAsync<{ list: SiteListName; site: string }>(
    `SELECT list, site FROM ${TABLE_NAMES.siteBlockLists} ORDER BY created_at, site`,
  );
  const limits = await db.getAllAsync<{ site: string; minutes: number }>(
    `SELECT site, minutes FROM ${TABLE_NAMES.siteTimeLimits} ORDER BY site`,
  );
  const usage = await db.getAllAsync<{ site: string; seconds: number }>(
    `SELECT site, seconds FROM ${TABLE_NAMES.siteTimeUsage} WHERE day = ?`,
    day,
  );
  const focus = await db.getAllAsync<{ ends_at: number }>(`SELECT ends_at FROM ${TABLE_NAMES.focusSession} WHERE id = 1`);
  return {
    blockedSites: lists.filter((r) => r.list === 'blocked').map((r) => r.site),
    focusSites: lists.filter((r) => r.list === 'focus').map((r) => r.site),
    timeLimits: Object.fromEntries(limits.map((r) => [r.site, Number(r.minutes)])),
    usageDay: day,
    usage: Object.fromEntries(usage.map((r) => [r.site, Number(r.seconds)])),
    focusEndsAt: focus.length ? Number(focus[0].ends_at) : null,
  };
}

export async function addListSite(db: SiteBlockingDb, list: SiteListName, site: string, nowIso: string): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO ${TABLE_NAMES.siteBlockLists} (list, site, created_at) VALUES (?, ?, ?)`,
    list,
    site,
    nowIso,
  );
}

export async function removeListSite(db: SiteBlockingDb, list: SiteListName, site: string): Promise<void> {
  await db.runAsync(`DELETE FROM ${TABLE_NAMES.siteBlockLists} WHERE list = ? AND site = ?`, list, site);
}

export async function setTimeLimit(db: SiteBlockingDb, site: string, minutes: number, nowIso: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO ${TABLE_NAMES.siteTimeLimits} (site, minutes, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(site) DO UPDATE SET minutes = excluded.minutes, updated_at = excluded.updated_at`,
    site,
    minutes,
    nowIso,
    nowIso,
  );
}

/** Removes the limit and today's (and every day's) time used for that site. */
export async function removeTimeLimit(db: SiteBlockingDb, site: string): Promise<void> {
  await db.runAsync(`DELETE FROM ${TABLE_NAMES.siteTimeLimits} WHERE site = ?`, site);
  await db.runAsync(`DELETE FROM ${TABLE_NAMES.siteTimeUsage} WHERE site = ?`, site);
}

/** Adds whole seconds used on `day`. */
export async function addTimeUsed(db: SiteBlockingDb, day: string, site: string, seconds: number): Promise<void> {
  const add = Math.max(0, Math.round(seconds));
  if (add === 0) return;
  await db.runAsync(
    `INSERT INTO ${TABLE_NAMES.siteTimeUsage} (day, site, seconds) VALUES (?, ?, ?)
     ON CONFLICT(day, site) DO UPDATE SET seconds = seconds + excluded.seconds`,
    day,
    site,
    add,
  );
}

/** Drops time used before `day` (only today's is ever read). */
export async function pruneTimeUsedBefore(db: SiteBlockingDb, day: string): Promise<void> {
  await db.runAsync(`DELETE FROM ${TABLE_NAMES.siteTimeUsage} WHERE day < ?`, day);
}

export async function startFocus(db: SiteBlockingDb, startedAt: number, minutes: number): Promise<number> {
  const endsAt = startedAt + minutes * 60_000;
  await db.runAsync(
    `INSERT INTO ${TABLE_NAMES.focusSession} (id, started_at, ends_at, minutes) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, ends_at = excluded.ends_at, minutes = excluded.minutes`,
    startedAt,
    endsAt,
    minutes,
  );
  return endsAt;
}

export async function endFocus(db: SiteBlockingDb): Promise<void> {
  await db.runAsync(`DELETE FROM ${TABLE_NAMES.focusSession} WHERE id = 1`);
}
