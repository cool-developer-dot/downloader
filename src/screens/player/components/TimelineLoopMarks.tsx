import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * P5 #541: A and B on the track (thin white ticks) and the part between them lightly filled. Fixed colours over the
 * dark stage, like the track itself, so they read in every theme. Not touchable: the timeline still takes every touch.
 */
export const TimelineLoopMarks = memo(function TimelineLoopMarks({ marks, color }: { marks: { a: number | null; b: number | null } | null; color: string }) {
  if (!marks || (marks.a == null && marks.b == null)) {
    return null;
  }
  const { a, b } = marks;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="player-timeline-loop">
      {a != null && b != null ? (
        <View
          style={[
            styles.loopSpan,
            { left: `${Math.min(a, b) * 100}%`, width: `${Math.abs(b - a) * 100}%`, backgroundColor: color },
          ]}
        />
      ) : null}
      {a != null ? <View style={[styles.loopTick, { left: `${a * 100}%` }]} testID="player-timeline-loop-a" /> : null}
      {b != null ? <View style={[styles.loopTick, { left: `${b * 100}%` }]} testID="player-timeline-loop-b" /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  loopSpan: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    opacity: 0.35,
  },
  loopTick: {
    position: 'absolute',
    top: -5,
    bottom: -5,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: '#FFFFFF',
  },
});
