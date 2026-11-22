import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { videoInfoRows, type VideoInfoInput } from '@/player/video-display';
import { VIDEO_INFO_LABELS } from '@/player/video-display-labels';

export type VideoInfoOverlayProps = {
  visible: boolean;
  info: VideoInfoInput;
};

/**
 * P2 #721 Info overlay: what is playing — codec, size, frame rate, bit rate, dynamic range — and the speed, in the
 * picture's top corner at the end of the reading direction (right in English, left in Urdu), where nothing else is
 * while the controls are hidden (the lock pill is at the start). Shown only while the controls are hidden; values the
 * player doesn't know are left out. It never takes a touch.
 */
export const VideoInfoOverlay = memo(function VideoInfoOverlay({ visible, info }: VideoInfoOverlayProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  if (!visible) {
    return null;
  }
  const rows = videoInfoRows(info);
  const details = rows.map((row) => `${t(VIDEO_INFO_LABELS[row.key])} ${row.value}`).join(', ');
  return (
    <View
      style={[styles.box, rtl.end === 'right' ? styles.right : styles.left]}
      pointerEvents="none"
      accessible
      accessibilityLabel={t('videoPlayer.infoOverlayA11y', { details })}
      testID="player-info-overlay">
      {rows.map((row) => (
        <View key={row.key} style={[styles.row, { flexDirection: rtl.rowDirection }]}>
          <DsText variant="chip" color="rgba(255,255,255,0.72)" style={styles.label}>
            {t(VIDEO_INFO_LABELS[row.key])}
          </DsText>
          <DsText variant="chipSelected" color={theme.colors.white}>
            {row.value}
          </DsText>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 8,
    zIndex: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  left: { left: 8 },
  right: { right: 8 },
  row: {
    gap: 8,
    alignItems: 'baseline',
  },
  label: {
    minWidth: 64,
  },
});
