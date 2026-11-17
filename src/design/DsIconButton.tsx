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
  /** 36 dp square with 11 dp corners (the header's ⋮ / ⚙ / + / ♡), or a bare 44 dp hit area. */
  variant?: 'raised' | 'plain';
  /** `surface`: card-coloured with a hairline edge. `header`: on the Red theme's band — translucent white, white icon. */
  tone?: 'surface' | 'header';
  size?: number;
  iconSize?: number;
  testID?: string;
};

/** The design's round-cornered header button: card-coloured, 36 × 36, an 18 dp stroke icon. */
export const DsIconButton = memo(function DsIconButton({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled = false,
  variant = 'raised',
  tone = 'surface',
  size = ds.size.headerButton,
  iconSize = ds.size.headerButtonIcon,
  testID,
}: DsIconButtonProps) {
  const theme = useTheme();
  const raised = variant === 'raised';
  const onBand = tone === 'header';
  const background = onBand ? theme.colors.headerButtonBackground : theme.colors.card;
  const pressedBackground = onBand ? theme.colors.headerButtonPressed : theme.colors.surfacePressed;
  const border = onBand ? theme.colors.headerButtonBorder : theme.colors.cardBorder;
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
        backgroundColor: raised ? (pressed ? pressedBackground : background) : 'transparent',
        borderWidth: raised && border !== 'transparent' ? 1 : 0,
        borderColor: border,
        ...(raised && !onBand ? ds.shadow.headerButton : null),
      })}>
      <DsIcon name={icon} size={iconSize} color={onBand ? 'headerIcon' : 'textPrimary'} strokeWidth={ds.stroke.header} />
    </Pressable>
  );
});
