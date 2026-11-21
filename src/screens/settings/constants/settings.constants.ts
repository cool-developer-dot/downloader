/** Debounce window to ignore rapid pull-to-refresh gestures (ms). */
export const SETTINGS_REFRESH_DEBOUNCE_MS = 400;

export const THEME_LABELS = {
  LIGHT: 'Light',
  DARK: 'Dark',
  RED: 'Red',
  CREAM: 'Cream',
  MIDNIGHT: 'Midnight',
  BLUSH: 'Blush',
} as const;

export const THEME_SEGMENT_OPTIONS = [
  { value: 'light' as const, label: 'Light', accessibilityLabel: 'Light theme' },
  { value: 'dark' as const, label: 'Dark', accessibilityLabel: 'Dark theme' },
  { value: 'red' as const, label: 'Red', accessibilityLabel: 'Red theme' },
  { value: 'cream' as const, label: 'Cream', accessibilityLabel: 'Cream theme' },
  { value: 'midnight' as const, label: 'Midnight', accessibilityLabel: 'Midnight theme' },
  { value: 'blush' as const, label: 'Blush', accessibilityLabel: 'Blush theme' },
];
