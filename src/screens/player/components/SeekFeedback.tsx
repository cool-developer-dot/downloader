import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/base/Text';
import { formatPlaybackTime } from '@/player';

export type SeekFeedbackOverlayProps = {
  previewSeconds: number | null;
  durationSeconds: number | null;
  visible: boolean;
};

/** Drag seek feedback: target / duration. No frame previews. */
export const SeekFeedbackOverlay = memo(function SeekFeedbackOverlay({
  previewSeconds,
  durationSeconds,
  visible,
}: SeekFeedbackOverlayProps) {
  if (!visible || previewSeconds == null) {
    return null;
  }

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.pill}>
        <Text variant="subtitle" color="white">
          {formatPlaybackTime(previewSeconds)}
          {' / '}
          {formatPlaybackTime(durationSeconds)}
        </Text>
      </View>
    </View>
  );
});

export type DoubleTapSeekFeedbackProps = {
  side: 'left' | 'right' | null;
};

export const DoubleTapSeekFeedback = memo(function DoubleTapSeekFeedback({
  side,
}: DoubleTapSeekFeedbackProps) {
  if (!side) {
    return null;
  }

  return (
    <View
      style={[styles.doubleWrap, side === 'left' ? styles.left : styles.right]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        side === 'left' ? 'Rewound 10 seconds' : 'Forwarded 10 seconds'
      }>
      <View style={styles.pill}>
        <Text variant="title" color="white">
          {side === 'left' ? '↶ 10' : '10 ↷'}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  doubleWrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    zIndex: 3,
  },
  left: {
    alignItems: 'flex-start',
    paddingLeft: 40,
  },
  right: {
    alignItems: 'flex-end',
    paddingRight: 40,
  },
});
