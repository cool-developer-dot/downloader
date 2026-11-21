import { memo } from 'react';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon, ds, type DsIconName } from '@/design';
import { useTheme } from '@/hooks/use-theme';

export type ToolbarButtonProps = {
  icon: DsIconName;
  accessibilityLabel: string;
  onPress: () => void;
  /** B6 #44: Back lists the tab's earlier pages on a long press (and as an accessibility action). */
  onLongPress?: () => void;
  longPressLabel?: string;
  disabled?: boolean;
  testID?: string;
};

/**
 * Browser chrome control in the light design: a 44 dp hit area with a Lucide stroke in the text colour (the
 * switch-off grey when disabled — colour encodes the state, so the control never fades). Pressed = the soft
 * pressed surface.
 */
export const ToolbarButton = memo(function ToolbarButton({
  icon,
  accessibilityLabel,
  onPress,
  onLongPress,
  longPressLabel,
  disabled = false,
  testID,
}: ToolbarButtonProps) {
  const theme = useTheme();
  const size = 44;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      accessibilityActions={onLongPress && longPressLabel ? [{ name: 'longpress', label: longPressLabel }] : undefined}
      onAccessibilityAction={
        onLongPress
          ? (event) => {
              if (event.nativeEvent.actionName === 'longpress') onLongPress();
            }
          : undefined
      }
      disabled={disabled}
      disabledOpacity={1}
      pressedOpacity={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: ds.radius.button,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed && !disabled ? theme.colors.surfacePressed : 'transparent',
      })}>
      <DsIcon name={icon} size={ds.size.tabIcon + 2} color={disabled ? 'switchOff' : 'textPrimary'} strokeWidth={ds.stroke.tabBar} />
    </Pressable>
  );
});
