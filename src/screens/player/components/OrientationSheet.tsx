import { memo, useMemo } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation } from '@/localization';
import { ORIENTATION_MODES, type OrientationMode } from '@/player/orientation-mode';

export type OrientationSheetProps = {
  visible: boolean;
  selectedMode: OrientationMode;
  onSelect: (mode: OrientationMode) => void;
  onClose: () => void;
};

export const OrientationSheet = memo(function OrientationSheet({
  visible,
  selectedMode,
  onSelect,
  onClose,
}: OrientationSheetProps) {
  const { t } = useTranslation();

  const actions = useMemo<ActionSheetItem[]>(
    () =>
      ORIENTATION_MODES.map((mode) => ({
        id: `orientation-${mode}`,
        label: t(`player.orientation.${mode}`),
        selected: selectedMode === mode,
        onPress: () => onSelect(mode),
      })),
    [onSelect, selectedMode, t],
  );

  return (
    <ActionSheetModal
      visible={visible}
      title={t('player.orientationTitle')}
      subtitle={t('player.orientationSelected', {
        mode: t(`player.orientation.${selectedMode}`),
      })}
      actions={actions}
      onClose={onClose}
      testID="orientation-sheet"
    />
  );
});
