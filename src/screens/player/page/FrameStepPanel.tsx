import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { formatFrameTime } from '@/player';

export type FrameStepPanelProps = {
  /** The frame on screen: its start time and number on the track's frame grid. */
  frameStartSeconds: number | null;
  frameIndex: number | null;
  disabled: boolean;
  onStep: (direction: -1 | 1) => void;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * P1 #531 Frame by Frame: a small card that stays over the page (not a sheet, so the paused picture stays in view)
 * with one frame back, the frame's time and number, one frame forward, and ✕. Back closes it too.
 */
export const FrameStepPanel = memo(function FrameStepPanel({
  frameStartSeconds,
  frameIndex,
  disabled,
  onStep,
  onClose,
  style,
}: FrameStepPanelProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const time = formatFrameTime(frameStartSeconds);
  const frame = frameIndex == null ? '–' : String(frameIndex + 1);
  return (
    <View
      testID="player-frame-panel"
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.cardBorder,
          flexDirection: rtl.rowDirection,
          shadowColor: theme.colors.primary,
        },
        style,
      ]}>
      {/* Previous / next frame keep the timeline's physical order: back is always on the left. */}
      <View style={styles.steps}>
        <Pressable
          onPress={() => onStep(-1)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t('videoPlayer.framePrevious')}
          style={[styles.stepButton, { backgroundColor: theme.colors.accentSoft }]}
          testID="player-frame-previous">
          <DsIcon name="step-back" size={22} color="primary" strokeWidth={2} />
        </Pressable>
        <View
          style={styles.readout}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={t('videoPlayer.framePosition', { time, frame })}>
          <DsText variant="bodyStrong" align="center" numberOfLines={1}>
            {time}
          </DsText>
          <DsText variant="rowSub" align="center" numberOfLines={1}>
            {t('videoPlayer.frameNumber', { frame })}
          </DsText>
        </View>
        <Pressable
          onPress={() => onStep(1)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t('videoPlayer.frameNext')}
          style={[styles.stepButton, { backgroundColor: theme.colors.accentSoft }]}
          testID="player-frame-next">
          <DsIcon name="step-forward" size={22} color="primary" strokeWidth={2} />
        </Pressable>
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('videoPlayer.frameClose')}
        style={styles.close}
        testID="player-frame-close">
        <DsIcon name="x" size={20} color="textSecondary" strokeWidth={2} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: ds.radius.card,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
    ...ds.shadow.fab,
  },
  steps: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepButton: {
    width: 52,
    height: 48,
    borderRadius: ds.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: {
    flex: 1,
    minWidth: 0,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
