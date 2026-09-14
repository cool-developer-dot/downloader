import type { IconColorToken } from '@/components/base/types';
import type { Theme } from '@/theme';
import { icons, spacing } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'text' | 'destructive';
export type ButtonSize = 'small' | 'medium' | 'large';

export type ButtonMetrics = {
  height: number;
  paddingHorizontal: number;
  iconSize: number;
  gap: number;
  borderRadius: number;
};

export type ButtonVisualStyle = {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  borderWidth: number;
};

export const buttonMetrics: Record<ButtonSize, ButtonMetrics> = {
  small: {
    height: 36,
    paddingHorizontal: spacing[12],
    iconSize: icons.sm,
    gap: spacing[8],
    borderRadius: spacing[8],
  },
  medium: {
    height: 44,
    paddingHorizontal: spacing[16],
    iconSize: icons.md,
    gap: spacing[8],
    borderRadius: spacing[12],
  },
  large: {
    height: 52,
    paddingHorizontal: spacing[24],
    iconSize: icons.md,
    gap: spacing[12],
    borderRadius: spacing[16],
  },
};

export function getButtonIconColor(variant: ButtonVariant, disabled: boolean): IconColorToken {
  if (disabled) {
    return 'disabled';
  }

  if (variant === 'primary') {
    return 'onPrimary';
  }

  if (variant === 'destructive') {
    return 'inverse';
  }

  if (variant === 'secondary') {
    return 'default';
  }

  return 'primary';
}

export function getButtonVisualStyle(
  theme: Theme,
  variant: ButtonVariant,
  disabled: boolean,
): ButtonVisualStyle {
  // Ghost/text stay chrome-transparent when disabled — never paint a solid surface
  // square (Logo toolbar: white surface + white glyph = empty white boxes).
  if (disabled && (variant === 'ghost' || variant === 'text')) {
    return {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      textColor: theme.colors.textDisabled,
      borderWidth: 0,
    };
  }

  if (disabled) {
    return {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      textColor: theme.colors.textDisabled,
      borderWidth: variant === 'outline' ? 1 : 0,
    };
  }

  switch (variant) {
    case 'primary':
      return {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
        textColor: theme.colors.textOnPrimary,
        borderWidth: 0,
      };
    case 'secondary':
      return {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        textColor: theme.colors.textPrimary,
        borderWidth: 1,
      };
    case 'outline':
      return {
        backgroundColor: 'transparent',
        borderColor: theme.colors.primary,
        textColor: theme.colors.primary,
        borderWidth: 1,
      };
    case 'ghost':
      return {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        textColor: theme.colors.primary,
        borderWidth: 0,
      };
    case 'text':
      return {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        textColor: theme.colors.primary,
        borderWidth: 0,
      };
    case 'destructive':
      return {
        backgroundColor: theme.colors.error,
        borderColor: theme.colors.error,
        textColor: theme.colors.white,
        borderWidth: 0,
      };
    default:
      return {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
        textColor: theme.colors.textOnPrimary,
        borderWidth: 0,
      };
  }
}
