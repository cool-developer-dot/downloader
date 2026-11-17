import { memo, type ReactNode } from 'react';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';

import { DsIcon, type DsIconName } from './DsIcon';
import { DsText } from './DsText';
import { ds } from './tokens';

export type DsButtonProps = {
  label: string;
  /** `primary`: solid red, white text. `secondary`: white with a hairline edge, dark text. */
  variant?: 'primary' | 'secondary';
  icon?: DsIconName;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to the parent's width (the design's "Download 12", "Add selected"). */
  fullWidth?: boolean;
  /** Share a row equally with a sibling (the design's "Paste & Go · Scan QR" pair). */
  flex?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The design's 45 dp button with 12 dp corners and 15 dp semibold text. */
export const DsButton = memo(function DsButton({
  label,
  variant = 'primary',
  icon,
  onPress,
  disabled = false,
  loading = false,
  fullWidth = false,
  flex = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: DsButtonProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const primary = variant === 'primary';
  const textColor = primary ? theme.colors.textOnPrimary : theme.colors.textPrimary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        {
          height: ds.size.button,
          borderRadius: ds.radius.button,
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: fullWidth ? 'stretch' : flex ? undefined : 'flex-start',
          flex: flex ? 1 : undefined,
          backgroundColor: primary
            ? pressed
              ? theme.colors.primaryDark
              : theme.colors.primary
            : pressed
              ? theme.colors.surfacePressed
              : theme.colors.card,
          borderWidth: primary ? 0 : 1,
          borderColor: theme.colors.cardBorder,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
          {icon ? <DsIcon name={icon} size={ds.size.buttonIcon} color={textColor} strokeWidth={2} /> : null}
          <DsText variant="button" color={textColor} numberOfLines={1}>
            {label}
          </DsText>
        </View>
      )}
    </Pressable>
  );
});

/** Two buttons side by side with the design's 9 dp gap. */
export const DsButtonRow = memo(function DsButtonRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const rtl = useRtl();
  return <View style={[{ flexDirection: rtl.rowDirection, gap: 9 }, style]}>{children}</View>;
});
