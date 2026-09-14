import { BRAND_LOGO_SIZES, VIDORAX_LOGO } from '@/constants/brand-assets';
import { resolveOnboardingSurfaces } from '@/theme/onboarding-surfaces';

export const GATEWAY_LOGO = VIDORAX_LOGO;

export const GATEWAY_COPY = {
  titleLead: 'Download',
  titleAccent: 'Without Limits',
  subtitle:
    'Browse your favorite websites or paste a link.\nVidoraX intelligently detects compatible downloadable videos.',
} as const;

const DARK_SURFACES = resolveOnboardingSurfaces('dark');

/** @deprecated Prefer useOnboardingSurfaces(); dark cinematic allowlist only. */
export const GATEWAY_COLORS = {
  background: DARK_SURFACES.background,
  logoGlow: DARK_SURFACES.logoGlow,
  title: DARK_SURFACES.title,
  titleAccent: DARK_SURFACES.titleAccent,
  subtitle: DARK_SURFACES.subtitle,
  footerMuted: DARK_SURFACES.footerMuted,
  footerActive: DARK_SURFACES.footerActive,
  dotInactive: DARK_SURFACES.dotInactive,
  dotActive: DARK_SURFACES.accent,
} as const;

export const GATEWAY_LAYOUT = {
  logoSize: BRAND_LOGO_SIZES.md,
  /** Small soft radial only — not a giant disk behind the orbit */
  logoGlowSize: 118,
} as const;
