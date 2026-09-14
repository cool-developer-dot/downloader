import { memo, useMemo } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation } from '@/localization';
import {
  PLAYBACK_RATES,
  formatPlaybackRateLabel,
  type PlaybackRate,
} from '@/player';

export type PlaybackSpeedSheetProps = {
  visible: boolean;
  selectedRate: number;
  onSelect: (rate: PlaybackRate) => void;
  onClose: () => void;
};

export const PlaybackSpeedSheet = memo(function PlaybackSpeedSheet({
  visible,
  selectedRate,
  onSelect,
  onClose,
}: PlaybackSpeedSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(
    () =>
      PLAYBACK_RATES.map((rate) => ({
        id: `rate-${rate}`,
        label: formatPlaybackRateLabel(rate),
        selected: selectedRate === rate,
        onPress: () => onSelect(rate),
      })),
    [onSelect, selectedRate],
  );

  return (
    <ActionSheetModal
      visible={visible}
      title={t('player.playbackSpeed')}
      subtitle={t('player.speedSelected', {
        rate: formatPlaybackRateLabel(selectedRate),
      })}
      actions={actions}
      onClose={onClose}
      testID="playback-speed-sheet"
    />
  );
});
