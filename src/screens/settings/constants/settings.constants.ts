/** Debounce window to ignore rapid pull-to-refresh gestures (ms). */
export const SETTINGS_REFRESH_DEBOUNCE_MS = 400;

export const THEME_LABELS = {
  LIGHT: 'Light',
  LOGO: 'Logo',
  DARK: 'Dark',
} as const;

export const THEME_SEGMENT_OPTIONS = [
  { value: 'light' as const, label: 'Light', accessibilityLabel: 'Light theme' },
  { value: 'logo' as const, label: 'Logo', accessibilityLabel: 'Logo theme' },
  { value: 'dark' as const, label: 'Dark', accessibilityLabel: 'Dark theme' },
];
