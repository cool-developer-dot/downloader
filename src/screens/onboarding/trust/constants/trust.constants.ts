import { resolveOnboardingSurfaces } from '@/theme/onboarding-surfaces';

export const TRUST_COPY = {
  titleLead: 'Fast.',
  titleAccent: 'Reliable.',
  titleTrail: 'Always in Control.',
  subtitle:
    'Pause, resume, queue and manage your downloads effortlessly while VidoraX keeps everything running in the background.',
  accessibilityLabel:
    'Fast. Reliable. Always in Control. VidoraX manages every download from start to finish while keeping you in control.',
} as const;

const DARK_SURFACES = resolveOnboardingSurfaces('dark');

/** @deprecated Prefer useOnboardingSurfaces(); dark cinematic allowlist only. */
export const TRUST_COLORS = {
  background: DARK_SURFACES.background,
  radialGlow: DARK_SURFACES.radialGlow,
  title: DARK_SURFACES.title,
  titleAccent: DARK_SURFACES.titleAccent,
  subtitle: DARK_SURFACES.subtitle,
  glassBg: DARK_SURFACES.glassBg,
  glassBorder: DARK_SURFACES.glassBorder,
  glassBorderActive: DARK_SURFACES.glassBorderActive,
  chipBg: DARK_SURFACES.chipBg,
  chipBorder: DARK_SURFACES.chipBorder,
  chipText: DARK_SURFACES.chipText,
  chipIcon: DARK_SURFACES.chipIcon,
  muted: DARK_SURFACES.muted,
  softWhite: DARK_SURFACES.softWhite,
  accent: DARK_SURFACES.accent,
  accentSoft: DARK_SURFACES.accentSoft,
  accentGlow: DARK_SURFACES.accentGlow,
  progressTrack: DARK_SURFACES.progressTrack,
  libraryBorder: DARK_SURFACES.libraryBorder,
  libraryBg: DARK_SURFACES.libraryBg,
  libraryLabel: DARK_SURFACES.libraryLabel,
  libraryLabelActive: DARK_SURFACES.libraryLabelActive,
} as const;

export const TRUST_WORKFLOW = {
  urlDisplay: 'vimeo.com/••••••',
  detectedLabel: 'Video Detected',
  cardTitle: 'Movie Trailer',
  quality: '1080P',
  format: 'MP4',
  size: '42 MB',
  completedLabel: 'Completed',
  libraryLabel: 'Offline Library',
} as const;

export type TrustCapabilityId =
  | 'pause'
  | 'resume'
  | 'queue'
  | 'notifications'
  | 'retry'
  | 'background';

export type TrustCapability = {
  id: TrustCapabilityId;
  label: string;
};

export const TRUST_CAPABILITIES: readonly TrustCapability[] = [
  { id: 'pause', label: 'Pause' },
  { id: 'resume', label: 'Resume' },
  { id: 'queue', label: 'Queue' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'retry', label: 'Retry' },
  { id: 'background', label: 'Background' },
] as const;

export const TRUST_LAYOUT = {
  chipHeight: 44,
  progressHeight: 2.5,
  cardMaxWidth: 340,
  glowSize: 280,
  maxFontMultiplier: 1.25,
} as const;
