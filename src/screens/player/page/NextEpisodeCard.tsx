import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsButton, DsText } from '@/design';
import { useTranslation } from '@/localization';

export type NextEpisodeCardProps = {
  visible: boolean;
  title: string;
  secondsLeft: number;
  /** Room kept below the card (the controls along the bottom, while they show). */
  bottom: number;
  onPlayNow: () => void;
  onCancel: () => void;
};

/**
 * P6 #733 Next Episode Prompt: "Next: <title>", a countdown, Play now and Cancel, at the bottom end of the picture.
 * A fixed dark card over the video (like the info overlay), so it reads in every theme.
 */
export const NextEpisodeCard = memo(function NextEpisodeCard({
  visible,
  title,
  secondsLeft,
  bottom,
  onPlayNow,
  onCancel,
}: NextEpisodeCardProps) {
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }
  return (
    <View style={[styles.card, { bottom }]} testID="player-next-episode">
      <DsText variant="bodyStrong" color="#FFFFFF" numberOfLines={2} accessibilityLiveRegion="polite">
        {t('videoPlayer.nextEpisodeTitle', { title })}
      </DsText>
      <DsText variant="rowSub" color="rgba(255,255,255,0.8)" testID="player-next-episode-countdown">
        {t('videoPlayer.nextEpisodeIn', { seconds: secondsLeft })}
      </DsText>
      <View style={styles.buttons}>
        <DsButton label={t('videoPlayer.nextEpisodePlayNow')} flex onPress={onPlayNow} testID="player-next-episode-play" />
        <DsButton
          label={t('videoPlayer.nextEpisodeCancel')}
          variant="secondary"
          flex
          onPress={onCancel}
          testID="player-next-episode-cancel"
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    end: 12,
    width: 280,
    maxWidth: '80%',
    padding: 12,
    gap: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(17,17,20,0.88)',
    zIndex: 6,
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
});
