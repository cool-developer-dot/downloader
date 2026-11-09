/**
 * B20 sweep rules (pure), used by `sweepOrphanWebProfiles` in profile-service.ts — split out so they are tested under
 * Node. B11: the live incognito session's profile is always owned, so a sweep never deletes it mid-session.
 */

/** The WebView profile names in use: every browser profile's, the active one's, and the live incognito session's. */
export function ownedWebProfileNames(
  profileWebNames: readonly string[],
  activeWebName: string,
  liveIncognito: string | null,
): Set<string> {
  const owned = new Set(profileWebNames);
  owned.add(activeWebName);
  if (liveIncognito) owned.add(liveIncognito);
  return owned;
}

/** VidoraX's WebView profiles nothing owns any more (never WebView's own "Default"). */
export function orphanWebProfileNames(names: readonly string[], owned: ReadonlySet<string>): string[] {
  return names.filter((name) => name !== 'Default' && name.startsWith('vidorax-') && !owned.has(name));
}
