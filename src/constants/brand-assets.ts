/**
 * Central brand asset registry — single source of truth for VidoraX logo usage.
 * Native icons (app.json) reference assets/logos/icon.png directly.
 */
export const VIDORAX_LOGO = require('../../assets/logos/vidorax-logo.png');

/** Recommended display sizes for common surfaces. */
export const BRAND_LOGO_SIZES = {
  /** Compact chrome (home header, toolbar). */
  sm: 32,
  /** Onboarding gateway hero. */
  md: 96,
  /** About identity card. */
  lg: 88,
  /** Splash cinematic hero. */
  xl: 120,
} as const;
