import { memo, useMemo } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation } from '@/localization';
import { SEEK_STEP_OPTIONS, type SeekStepSeconds } from '@/player';

export type SeekIntervalSheetProps = {
  visible: boolean;
  selected: SeekStepSeconds;
  onSelect: (seconds: SeekStepSeconds) => void;
  onClose: () => void;
};

/** P1 #527 Custom Seek Interval: how far "10 s", the full-screen ⏪ / ⏩ and a double tap jump. */
export const SeekIntervalSheet = memo(function SeekIntervalSheet({
  visible,
  selected,
  onSelect,
  onClose,
}: SeekIntervalSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(
    () =>
      SEEK_STEP_OPTIONS.map((seconds) => ({
        id: `seek-interval-${seconds}`,
        label: t('videoPlayer.seekIntervalOption', { seconds }),
        selected: seconds === selected,
        onPress: () => onSelect(seconds),
      })),
    [onSelect, selected, t],
  );
  return (
    <ActionSheetModal
      visible={visible}
      title={t('videoPlayer.seekInterval')}
      subtitle={t('videoPlayer.seekIntervalSubtitle', { seconds: selected })}
      actions={actions}
      onClose={onClose}
      testID="player-seek-interval-sheet"
    />
  );
});
