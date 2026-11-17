import { memo } from 'react';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';

import { DsIcon, type DsIconName } from './DsIcon';
import { ds } from './tokens';

export type DsIconButtonProps = {
  icon: DsIconName;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** 36 dp white square with 11 dp corners (the header's ⋮ / ⚙ / + / ♡), or a bare 44 dp hit area. */
  variant?: 'raised' | 'plain';
  size?: number;
  iconSize?: number;
  testID?: string;
};

/** The design's round-cornered header button: white, 36 × 36, a dark 18 dp stroke icon. */
export const DsIconButton = memo(function DsIconButton({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled = false,
  variant = 'raised',
  size = ds.size.headerButton,
  iconSize = ds.size.headerButtonIcon,
  testID,
}: DsIconButtonProps) {
  const theme = useTheme();
  const raised = variant === 'raised';
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      hitSlop={6}
      style={({ pressed }) => ({
        width: raised ? size : 44,
        height: raised ? size : 44,
        borderRadius: raised ? ds.radius.iconButton : 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: raised ? (pressed ? theme.colors.surfacePressed : theme.colors.card) : 'transparent',
        borderWidth: raised ? 1 : 0,
        borderColor: theme.colors.cardBorder,
        ...(raised ? ds.shadow.headerButton : null),
      })}>
      <DsIcon name={icon} size={iconSize} color="textPrimary" strokeWidth={ds.stroke.header} />
    </Pressable>
  );
});
