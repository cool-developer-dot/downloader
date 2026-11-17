import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';

import { DsIcon, type DsIconName } from './DsIcon';
import { DsText } from './DsText';
import { ds } from './tokens';

export type DsFabProps = {
  label: string;
  icon?: DsIconName;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Distance above the screen's bottom edge (default 16; the tab bar is outside the screen). */
  bottom?: number;
  testID?: string;
};

/** The downloads list's floating "+ Add link": a 50 dp red pill at the bottom end corner with a soft red shadow. */
export const DsFab = memo(function DsFab({ label, icon = 'plus', onPress, onLongPress, accessibilityLabel, accessibilityHint, bottom = 16, testID }: DsFabProps) {
  const theme = useTheme();
  const rtl = useRtl();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', bottom, end: ds.space.screenX }}>
      <Pressable
        testID={testID}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => ({
          height: ds.size.fab,
          borderRadius: ds.radius.fab,
          paddingStart: 20,
          paddingEnd: 22,
          backgroundColor: pressed ? theme.colors.primaryDark : theme.colors.primary,
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          gap: 8,
          ...ds.shadow.fab,
        })}>
        <DsIcon name={icon} size={20} color="textOnPrimary" strokeWidth={2.2} />
        <DsText variant="button" color="textOnPrimary" style={{ fontSize: ds.text.fab, lineHeight: 22 }}>
          {label}
        </DsText>
      </Pressable>
    </View>
  );
});
