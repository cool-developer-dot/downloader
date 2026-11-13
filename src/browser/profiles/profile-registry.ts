/**
 * B20 #206 Multiple profiles — the list of browser profiles, kept in MMKV (`browserProfiles`). Pure: parsing is
 * defensive (the stored value is read back as untrusted), and every rule lives here so it can be tested under Node.
 *
 * - The default profile always exists, comes first and can't be deleted. Its name may be empty: the app then shows
 *   the translated "Personal".
 * - At most {@link MAX_PROFILES} profiles, guest mode not counted (it is not in the list).
 * - Names: 1–{@link MAX_PROFILE_NAME_LENGTH} characters after trimming, unique ignoring case.
 */

export const DEFAULT_PROFILE = 'default';
export const GUEST_PROFILE = 'guest';
export const MAX_PROFILES = 5;
export const MAX_PROFILE_NAME_LENGTH = 30;

/** Avatar colours; each keeps white initials readable (contrast ≥ 4.5:1) in both themes. */
export const PROFILE_COLORS = ['blue', 'green', 'purple', 'orange', 'teal', 'pink', 'indigo', 'red'] as const;
export type ProfileColor = (typeof PROFILE_COLORS)[number];

export const PROFILE_COLOR_HEX: Readonly<Record<ProfileColor, string>> = {
  blue: '#1565C0',
  green: '#2E7D32',
  purple: '#6A1B9A',
  orange: '#BF360C',
  teal: '#00695C',
  pink: '#AD1457',
  indigo: '#283593',
  red: '#C62828',
};

export type BrowserProfile = {
  id: string;
  /** Empty only for the default profile, which then shows the translated "Personal". */
  name: string;
  color: ProfileColor;
  createdAt: number;
};

export type ProfileNameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'taken' };

const PROFILE_ID = /^[a-z0-9]{1,24}$/;
// Control characters become spaces; invisible formatting and direction overrides never belong in a shown name.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function defaultProfileEntry(createdAt = 0): BrowserProfile {
  return { id: DEFAULT_PROFILE, name: '', color: 'blue', createdAt };
}

function isColor(value: unknown): value is ProfileColor {
  return typeof value === 'string' && (PROFILE_COLORS as readonly string[]).includes(value);
}

export function cleanProfileName(raw: string): string {
  return raw.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** The stored list, repaired: the default profile first, no duplicates, no guest, valid fields, at most MAX_PROFILES. */
export function parseProfiles(raw: unknown): BrowserProfile[] {
  const list = Array.isArray(raw) ? raw : [];
  const result: BrowserProfile[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  let defaultEntry: BrowserProfile | null = null;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || !PROFILE_ID.test(id) || id === GUEST_PROFILE || seenIds.has(id)) continue;
    const name = typeof record.name === 'string' ? cleanProfileName(record.name).slice(0, MAX_PROFILE_NAME_LENGTH) : '';
    const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0;
    const color = isColor(record.color) ? record.color : 'blue';
    if (id === DEFAULT_PROFILE) {
      defaultEntry = { id, name, color, createdAt };
      seenIds.add(id);
      if (name) seenNames.add(name.toLocaleLowerCase());
      continue;
    }
    const key = name.toLocaleLowerCase();
    if (!name || seenNames.has(key)) continue;
    seenIds.add(id);
    seenNames.add(key);
    result.push({ id, name, color, createdAt });
  }
  return [defaultEntry ?? defaultProfileEntry(), ...result].slice(0, MAX_PROFILES);
}

/** `exceptId`: the profile being renamed (its own name isn't "taken"). `defaultName`: what the default shows. */
export function checkProfileName(
  raw: string,
  profiles: readonly BrowserProfile[],
  options: { exceptId?: string; defaultName: string },
): ProfileNameCheck {
  const name = cleanProfileName(raw);
  if (!name) return { ok: false, reason: 'empty' };
  if (name.length > MAX_PROFILE_NAME_LENGTH) return { ok: false, reason: 'too-long' };
  const key = name.toLocaleLowerCase();
  const taken = profiles.some((profile) => {
    if (profile.id === options.exceptId) return false;
    const shown = profile.name || (profile.id === DEFAULT_PROFILE ? options.defaultName : '');
    return shown.toLocaleLowerCase() === key;
  });
  return taken ? { ok: false, reason: 'taken' } : { ok: true, name };
}

/** The first colour no profile uses yet (or the least used). */
export function nextProfileColor(profiles: readonly BrowserProfile[]): ProfileColor {
  const counts = new Map<ProfileColor, number>(PROFILE_COLORS.map((color) => [color, 0]));
  for (const profile of profiles) counts.set(profile.color, (counts.get(profile.color) ?? 0) + 1);
  let best: ProfileColor = PROFILE_COLORS[0];
  for (const color of PROFILE_COLORS) {
    if ((counts.get(color) ?? 0) < (counts.get(best) ?? 0)) best = color;
  }
  return best;
}

/** A new id `p<base36>`, unused by `profiles`. `random` returns [0, 1). */
export function newProfileId(profiles: readonly BrowserProfile[], random: () => number = Math.random): string {
  const used = new Set(profiles.map((profile) => profile.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `p${Math.floor(random() * 36 ** 8).toString(36).padStart(8, '0')}`;
    if (!used.has(id) && id !== GUEST_PROFILE && id !== DEFAULT_PROFILE) return id;
  }
  // Practically unreachable; still unique.
  let n = profiles.length + 1;
  while (used.has(`p${n}`)) n += 1;
  return `p${n}`;
}

/** The name to show: the profile's own, or `defaultName` for an unnamed default profile. */
export function profileDisplayName(profile: BrowserProfile, defaultName: string): string {
  return profile.name || defaultName;
}

/** One or two letters for the avatar. */
export function profileInitials(name: string): string {
  const words = cleanProfileName(name).split(' ').filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0] ?? '';
  const second = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return `${first}${second}`.toLocaleUpperCase();
}
