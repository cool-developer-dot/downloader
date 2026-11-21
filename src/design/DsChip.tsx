import { memo, type ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';
import { withAlpha } from '@/theme';

import { DsText } from './DsText';
import { ds } from './tokens';

export type DsChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** The design's pill chip: 31 dp tall; white with a hairline edge, or soft red with red semibold text when selected. */
export const DsChip = memo(function DsChip({ label, selected = false, onPress, disabled = false, accessibilityLabel, testID }: DsChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      hitSlop={{ top: 8, bottom: 8 }}
      style={{
        height: ds.size.chipHeight,
        paddingHorizontal: ds.size.chipPadX,
        borderRadius: ds.radius.chip,
        borderWidth: 1,
        borderColor: selected ? withAlpha(theme.colors.primary, 0.3) : theme.colors.cardBorder,
        backgroundColor: selected ? theme.colors.accentSoft : theme.colors.card,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <DsText variant={selected ? 'chipSelected' : 'chip'} numberOfLines={1}>
        {label}
      </DsText>
    </Pressable>
  );
});

export type DsChipRowProps = {
  children: ReactNode;
  /** Scrolls sideways past the screen edge (the design's "Playlis…" cut-off). Default true. */
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** A row of chips with 8 dp gaps, scrolling past the gutter when they don't fit. */
export const DsChipRow = memo(function DsChipRow({ children, scroll = true, style, testID }: DsChipRowProps) {
  const rtl = useRtl();
  if (!scroll) {
    return (
      <View testID={testID} style={[{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', gap: ds.space.chip }, style]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[{ marginHorizontal: -ds.space.screenX }, style]}
      contentContainerStyle={{ paddingHorizontal: ds.space.screenX, gap: ds.space.chip, flexDirection: rtl.rowDirection }}>
      {children}
    </ScrollView>
  );
});
