/**
 * Verified quality ladder labels — never invent tiers without dimensions.
 */
export const QUALITY_LADDER = [
  { label: '2160p', minHeight: 2160 },
  { label: '1440p', minHeight: 1440 },
  { label: '1080p', minHeight: 1080 },
  { label: '720p', minHeight: 720 },
  { label: '480p', minHeight: 480 },
  { label: '360p', minHeight: 360 },
  { label: '240p', minHeight: 240 },
  { label: '144p', minHeight: 144 },
] as const;

export type QualityLabel = (typeof QUALITY_LADDER)[number]['label'] | 'Original';

export const DISCOVERY_ANIMATION = {
  enterMs: 280,
  exitMs: 240,
  pulseMs: 400,
  staggerMs: 40,
  cardTranslateY: 24,
  swipeDismissThreshold: 72,
  swipeVelocityThreshold: 900,
} as const;

export const DISCOVERY_LAYOUT = {
  cardMaxWidth: 420,
  thumbnailSize: 56,
  horizontalInset: 16,
  bottomGapAboveToolbar: 10,
  cardPadding: 12,
} as const;

/** Audio format labels prepared for future extraction — display only. */
export const AUDIO_FORMAT_LABELS = {
  mp3: 'MP3',
  aac: 'AAC',
  m4a: 'M4A',
  ogg: 'OGG',
  original: 'Original Audio',
} as const;
