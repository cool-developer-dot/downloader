import { resolveOnboardingSurfaces } from '@/theme/onboarding-surfaces';

export const LIBRARY_COPY = {
  titleLead: 'Everything',
  titleAccent: 'Organized.',
  titleTrail: 'Instantly Accessible.',
  subtitle:
    'Search, play, organize and manage every download from one beautiful offline library.',
  accessibilityLabel:
    'Everything Organized. Instantly Accessible. Your offline media library stays organized, searchable, and ready to watch.',
  searchPlaceholder: 'Search downloads...',
  searchQuery: 'Movie',
  playingLabel: 'Playing Offline',
} as const;

const DARK_SURFACES = resolveOnboardingSurfaces('dark');

/** @deprecated Prefer useOnboardingSurfaces(); dark cinematic allowlist only. */
export const LIBRARY_COLORS = {
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
  searchBg: DARK_SURFACES.searchBg,
  searchBorder: DARK_SURFACES.searchBorder,
  searchPlaceholder: DARK_SURFACES.searchPlaceholder,
  searchText: DARK_SURFACES.searchText,
  caret: DARK_SURFACES.caret,
  waveform: DARK_SURFACES.waveform,
} as const;

export type LibraryCardId = 'movie' | 'travel' | 'react' | 'vacation';

export type LibraryCard = {
  id: LibraryCardId;
  title: string;
  meta: string;
  /** Matches the typed search query "Movie" */
  matchesSearch: boolean;
  scatter: { x: number; y: number };
  grid: { x: number; y: number };
  dash: { x: number; y: number };
};

export const LIBRARY_CARDS: readonly LibraryCard[] = [
  {
    id: 'movie',
    title: 'Movie Trailer',
    meta: 'Completed',
    matchesSearch: true,
    scatter: { x: -78, y: -72 },
    grid: { x: -82, y: -52 },
    dash: { x: -72, y: -36 },
  },
  {
    id: 'travel',
    title: 'Travel Vlog',
    meta: '1080P',
    matchesSearch: false,
    scatter: { x: 86, y: -38 },
    grid: { x: 82, y: -52 },
    dash: { x: 72, y: -36 },
  },
  {
    id: 'react',
    title: 'React Course',
    meta: 'Saved',
    matchesSearch: false,
    scatter: { x: -96, y: 58 },
    grid: { x: -82, y: 52 },
    dash: { x: -72, y: 40 },
  },
  {
    id: 'vacation',
    title: 'Vacation Reel',
    meta: 'Offline',
    matchesSearch: false,
    scatter: { x: 72, y: 78 },
    grid: { x: 82, y: 52 },
    dash: { x: 72, y: 40 },
  },
] as const;

export type LibraryFeatureId =
  | 'favorites'
  | 'history'
  | 'search'
  | 'player'
  | 'library'
  | 'settings';

export type LibraryFeature = {
  id: LibraryFeatureId;
  label: string;
  scatter: { x: number; y: number };
  dash: { x: number; y: number };
};

export const LIBRARY_FEATURES: readonly LibraryFeature[] = [
  {
    id: 'favorites',
    label: 'Favorites',
    scatter: { x: -118, y: -118 },
    dash: { x: -108, y: -88 },
  },
  {
    id: 'history',
    label: 'History',
    scatter: { x: 20, y: -128 },
    dash: { x: 0, y: -88 },
  },
  {
    id: 'search',
    label: 'Smart Search',
    scatter: { x: 120, y: -108 },
    dash: { x: 108, y: -88 },
  },
  {
    id: 'player',
    label: 'Offline Player',
    scatter: { x: -128, y: 118 },
    dash: { x: -108, y: 92 },
  },
  {
    id: 'library',
    label: 'Organized Library',
    scatter: { x: 8, y: 132 },
    dash: { x: 0, y: 92 },
  },
  {
    id: 'settings',
    label: 'Settings',
    scatter: { x: 124, y: 112 },
    dash: { x: 108, y: 92 },
  },
] as const;

export const LIBRARY_LAYOUT = {
  cardWidth: 148,
  cardHeight: 72,
  chipHeight: 40,
  glowSize: 300,
  canvasMax: 360,
  maxFontMultiplier: 1.25,
  searchMaxWidth: 280,
} as const;
