import { memo } from 'react';

import { DsButton, DsText } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import type { EditKind } from '@/media-edit/edit-plan';
import { EditJobBanner } from '@/screens/media-edit/EditJobBanner';

import { PlayerSheetFrame } from './PlayerSheetFrame';

const TITLES: Readonly<Record<EditKind, TranslationKey>> = {
  trim: 'mediaEdit.trimTitle',
  audio: 'videoPlayer.editingAudio',
  mp4: 'videoPlayer.editingMp4',
  compress: 'videoPlayer.editingCompress',
  // P12 Export extras.
  gif: 'videoPlayer.editingGif',
  merge: 'videoPlayer.editingMerge',
  speed: 'videoPlayer.editingSpeed',
};

export type EditProgressSheetProps = {
  visible: boolean;
  /** The library item being edited (the banner shows only its edit). */
  sourceId: string | null;
  kind: EditKind | null;
  onClose: () => void;
};

/**
 * P10: the edit started from the Player — its progress and Cancel (the Downloader's EditJobBanner), and that the video
 * stays paused. Hide closes the sheet; the edit goes on (its notification shows it too) and its rows reopen this.
 */
export const EditProgressSheet = memo(function EditProgressSheet({ visible, sourceId, kind, onClose }: EditProgressSheetProps) {
  const { t } = useTranslation();
  if (!sourceId) {
    return null;
  }
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t(TITLES[kind ?? 'mp4'])}
      onClose={onClose}
      testID="player-edit-progress-sheet">
      <EditJobBanner sourceId={sourceId} testID="player-edit-job" />
      {/* P12: a GIF goes to the Gallery, not the Library. */}
      <DsText variant="rowSub">{t(kind === 'gif' ? 'videoPlayer.gifPausedNote' : 'videoPlayer.editPausedNote')}</DsText>
      <DsButton label={t('videoPlayer.editHide')} variant="secondary" onPress={onClose} fullWidth testID="player-edit-hide" />
    </PlayerSheetFrame>
  );
});
