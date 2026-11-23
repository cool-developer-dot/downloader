import { memo, useMemo } from 'react';

import { useTranslation } from '@/localization';
import { STREAM_QUALITIES, type StreamQuality } from '@/player/engine/stream-quality';
import { streamCapLabel, type PlayerEngineSheets as Sheets } from '@/player/engine/use-player-engine';

import { EngineChoiceSheet, type EngineChoice } from './EngineChoiceSheet';
import { AudioSheet } from './AudioSheet';
import { HeadsetKeysSheet } from './HeadsetKeysSheet';
import { DailyLimitSheet, LimitReachedSheet, SleepTimerSheet } from './SleepLimitSheets';

export type PlayerEngineSheetsProps = { sheets: Sheets };

/** The sheets of Faran's Player packages (P14–P19), drawn by the Player screen next to its own. */
export const PlayerEngineSheets = memo(function PlayerEngineSheets({ sheets }: PlayerEngineSheetsProps) {
  const { t } = useTranslation();

  // P14 #670
  const streamChoices = useMemo<EngineChoice<StreamQuality>[]>(
    () =>
      STREAM_QUALITIES.map((quality) => ({
        value: quality,
        label: streamCapLabel(t, quality),
        subtitle:
          quality === 'auto'
            ? t('playerEngine.streamQualityAutoSub')
            : quality === 'saver'
              ? t('playerEngine.streamQualitySaverSub')
              : undefined,
      })),
    [t],
  );

  return (
    <>
      <EngineChoiceSheet
        visible={sheets.streamQuality.visible}
        title={t('playerEngine.streamQuality')}
        subtitle={t('playerEngine.streamQualitySubtitle')}
        choices={streamChoices}
        selected={sheets.streamQuality.selected}
        onSelect={sheets.streamQuality.select}
        onClose={sheets.streamQuality.close}
        testID="player-stream-quality-sheet"
      />
      <HeadsetKeysSheet visible={sheets.headsetKeys.visible} onClose={sheets.headsetKeys.close} />
      <AudioSheet visible={sheets.audio.visible} onClose={sheets.audio.close} audio={sheets.audio.engine} />
      <SleepTimerSheet visible={sheets.sleepTimer.visible} onClose={sheets.sleepTimer.close} />
      {sheets.dailyLimit.visible ? <DailyLimitSheet visible onClose={sheets.dailyLimit.close} /> : null}
      {sheets.limitReached.visible ? <LimitReachedSheet visible onClose={sheets.limitReached.close} /> : null}
    </>
  );
});
