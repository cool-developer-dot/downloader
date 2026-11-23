import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type EngineSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** The value as read out and shown at the row's end ("+3 dB", "150 %"). */
  format: (value: number) => string;
  /** Once the finger lifts (or TalkBack adjusts it): the value to keep. */
  onCommit: (value: number) => void;
  /** Where the track's fill starts (0 for a balance or an equalizer band: it grows both ways). Default: `min`. */
  origin?: number;
  disabled?: boolean;
  testID?: string;
};

/**
 * A labelled slider for Faran's sound sheets: drag or tap the track; TalkBack adjusts it one step with swipe up / down.
 * Built on PanResponder so it works inside the Player's sheets (a React Native Modal). The value moves while dragging
 * and is kept when the finger lifts.
 */
export const EngineSlider = memo(function EngineSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
  origin,
  disabled = false,
  testID,
}: EngineSliderProps) {
  const theme = useTheme();
  const { isRtl: rtl } = useTranslation();
  const [drag, setDrag] = useState<number | null>(null);
  const track = useRef<View>(null);
  const geometry = useRef({ left: 0, width: 1 });
  const latest = useRef({ min, max, step, rtl, onCommit, disabled });
  useEffect(() => {
    latest.current = { min, max, step, rtl, onCommit, disabled };
  });

  const shown = drag ?? value;
  const span = max - min || 1;
  const fraction = (v: number) => Math.min(1, Math.max(0, (v - min) / span));

  const responder = useMemo(() => {
    const valueAt = (pageX: number) => {
      const { left, width } = geometry.current;
      const { min: lo, max: hi, step: inc, rtl: rightToLeft } = latest.current;
      let f = Math.min(1, Math.max(0, (pageX - left) / Math.max(1, width)));
      if (rightToLeft) {
        f = 1 - f;
      }
      const stepped = Math.round((lo + f * (hi - lo)) / inc) * inc;
      return Math.min(hi, Math.max(lo, Number(stepped.toFixed(4))));
    };
    // A drag is the slider's once it goes sideways; until then the sheet may take it as a scroll.
    let sliding = false;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !latest.current.disabled && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      // Lets the sheet's ScrollView take a vertical swipe that starts on the slider.
      onShouldBlockNativeResponder: () => false,
      onPanResponderTerminationRequest: () => !sliding,
      onPanResponderGrant: () => {
        sliding = false;
        track.current?.measureInWindow((left, _top, width) => {
          geometry.current = { left, width };
        });
      },
      onPanResponderMove: (_event, gesture) => {
        if (!sliding && Math.abs(gesture.dx) > SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy)) {
          sliding = true;
        }
        if (sliding) {
          setDrag(valueAt(gesture.moveX));
        }
      },
      onPanResponderRelease: (_event, gesture) => {
        const tap = Math.abs(gesture.dx) <= SLOP && Math.abs(gesture.dy) <= SLOP;
        const wasSliding = sliding;
        sliding = false;
        setDrag(null);
        // A tap sets the value where it lands; a mostly vertical swipe changes nothing.
        if (wasSliding || tap) {
          latest.current.onCommit(valueAt(wasSliding ? gesture.moveX : gesture.x0));
        }
      },
      onPanResponderTerminate: () => {
        sliding = false;
        setDrag(null);
      },
    });
  }, []);

  const onLayout = (_event: LayoutChangeEvent) => {
    track.current?.measureInWindow((left, _top, width) => {
      geometry.current = { left, width };
    });
  };

  const from = fraction(origin ?? min);
  const to = fraction(shown);
  const start = Math.min(from, to);
  const length = Math.abs(to - from);

  return (
    <View
      style={[styles.root, disabled ? styles.disabled : null]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(value) }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (disabled) {
          return;
        }
        const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
        onCommit(Math.min(max, Math.max(min, Number((value + direction * step).toFixed(4)))));
      }}
      testID={testID}>
      <View style={styles.header}>
        <DsText variant="rowTitle" style={styles.label}>
          {label}
        </DsText>
        <DsText variant="rowValue" testID={testID ? `${testID}-value` : undefined}>
          {format(shown)}
        </DsText>
      </View>
      <View ref={track} onLayout={onLayout} style={styles.hit} {...responder.panHandlers}>
        <View style={[styles.track, { backgroundColor: theme.colors.border }]}>
          <View
            style={[
              styles.fill,
              {
                backgroundColor: theme.colors.primary,
                [rtl ? 'right' : 'left']: `${start * 100}%`,
                width: `${length * 100}%`,
              },
            ]}
          />
        </View>
        <View
          style={[
            styles.thumb,
            { backgroundColor: theme.colors.primary, [rtl ? 'right' : 'left']: `${to * 100}%` },
          ]}
        />
      </View>
    </View>
  );
});

const THUMB = 22;
/** How far (dp) a finger moves before it counts as a drag, not a tap. */
const SLOP = 6;

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  disabled: {
    opacity: 0.45,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    flexShrink: 1,
  },
  hit: {
    height: 36,
    justifyContent: 'center',
    marginHorizontal: THUMB / 2,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    marginLeft: -THUMB / 2,
    marginRight: -THUMB / 2,
  },
});
