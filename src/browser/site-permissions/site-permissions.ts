/**
 * B13 #116–#120 — what each site may use, stored as one JSON setting (`sitePermissions`, so it is per browser profile
 * like every browser setting, and goes into Settings Backup). Pure.
 *
 * VidoraX has no location, camera or microphone permission (and may not add one), and Android WebView can't show web
 * notifications — so those requests are always refused and the site is listed with them as Blocked. Pop-ups are the
 * one choice: blocked unless the user tapped (default), or always allowed for a site.
 */

export type SitePermissionKind = 'location' | 'camera' | 'microphone' | 'notifications';

export const SITE_PERMISSION_KINDS: readonly SitePermissionKind[] = ['location', 'camera', 'microphone', 'notifications'];

export type SitePermissionEntry = {
  /** Requests refused for this site (the page asked at least once). */
  blocked: SitePermissionKind[];
  /** "Always for this site": pages may open windows without a tap. */
  popupsAllowed: boolean;
  /** Last time the site asked or was changed (ms). */
  updatedAt: number;
};

export type SitePermissions = Record<string, SitePermissionEntry>;

export const DEFAULT_SITE_PERMISSIONS_JSON = '{}';
export const MAX_SITE_PERMISSION_SITES = 300;
export const SITE_PERMISSIONS_MAX_CHARS = 16_000;

const HOST = /^[a-z0-9.-]{1,253}$/;

export function isSitePermissionKind(value: unknown): value is SitePermissionKind {
  return SITE_PERMISSION_KINDS.includes(value as SitePermissionKind);
}

/** Reads the stored JSON by its fields; anything unreadable is dropped. */
export function parseSitePermissions(raw: unknown): SitePermissions {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: SitePermissions = {};
  for (const [site, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!HOST.test(site) || !entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const blocked = Array.isArray(e.blocked) ? [...new Set(e.blocked.filter(isSitePermissionKind))] : [];
    const popupsAllowed = e.popupsAllowed === true;
    if (blocked.length === 0 && !popupsAllowed) continue;
    const updatedAt = typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt) ? e.updatedAt : 0;
    out[site] = { blocked: SITE_PERMISSION_KINDS.filter((k) => blocked.includes(k)), popupsAllowed, updatedAt };
  }
  return trim(out);
}

/** Newest first, at most MAX_SITE_PERMISSION_SITES sites. */
function trim(map: SitePermissions): SitePermissions {
  const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_SITE_PERMISSION_SITES));
}

export function serializeSitePermissions(map: SitePermissions): string {
  let entries = Object.entries(trim(map));
  let json = JSON.stringify(Object.fromEntries(entries));
  // Over the backup's cap: drop the oldest sites until it fits.
  while (json.length > SITE_PERMISSIONS_MAX_CHARS && entries.length > 0) {
    entries = entries.slice(0, -1);
    json = JSON.stringify(Object.fromEntries(entries));
  }
  return json;
}

/** A page asked for `kind`: listed as Blocked under its site. */
export function recordBlocked(map: SitePermissions, site: string, kind: SitePermissionKind, nowMs: number): SitePermissions {
  const current = map[site];
  if (current?.blocked.includes(kind)) return map;
  const blocked = SITE_PERMISSION_KINDS.filter((k) => k === kind || current?.blocked.includes(k));
  return { ...map, [site]: { blocked, popupsAllowed: current?.popupsAllowed ?? false, updatedAt: nowMs } };
}

export function setPopupsAllowed(map: SitePermissions, site: string, allowed: boolean, nowMs: number): SitePermissions {
  const current = map[site];
  const next = { ...map, [site]: { blocked: current?.blocked ?? [], popupsAllowed: allowed, updatedAt: nowMs } };
  if (!allowed && (current?.blocked.length ?? 0) === 0) delete next[site];
  return next;
}

export function resetSite(map: SitePermissions, site: string): SitePermissions {
  if (!(site in map)) return map;
  const next = { ...map };
  delete next[site];
  return next;
}

export function popupsAllowedFor(map: SitePermissions, site: string | null): boolean {
  return site != null && map[site]?.popupsAllowed === true;
}

/** The sites for the list, A–Z. */
export function sitePermissionList(map: SitePermissions): { site: string; entry: SitePermissionEntry }[] {
  return Object.keys(map)
    .sort((a, b) => a.localeCompare(b))
    .map((site) => ({ site, entry: map[site] }));
}
