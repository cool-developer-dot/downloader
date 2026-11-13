import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { clampTrimRange, formatTrimTime, MIN_TRIM_MS, type TrimRange } from '@/media-edit/edit-plan';

export type RangeTrackProps = {
  durationMs: number;
  range: TrimRange;
  onChange: (range: TrimRange) => void;
  /** Called when a handle is let go (the preview seeks there). */
  onRelease?: (positionMs: number) => void;
  disabled?: boolean;
};

const THUMB = 28;
const TRACK_HEIGHT = 6;
/** Screen-reader step of a handle. */
const A11Y_STEP_MS = 1_000;

/**
 * The trim timeline: two handles (start, end) on a track. A timeline runs left to right in every language, like the
 * player's own. Every change goes through clampTrimRange, so the kept part is never shorter than one second.
 */
export const RangeTrack = memo(function RangeTrack({ durationMs, range, onChange, onRelease, disabled }: RangeTrackProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const latest = useRef({ range, width, durationMs, onChange, onRelease, disabled });
  useEffect(() => {
    latest.current = { range, width, durationMs, onChange, onRelease, disabled };
  });

  const usable = Math.max(1, width - THUMB);
  const toX = (ms: number) => (durationMs > 0 ? (ms / durationMs) * usable : 0);

  const responders = useMemo(() => {
    const make = (handle: 'start' | 'end') => {
      let originMs = 0;
      return PanResponder.create({
        onStartShouldSetPanResponder: () => !latest.current.disabled,
        onMoveShouldSetPanResponder: () => !latest.current.disabled,
        onPanResponderGrant: () => {
          originMs = handle === 'start' ? latest.current.range.startMs : latest.current.range.endMs;
        },
        onPanResponderMove: (_event, gesture) => {
          const { width: trackWidth, durationMs: total, range: current } = latest.current;
          const span = Math.max(1, trackWidth - THUMB);
          const ms = originMs + (gesture.dx / span) * total;
          const next =
            handle === 'start'
              ? { startMs: Math.min(ms, current.endMs - MIN_TRIM_MS), endMs: current.endMs }
              : { startMs: current.startMs, endMs: Math.max(ms, current.startMs + MIN_TRIM_MS) };
          const check = clampTrimRange(next, total);
          if (check.ok) {
            latest.current.onChange(check.range);
          }
        },
        onPanResponderRelease: () => {
          const current = latest.current.range;
          latest.current.onRelease?.(handle === 'start' ? current.startMs : current.endMs);
        },
      });
    };
    return { start: make('start'), end: make('end') };
  }, []);

  const step = (handle: 'start' | 'end', direction: 1 | -1) => {
    const next =
      handle === 'start'
        ? { startMs: Math.min(range.startMs + direction * A11Y_STEP_MS, range.endMs - MIN_TRIM_MS), endMs: range.endMs }
        : { startMs: range.startMs, endMs: Math.max(range.endMs + direction * A11Y_STEP_MS, range.startMs + MIN_TRIM_MS) };
    const check = clampTrimRange(next, durationMs);
    if (check.ok) {
      onChange(check.range);
      onRelease?.(handle === 'start' ? check.range.startMs : check.range.endMs);
    }
  };

  const thumb = (handle: 'start' | 'end') => {
    const ms = handle === 'start' ? range.startMs : range.endMs;
    const time = formatTrimTime(ms);
    return (
      <View
        {...responders[handle].panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={handle === 'start' ? t('mediaEdit.startHandleA11y', { time }) : t('mediaEdit.endHandleA11y', { time })}
        accessibilityHint={handle === 'start' ? t('mediaEdit.startHandleHint') : t('mediaEdit.endHandleHint')}
        accessibilityValue={{ text: time }}
        accessibilityState={{ disabled: Boolean(disabled) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => step(handle, event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        hitSlop={10}
        testID={`trim-handle-${handle}`}
        style={{
          position: 'absolute',
          left: toX(ms),
          top: 0,
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: theme.colors.primary,
          borderWidth: 3,
          borderColor: theme.colors.background,
        }}
      />
    );
  };

  return (
    <View
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={{ height: THUMB, justifyContent: 'center', direction: 'ltr' }}
      testID="trim-track">
      <View
        style={{
          position: 'absolute',
          left: THUMB / 2,
          right: THUMB / 2,
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          backgroundColor: theme.colors.border,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: THUMB / 2 + toX(range.startMs),
          width: Math.max(0, toX(range.endMs) - toX(range.startMs)),
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          backgroundColor: theme.colors.primary,
        }}
      />
      {thumb('start')}
      {thumb('end')}
    </View>
  );
});
