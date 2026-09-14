import { resolveOnboardingSurfaces } from '@/theme/onboarding-surfaces';

export const ONBOARDING_PAGE_COUNT = 3;

const DARK_SURFACES = resolveOnboardingSurfaces('dark');

/** @deprecated Prefer useOnboardingSurfaces(); dark cinematic allowlist only. */
export const ONBOARDING_COLORS = {
  background: DARK_SURFACES.background,
  muted: DARK_SURFACES.muted,
  active: DARK_SURFACES.active,
  accent: DARK_SURFACES.accent,
  dotInactive: DARK_SURFACES.dotInactive,
} as const;
