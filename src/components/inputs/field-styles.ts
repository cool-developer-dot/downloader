import type { Theme } from '@/theme';
import { spacing } from '@/theme';

export type FieldState = 'default' | 'error' | 'disabled' | 'readonly';

export function getFieldColors(theme: Theme, state: FieldState) {
  switch (state) {
    case 'error':
      return {
        borderColor: theme.colors.error,
        backgroundColor: theme.colors.surface,
        textColor: theme.colors.textPrimary,
        labelColor: theme.colors.error,
        helperColor: theme.colors.error,
      };
    case 'disabled':
      return {
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        textColor: theme.colors.textDisabled,
        labelColor: theme.colors.textDisabled,
        helperColor: theme.colors.textDisabled,
      };
    case 'readonly':
      return {
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        textColor: theme.colors.textPrimary,
        labelColor: theme.colors.textSecondary,
        helperColor: theme.colors.textSecondary,
      };
    default:
      return {
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        textColor: theme.colors.textPrimary,
        labelColor: theme.colors.textSecondary,
        helperColor: theme.colors.textSecondary,
      };
  }
}

export const fieldMetrics = {
  minHeight: spacing[48],
  paddingHorizontal: spacing[16],
  borderRadius: spacing[12],
  gap: spacing[8],
} as const;
