import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { LONG_PRESS_PLAYBACK_RATE } from '@/player';

/** P1 #545: "2× speed ⏩" at the top of the picture while a finger holds it. */
export const LongPressSpeedPill = memo(function LongPressSpeedPill({ visible }: { visible: boolean }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  if (!visible) {
    return null;
  }
  return (
    <View style={styles.wrap} pointerEvents="none" testID="player-long-press-speed">
      <View style={[styles.pill, { flexDirection: rtl.rowDirection }]}>
        <DsText variant="bodyStrong" color={theme.colors.white}>
          {t('videoPlayer.longPressSpeed', { rate: `${LONG_PRESS_PLAYBACK_RATE}×` })}
        </DsText>
        <DsIcon name="fast-forward" size={16} color={theme.colors.white} fill={theme.colors.white} strokeWidth={2} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  pill: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});
