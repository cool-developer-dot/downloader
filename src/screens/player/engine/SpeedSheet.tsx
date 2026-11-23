import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsChip, DsChipRow, DsIcon, DsIconButton, DsRow, DsRowGroup, DsSectionLabel, DsText } from '@/design';
import { useTranslation } from '@/localization';
import {
  SPEED_SHORTCUT_RATES,
  setSpeedSettings,
  stepPlaybackRate,
  useSpeedSettings,
} from '@/player/engine/speed-settings';
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  PLAYBACK_RATES,
  formatPlaybackRateChip,
} from '@/player/playback-rates';

import { PlayerSheetFrame } from '../page/PlayerSheetFrame';

export type SpeedSheetProps = {
  visible: boolean;
  rate: number;
  /** A preset: set it and close. */
  onSelect: (rate: number) => void;
  /** − / +: set it, the sheet stays open. */
  onAdjust: (rate: number) => void;
  onClose: () => void;
};

/**
 * Faran's P16 speed sheet (the 1.0× chip, the full-screen speed button, ⋮ → Playback → Playback speed): one-tap presets,
 * − / + in 0.1 steps from 0.25× to 4× (#537), natural voice (#538), each video's own speed (#736) and what the speed
 * button does (#544). Settings apply at once and are app-wide.
 */
export const SpeedSheet = memo(function SpeedSheet({ visible, rate, onSelect, onAdjust, onClose }: SpeedSheetProps) {
  const { t } = useTranslation();
  const settings = useSpeedSettings();
  const current = formatPlaybackRateChip(rate);
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('playerEngine.speedTitle')}
      subtitle={t('playerEngine.speedSubtitle', { rate: current })}
      onClose={onClose}
      testID="player-speed-sheet">
      <View
        style={styles.stepper}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('playerEngine.speedFineA11y', { rate: current })}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          onAdjust(stepPlaybackRate(rate, event.nativeEvent.actionName === 'increment' ? 1 : -1))
        }>
        <DsIconButton
          icon="minus"
          accessibilityLabel={t('playerEngine.speedSlower')}
          disabled={rate <= MIN_PLAYBACK_RATE + 1e-6}
          onPress={() => onAdjust(stepPlaybackRate(rate, -1))}
          testID="player-speed-slower"
        />
        <DsText variant="hero" style={styles.value} testID="player-speed-value">
          {current}
        </DsText>
        <DsIconButton
          icon="plus"
          accessibilityLabel={t('playerEngine.speedFaster')}
          disabled={rate >= MAX_PLAYBACK_RATE - 1e-6}
          onPress={() => onAdjust(stepPlaybackRate(rate, 1))}
          testID="player-speed-faster"
        />
      </View>
      <DsChipRow testID="player-speed-presets">
        {PLAYBACK_RATES.map((preset) => (
          <DsChip
            key={preset}
            label={formatPlaybackRateChip(preset)}
            selected={Math.abs(preset - rate) < 1e-6}
            onPress={() => onSelect(preset)}
            testID={`player-speed-preset-${preset}`}
          />
        ))}
      </DsChipRow>
      <DsRowGroup>
        <DsRow
          icon="music"
          title={t('playerEngine.speedPitch')}
          subtitle={t('playerEngine.speedPitchSub')}
          toggle={{
            value: settings.pitchCorrection,
            onValueChange: (next) => setSpeedSettings({ pitchCorrection: next }),
            accessibilityLabel: t('playerEngine.speedPitch'),
          }}
          testID="player-speed-pitch"
        />
        <DsRow
          icon="book-open"
          title={t('playerEngine.speedPerVideo')}
          subtitle={t('playerEngine.speedPerVideoSub')}
          toggle={{
            value: settings.rememberPerVideo,
            onValueChange: (next) => setSpeedSettings({ rememberPerVideo: next }),
            accessibilityLabel: t('playerEngine.speedPerVideo'),
          }}
          testID="player-speed-per-video"
        />
      </DsRowGroup>
      <DsSectionLabel>{t('playerEngine.speedButton')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow
          icon="list"
          title={t('playerEngine.speedButtonSheet')}
          onPress={() => setSpeedSettings({ speedButton: 'sheet' })}
          trailing={settings.speedButton === 'sheet' ? <DsIcon name="check" size={20} /> : 'none'}
          accessibilityLabel={
            settings.speedButton === 'sheet'
              ? `${t('playerEngine.speedButtonSheet')}, ${t('common.selected')}`
              : t('playerEngine.speedButtonSheet')
          }
          testID="player-speed-button-sheet"
        />
        <DsRow
          icon="zap"
          title={t('playerEngine.speedButtonSwitch', { rate: formatPlaybackRateChip(settings.shortcutRate) })}
          subtitle={t('playerEngine.speedButtonSwitchSub')}
          onPress={() => setSpeedSettings({ speedButton: 'switch' })}
          trailing={settings.speedButton === 'switch' ? <DsIcon name="check" size={20} /> : 'none'}
          accessibilityLabel={[
            t('playerEngine.speedButtonSwitch', { rate: formatPlaybackRateChip(settings.shortcutRate) }),
            t('playerEngine.speedButtonSwitchSub'),
            ...(settings.speedButton === 'switch' ? [t('common.selected')] : []),
          ].join(', ')}
          testID="player-speed-button-switch"
        />
      </DsRowGroup>
      {settings.speedButton === 'switch' ? (
        <DsChipRow testID="player-speed-shortcut">
          {SPEED_SHORTCUT_RATES.map((shortcut) => (
            <DsChip
              key={shortcut}
              label={formatPlaybackRateChip(shortcut)}
              selected={Math.abs(shortcut - settings.shortcutRate) < 1e-6}
              onPress={() => setSpeedSettings({ shortcutRate: shortcut })}
              accessibilityLabel={t('playerEngine.speedShortcutA11y', { rate: formatPlaybackRateChip(shortcut) })}
              testID={`player-speed-shortcut-${shortcut}`}
            />
          ))}
        </DsChipRow>
      ) : null}
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingVertical: 12,
  },
  value: {
    minWidth: 104,
    textAlign: 'center',
  },
});
