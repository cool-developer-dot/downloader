import type { ColorTokens } from './colors';

export const icons = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
  xl: 40,
} as const;

export const iconColors = {
  default: 'textPrimary',
  secondary: 'textSecondary',
  disabled: 'textDisabled',
  primary: 'primary',
  onPrimary: 'textOnPrimary',
  headerIcon: 'headerIcon',
  headerSubtitle: 'headerSubtitle',
  bottomNavActive: 'bottomNavActive',
  bottomNavInactive: 'bottomNavInactive',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  inverse: 'white',
  link: 'link',
} as const satisfies Record<string, keyof ColorTokens>;

export type IconSizeToken = keyof typeof icons;
export type IconColorToken = keyof typeof iconColors;
