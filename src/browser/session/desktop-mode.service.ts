import { browserPreferencesService } from '@/browser/services/browser-preferences.service';

export type DesktopModeSource = 'user' | 'platform' | 'default';

export type ResolveDesktopModeInput = {
  userPreference: boolean;
  userPreferenceExplicit: boolean;
  platformPrefersDesktop: boolean;
};

/**
 * Priority: explicit user setting > platform recommendation > default mobile.
 * Applied per-tab — never as a cross-tab global live mode.
 */
export function resolveEffectiveDesktopMode(input: ResolveDesktopModeInput): {
  desktopMode: boolean;
  source: DesktopModeSource;
} {
  if (input.userPreferenceExplicit) {
    return { desktopMode: input.userPreference, source: 'user' };
  }

  if (input.platformPrefersDesktop) {
    return { desktopMode: true, source: 'platform' };
  }

  return { desktopMode: false, source: 'default' };
}

/**
 * Global MMKV Desktop preference — NEW TAB DEFAULT ONLY.
 * Does not represent the active tab's Desktop Site state.
 */
export function readGlobalDesktopDefault(): {
  desktopMode: boolean;
  explicit: boolean;
} {
  return {
    desktopMode: browserPreferencesService.readDesktopMode() ?? false,
    explicit: browserPreferencesService.readDesktopModeUserExplicit() ?? false,
  };
}

/** @deprecated Use readGlobalDesktopDefault — name retained for cold-start callers. */
export function readInitialDesktopState(): {
  desktopMode: boolean;
  desktopModeUserExplicit: boolean;
} {
  const global = readGlobalDesktopDefault();
  const { desktopMode } = resolveEffectiveDesktopMode({
    userPreference: global.desktopMode,
    userPreferenceExplicit: global.explicit,
    platformPrefersDesktop: false,
  });
  return { desktopMode, desktopModeUserExplicit: global.explicit };
}

export function applyPlatformDesktopRecommendation(
  platformPrefersDesktop: boolean,
  current: { desktopMode: boolean; desktopModeUserExplicit: boolean },
): { desktopMode: boolean; changed: boolean } {
  if (current.desktopModeUserExplicit) {
    return { desktopMode: current.desktopMode, changed: false };
  }

  const next = resolveEffectiveDesktopMode({
    userPreference: current.desktopMode,
    userPreferenceExplicit: false,
    platformPrefersDesktop,
  });

  return {
    desktopMode: next.desktopMode,
    changed: next.desktopMode !== current.desktopMode,
  };
}

/**
 * Whether a platform recommendation may mutate this tab's Desktop mode.
 * User-explicit tabs are immutable to platform.
 */
export function canApplyPlatformDesktop(source: DesktopModeSource): boolean {
  return source !== 'user';
}
