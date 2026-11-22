import { memo, useMemo } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation, type TranslationKey } from '@/localization';

import { OPTIONS_MENU, type PlayerPageAction } from './player-page-actions';

const ITEMS: Record<(typeof OPTIONS_MENU)[number], { label: TranslationKey; icon: string }> = {
  stop: { label: 'videoPlayer.stop', icon: 'stop' },
  jumpToTime: { label: 'videoPlayer.jumpToTime', icon: 'clock-outline' },
  frameByFrame: { label: 'videoPlayer.frameTitle', icon: 'filmstrip' },
  seekInterval: { label: 'videoPlayer.seekInterval', icon: 'fast-forward' },
  orientation: { label: 'player.orientationTitle', icon: 'screen-rotation' },
};

export type PlayerOptionsSheetProps = {
  visible: boolean;
  /** A file another app opened: "Save to VidoraX" comes first (the page has no other place for it). */
  save: { state: 'idle' | 'saving' | 'saved' } | null;
  /** False while the video can't take commands: only Orientation (and Save) stay. */
  playbackReady: boolean;
  onAction: (action: PlayerPageAction) => void;
  onClose: () => void;
};

/** P1: the ⋮ Video options menu of the page header, the video card and the full-screen top bar. */
export const PlayerOptionsSheet = memo(function PlayerOptionsSheet({
  visible,
  save,
  playbackReady,
  onAction,
  onClose,
}: PlayerOptionsSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(() => {
    const items: ActionSheetItem[] = [];
    if (save && save.state === 'idle') {
      items.push({
        id: 'player-option-save',
        label: t('player.saveToLibrary'),
        icon: 'content-save-outline',
        onPress: () => onAction('saveToLibrary'),
      });
    }
    for (const id of OPTIONS_MENU) {
      if (!playbackReady && id !== 'orientation' && id !== 'seekInterval') {
        continue;
      }
      items.push({
        id: `player-option-${id}`,
        label: t(ITEMS[id].label),
        icon: ITEMS[id].icon,
        onPress: () => onAction(id),
      });
    }
    return items;
  }, [onAction, playbackReady, save, t]);

  return (
    <ActionSheetModal
      visible={visible}
      title={t('videoPlayer.optionsTitle')}
      actions={actions}
      onClose={onClose}
      testID="player-options-sheet"
    />
  );
});
