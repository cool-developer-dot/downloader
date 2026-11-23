import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * P9 #705: the video's bookmarks on the track, as small round dots (P5's A-B points are thin white ticks). Fixed
 * colours over the dark stage, like the track itself, so they read in every theme: amber with a dark rim, which also
 * shows over the white played part. Not touchable: the timeline still takes every touch.
 */
export const TimelineBookmarkMarks = memo(function TimelineBookmarkMarks({ marks }: { marks: readonly number[] | null }) {
  if (!marks || marks.length === 0) {
    return null;
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="player-timeline-bookmarks">
      {marks.map((fraction) => (
        <View key={fraction} style={[styles.dot, { left: `${Math.max(0, Math.min(1, fraction)) * 100}%` }]} />
      ))}
    </View>
  );
});

const DOT = 7;

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: '50%',
    width: DOT,
    height: DOT,
    marginTop: -DOT / 2,
    marginLeft: -DOT / 2,
    borderRadius: DOT / 2,
    backgroundColor: '#FFC83D',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.6)',
  },
});
