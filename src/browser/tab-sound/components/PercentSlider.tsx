import { memo, useMemo, useRef, useState } from 'react';
import { PanResponder, View, type AccessibilityActionEvent } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

const STEP = 5;
const THUMB = 24;

/**
 * B3 — a 0–100 % slider: drag or tap the track; TalkBack's swipe up / down (adjustable) moves it by 5 %. Mirrors in
 * RTL (100 % on the left). 48 dp tall.
 */
export const PercentSlider = memo(function PercentSlider({
  value,
  onChange,
  accessibilityLabel,
  testID,
}: {
  value: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const theme = useTheme();
  const { rtl, t } = useTranslation();
  const [width, setWidth] = useState(0);
  const latest = useRef({ width, onChange, isRtl: rtl.isRtl });
  latest.current = { width, onChange, isRtl: rtl.isRtl };

  const responder = useMemo(() => {
    const at = (x: number) => {
      const { width: w, onChange: change, isRtl } = latest.current;
      if (w <= 0) return;
      const fraction = Math.max(0, Math.min(1, x / w));
      change(Math.round(((isRtl ? 1 - fraction : fraction) * 100) / STEP) * STEP);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => at(event.nativeEvent.locationX),
      onPanResponderMove: (event) => at(event.nativeEvent.locationX),
    });
  }, []);

  const clamped = Math.max(0, Math.min(100, value));
  const fill = (clamped / 100) * width;
  const thumbStart = Math.max(0, Math.min(width - THUMB, fill - THUMB / 2));

  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') onChange(Math.min(100, clamped + STEP));
    if (event.nativeEvent.actionName === 'decrement') onChange(Math.max(0, clamped - STEP));
  };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: clamped, text: t('browserTabSound.volumePercent', { percent: clamped }) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ height: 48, justifyContent: 'center' }}
      {...responder.panHandlers}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.border }} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          height: 6,
          borderRadius: 3,
          width: fill,
          backgroundColor: theme.colors.primary,
          ...(rtl.isRtl ? { right: 0 } : { left: 0 }),
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: theme.colors.primary,
          ...(rtl.isRtl ? { right: thumbStart } : { left: thumbStart }),
        }}
      />
    </View>
  );
});
