import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsIcon, DsIconButton, DsRow, DsRowGroup, DsSectionLabel, DsText } from '@/design';
import { useTranslation } from '@/localization';
import {
  MAX_AUDIO_DELAY_MS,
  audioTrackLabel,
  formatAudioDelay,
  isSameAudioTrack,
  stepAudioDelay,
} from '@/player/engine/audio-settings';
import type { AudioEngine } from '@/player/engine/use-audio-engine';

import { PlayerSheetFrame } from '../page/PlayerSheetFrame';

export type AudioSheetProps = {
  visible: boolean;
  onClose: () => void;
  audio: AudioEngine;
  /** P19: the equalizer and sound effects, under the tracks and the delay (screen 22). */
  children?: ReactNode;
};

/**
 * The Audio sheet (screen 19's Audio chip, ⋮ → Audio; design screen 22): P17's audio track (#553), audio delay (#554)
 * and Audio only (#574); P19 adds the equalizer and the effects below them.
 */
export const AudioSheet = memo(function AudioSheet({ visible, onClose, audio, children }: AudioSheetProps) {
  const { t } = useTranslation();
  const delay = formatAudioDelay(audio.delayMs);
  const trackName = (index: number) =>
    audioTrackLabel(audio.tracks[index], index, (n) => t('playerEngine.audioTrackNumber', { n }));
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('playerEngine.audioTitle')}
      subtitle={t('playerEngine.audioSubtitle')}
      onClose={onClose}
      testID="player-audio-sheet">
      <DsSectionLabel first>{t('playerEngine.audioTrack')}</DsSectionLabel>
      {audio.tracks.length > 1 ? (
        <DsRowGroup testID="player-audio-tracks">
          {audio.tracks.map((track, index) => {
            const selected = isSameAudioTrack(track, audio.track);
            const name = trackName(index);
            return (
              <DsRow
                key={track.id ?? `${index}`}
                icon="languages"
                title={name}
                onPress={() => audio.selectTrack(track)}
                trailing={selected ? <DsIcon name="check" size={20} /> : 'none'}
                accessibilityLabel={selected ? `${name}, ${t('common.selected')}` : name}
                testID={`player-audio-track-${index}`}
              />
            );
          })}
        </DsRowGroup>
      ) : (
        <View style={styles.note}>
          <DsText variant="rowSub" testID="player-audio-track-note">
            {audio.tracks.length === 1 ? t('playerEngine.audioTrackOnlyOne') : t('playerEngine.audioTrackNone')}
          </DsText>
        </View>
      )}

      <DsSectionLabel>{t('playerEngine.audioDelay')}</DsSectionLabel>
      <View style={styles.note}>
        <DsText variant="rowSub">{t('playerEngine.audioDelaySub')}</DsText>
      </View>
      <View
        style={styles.stepper}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('playerEngine.audioDelayA11y', { delay })}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          audio.setDelayMs(stepAudioDelay(audio.delayMs, event.nativeEvent.actionName === 'increment' ? 1 : -1))
        }
        testID="player-audio-delay">
        <DsIconButton
          icon="minus"
          accessibilityLabel={t('playerEngine.audioDelayEarlier')}
          disabled={audio.delayMs <= -MAX_AUDIO_DELAY_MS}
          onPress={() => audio.setDelayMs(stepAudioDelay(audio.delayMs, -1))}
          testID="player-audio-delay-earlier"
        />
        <View style={styles.delayValue}>
          <DsText variant="hero" align="center" testID="player-audio-delay-value">
            {delay}
          </DsText>
          <DsText variant="rowSub" align="center">
            {audio.delayMs > 0
              ? t('playerEngine.audioDelayLater')
              : audio.delayMs < 0
                ? t('playerEngine.audioDelayEarlier')
                : ' '}
          </DsText>
        </View>
        <DsIconButton
          icon="plus"
          accessibilityLabel={t('playerEngine.audioDelayLater')}
          disabled={audio.delayMs >= MAX_AUDIO_DELAY_MS}
          onPress={() => audio.setDelayMs(stepAudioDelay(audio.delayMs, 1))}
          testID="player-audio-delay-later"
        />
      </View>
      <DsRowGroup>
        {audio.delayMs !== 0 ? (
          <DsRow
            icon="undo-2"
            title={t('playerEngine.audioDelayReset')}
            onPress={() => audio.setDelayMs(0)}
            testID="player-audio-delay-reset"
          />
        ) : null}
        <DsRow
          icon="music"
          title={t('playerEngine.audioOnly')}
          subtitle={t('playerEngine.audioOnlySub')}
          toggle={{
            value: audio.audioOnly,
            onValueChange: audio.setAudioOnly,
            accessibilityLabel: t('playerEngine.audioOnly'),
          }}
          testID="player-audio-only"
        />
      </DsRowGroup>
      {children}
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  note: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 8,
  },
  delayValue: {
    minWidth: 150,
  },
});
