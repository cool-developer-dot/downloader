import { memo, useState } from 'react';
import { View } from 'react-native';

import { DsButton, DsChip, DsChipRow, DsSectionLabel, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { formatTrimTime, type TrimRange } from '@/media-edit/edit-plan';
import {
  SPEED_CHOICES,
  SPEED_DEFAULT,
  formatExportSpeed,
  speedKeptMs,
  speedOutputMs,
  speedRange,
  type SpeedSource,
} from '@/media-edit/speed-plan';
import { trimRangeFromPosition } from '@/player/edit-tools';
import { formatPlaybackTime } from '@/player/format-time';
import { RangeTrack } from '@/screens/media-edit/RangeTrack';

import { PlayerSheetFrame } from './PlayerSheetFrame';

export type SpeedExportSheetProps = {
  source: SpeedSource;
  /** The moment playing when the sheet opened (ms): a part starts there. */
  positionMs: number;
  onSave: (speed: number, part: TrimRange | null) => void;
  onClose: () => void;
};

/**
 * P12 Change speed (#684): a speed from 0.25× to 4×, the whole video or a part (the Trim screen's handles; it starts at
 * the moment playing), and the copy's new length before anything starts. Saves a new copy; the original stays.
 * Rendered only while open, so each opening starts afresh.
 */
export const SpeedExportSheet = memo(function SpeedExportSheet({ source, positionMs, onSave, onClose }: SpeedExportSheetProps) {
  const { t } = useTranslation();
  const duration = Math.floor(source.durationMs ?? 0);
  const [speed, setSpeed] = useState(SPEED_DEFAULT);
  const [whole, setWhole] = useState(true);
  const [range, setRange] = useState<TrimRange>(
    () => trimRangeFromPosition(positionMs / 1000, source.durationMs) ?? { startMs: 0, endMs: duration },
  );
  const check = speedRange(whole ? null : range, source.durationMs);
  const outputMs = check.ok ? speedOutputMs(speedKeptMs(check.range, duration), speed) : 0;

  return (
    <PlayerSheetFrame
      visible
      title={t('videoPlayer.changeSpeed')}
      subtitle={t('videoPlayer.speedSubtitle')}
      onClose={onClose}
      testID="player-speed-sheet">
      <DsChipRow scroll={false} testID="player-speed-choices">
        {SPEED_CHOICES.map((choice) => (
          <DsChip
            key={choice}
            label={formatExportSpeed(choice)}
            selected={choice === speed}
            onPress={() => setSpeed(choice)}
            testID={`player-speed-${choice}`}
          />
        ))}
      </DsChipRow>
      <DsChipRow scroll={false} testID="player-speed-part">
        <DsChip label={t('videoPlayer.speedWhole')} selected={whole} onPress={() => setWhole(true)} testID="player-speed-whole" />
        <DsChip label={t('videoPlayer.speedPart')} selected={!whole} onPress={() => setWhole(false)} testID="player-speed-range" />
      </DsChipRow>
      {whole ? null : (
        <View style={{ gap: 8 }}>
          <DsSectionLabel>{t('videoPlayer.speedPart')}</DsSectionLabel>
          <RangeTrack durationMs={duration} range={range} onChange={setRange} />
          <View style={{ flexDirection: 'row', direction: 'ltr', justifyContent: 'space-between' }}>
            <DsText variant="rowSub">{`${t('mediaEdit.start')} ${formatTrimTime(range.startMs)}`}</DsText>
            <DsText variant="rowSub">{`${t('mediaEdit.length')} ${formatTrimTime(range.endMs - range.startMs)}`}</DsText>
            <DsText variant="rowSub">{`${t('mediaEdit.end')} ${formatTrimTime(range.endMs)}`}</DsText>
          </View>
        </View>
      )}
      {check.ok ? (
        <DsText variant="rowTitle" testID="player-speed-length">
          {t('videoPlayer.speedNewLength', { length: formatPlaybackTime(outputMs / 1000) })}
        </DsText>
      ) : null}
      {source.hasAudio ? <DsText variant="rowSub">{t('videoPlayer.speedSoundNote')}</DsText> : null}
      <DsButton
        label={t('videoPlayer.speedSave', { speed: formatExportSpeed(speed) })}
        icon="gauge"
        onPress={() => onSave(speed, whole ? null : range)}
        disabled={!check.ok}
        fullWidth
        testID="player-speed-save"
      />
    </PlayerSheetFrame>
  );
});
