import { TABLE_NAMES } from '@/storage/constants';

import type { UserScript } from '@/browser/devtools/devtools-core';

/** B19 #199 — the user-scripts SQL over a minimal database interface (tested on `node:sqlite`). */

export type UserScriptsDb = {
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
};

type Row = {
  id: string;
  name: string;
  code: string;
  matches: string;
  run_at: string;
  enabled: number;
  allow_incognito: number;
};

function parseMatches(raw: string): string[] {
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((m): m is string => typeof m === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

export async function listUserScripts(db: UserScriptsDb): Promise<UserScript[]> {
  const rows = await db.getAllAsync<Row>(`SELECT * FROM ${TABLE_NAMES.userScripts} ORDER BY created_at, name`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    matches: parseMatches(r.matches),
    runAt: r.run_at === 'start' ? 'start' : 'end',
    enabled: r.enabled === 1,
    allowIncognito: r.allow_incognito === 1,
  }));
}

/** Insert or replace by id (keeps `created_at` of an existing script). */
export async function saveUserScript(db: UserScriptsDb, script: UserScript, nowIso: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO ${TABLE_NAMES.userScripts} (id, name, code, matches, run_at, enabled, allow_incognito, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, code = excluded.code, matches = excluded.matches,
       run_at = excluded.run_at, enabled = excluded.enabled, allow_incognito = excluded.allow_incognito,
       updated_at = excluded.updated_at`,
    script.id,
    script.name.slice(0, 80),
    script.code.slice(0, 200_000),
    JSON.stringify(script.matches.slice(0, 20)),
    script.runAt,
    script.enabled ? 1 : 0,
    script.allowIncognito ? 1 : 0,
    nowIso,
    nowIso,
  );
}

export async function deleteUserScript(db: UserScriptsDb, id: string): Promise<boolean> {
  return (await db.runAsync(`DELETE FROM ${TABLE_NAMES.userScripts} WHERE id = ?`, id)).changes > 0;
}
