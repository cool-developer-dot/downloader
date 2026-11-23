import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsIcon, DsText } from '@/design';
import { useTranslation } from '@/localization';

export type AudioOnlyCoverProps = { visible: boolean; title: string };

/**
 * P17 #574: what the picture's place shows while Audio Only Mode is on — the video's title and how to get the picture
 * back. Touches pass through, so the Player's taps and gestures keep working.
 */
export const AudioOnlyCover = memo(function AudioOnlyCover({ visible, title }: AudioOnlyCoverProps) {
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.cover]}
      accessible
      accessibilityLabel={`${t('playerEngine.audioOnlyCover')}. ${title}. ${t('playerEngine.audioOnlyCoverSub')}`}
      testID="player-audio-only-cover">
      <DsIcon name="music" size={44} color="#FFFFFF" />
      <DsText variant="cardTitle" color="#FFFFFF" align="center" numberOfLines={2} style={styles.title}>
        {title}
      </DsText>
      <DsText variant="rowSub" color="rgba(255,255,255,0.78)" align="center" style={styles.sub}>
        {t('playerEngine.audioOnlyCoverSub')}
      </DsText>
    </View>
  );
});

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101014',
    paddingHorizontal: 24,
  },
  title: {
    marginTop: 12,
  },
  sub: {
    marginTop: 6,
  },
});
