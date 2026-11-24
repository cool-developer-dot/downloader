import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { CastMediaState } from '@modules/vidorax-media/src/VidoraCast.types';

import { DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

/**
 * P13 #667: the video area while the TV plays — "Casting to <device>" and what the TV is doing, in place of the
 * paused picture. Over the video, so always the player's black with white text (as the startup cover), in every theme.
 * The controls stay on top of it and drive the TV.
 */
export const CastingOverlay = memo(function CastingOverlay({
  visible,
  connecting,
  deviceName,
  state,
}: {
  visible: boolean;
  connecting: boolean;
  deviceName: string | null;
  state: CastMediaState;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }
  const white = theme.colors.white;
  const name = deviceName || t('playerCast.thisDevice');
  const title = connecting ? t('playerCast.connecting', { device: name }) : t('playerCast.castingTo', { device: name });
  const detail = connecting
    ? null
    : state === 'playing'
      ? t('playerCast.statePlaying')
      : state === 'paused'
        ? t('playerCast.statePaused')
        : state === 'finished'
          ? t('playerCast.stateFinished')
          : state === 'buffering'
            ? t('playerCast.stateBuffering')
            : t('playerCast.stateIdle');
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: theme.colors.black }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      testID="player-casting-overlay">
      <DsIcon name="cast" size={40} color={white} strokeWidth={1.8} />
      <DsText variant="cardTitle" color={white} numberOfLines={2} style={styles.text}>
        {title}
      </DsText>
      {detail ? (
        <DsText variant="body" color={white} numberOfLines={1} style={[styles.text, styles.detail]}>
          {detail}
        </DsText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  text: {
    textAlign: 'center',
  },
  detail: {
    opacity: 0.8,
  },
});
