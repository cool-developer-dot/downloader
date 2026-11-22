import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslateFn } from '@/localization';
import { videoInfoRows, videoInfoSummary, type VideoInfoInput, type VideoInfoRow } from '@/player/video-display';
import { VIDEO_INFO_LABELS } from '@/player/video-display-labels';

/**
 * P2 #721 Info overlay: what is playing — codec, size, frame rate, bit rate, dynamic range — and the speed. When it is
 * on it is always shown, and never over a control:
 *
 * - The page (screen 19): one line under the video card (`VideoInfoLine`, page colours).
 * - Full screen / landscape with the controls showing: the same line in the timeline dock's bottom row, between the
 *   volume button and the speed chip (`VideoInfoLine`, on the dark dock).
 * - Full screen / landscape with the controls hidden: this box, in the top corner at the end of the reading direction
 *   (right in English, left in Urdu), at the height of the lock button (which is at the start), below the 2× pill.
 *
 * A value the player doesn't know is left out. It never takes a touch; TalkBack reads it as one label.
 */
export const VideoInfoOverlay = memo(function VideoInfoOverlay({ visible, info }: { visible: boolean; info: VideoInfoInput }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  if (!visible) {
    return null;
  }
  const rows = videoInfoRows(info);
  return (
    <View
      style={[styles.box, rtl.end === 'right' ? styles.right : styles.left]}
      pointerEvents="none"
      accessible
      accessibilityLabel={infoA11y(t, rows)}
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

export type VideoInfoLineProps = {
  info: VideoInfoInput;
  /** `onVideo`: white, in the dark timeline dock; `onPage`: the theme's secondary text, under the video card. */
  tone: 'onVideo' | 'onPage';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The info overlay as one line ("H.264 · 1920 × 1080 · 29.97 fps · 4.2 Mb/s · SDR · 1.0×"). */
export const VideoInfoLine = memo(function VideoInfoLine({ info, tone, style, testID }: VideoInfoLineProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const rows = videoInfoRows(info);
  return (
    <View style={style} pointerEvents="none" accessible accessibilityLabel={infoA11y(t, rows)} testID={testID}>
      <DsText
        variant="chip"
        color={tone === 'onVideo' ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary}
        numberOfLines={1}
        align={tone === 'onVideo' ? 'center' : rtl.textAlign}>
        {videoInfoSummary(rows)}
      </DsText>
    </View>
  );
});

function infoA11y(t: TranslateFn, rows: VideoInfoRow[]): string {
  const details = rows.map((row) => `${t(VIDEO_INFO_LABELS[row.key])} ${row.value}`).join(', ');
  return t('videoPlayer.infoOverlayA11y', { details });
}

/** Full screen, controls hidden: level with the lock button (which sits at the start), clear of the 2× pill above. */
const BOX_TOP = 64;

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: BOX_TOP,
    zIndex: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  left: { left: 12 },
  right: { right: 12 },
  row: {
    gap: 8,
    alignItems: 'baseline',
  },
  label: {
    minWidth: 64,
  },
});
