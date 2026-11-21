import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { ds } from './tokens';

export type DsToggleProps = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled?: boolean;
  testID?: string;
};

const TRAVEL = ds.size.toggleWidth - ds.size.toggleThumb - (ds.size.toggleHeight - ds.size.toggleThumb);
const INSET = (ds.size.toggleHeight - ds.size.toggleThumb) / 2;

/** The design's switch: a 43 × 25 pill, red when on and #D6D5DB when off, with an 18 dp white thumb. */
export const DsToggle = memo(function DsToggle({
  value,
  onValueChange,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  testID,
}: DsToggleProps) {
  const theme = useTheme();
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [position, value]);

  const translateX = position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] });

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (!disabled) onValueChange(!value);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: value, disabled }}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      style={{ minHeight: 44, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      <View
        style={{
          width: ds.size.toggleWidth,
          height: ds.size.toggleHeight,
          borderRadius: ds.radius.toggle,
          backgroundColor: value ? theme.colors.primary : theme.colors.switchOff,
          justifyContent: 'center',
        }}>
        <Animated.View
          style={{
            width: ds.size.toggleThumb,
            height: ds.size.toggleThumb,
            borderRadius: ds.size.toggleThumb / 2,
            backgroundColor: theme.colors.white,
            marginStart: INSET,
            transform: [{ translateX }],
          }}
        />
      </View>
    </Pressable>
  );
});
