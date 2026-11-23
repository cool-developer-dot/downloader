import { memo, useMemo } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { useTranslation } from '@/localization';
import { editAvailability, type EditSource } from '@/media-edit/edit-plan';
import { AVAILABILITY_KEYS } from '@/screens/media-edit/useRunEdit';

export type VideoConverterSheetProps = {
  visible: boolean;
  source: EditSource | null;
  onSelect: (kind: 'mp4' | 'audio') => void;
  onClose: () => void;
};

/**
 * P10 Video converter (#679): the Downloader's Convert choices (#376) for the video playing — MP4 video (H.264 / H.265
 * kept, anything else re-encoded to H.264, AAC sound) or audio only (.m4a). A choice that doesn't apply says why.
 */
export const VideoConverterSheet = memo(function VideoConverterSheet({ visible, source, onSelect, onClose }: VideoConverterSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(() => {
    if (!source) {
      return [];
    }
    return (['mp4', 'audio'] as const).map((kind) => {
      const availability = editAvailability(kind, source);
      const label = kind === 'mp4' ? t('mediaEdit.convertMp4') : t('mediaEdit.convertAudio');
      return {
        id: `player-convert-${kind}`,
        label: availability === 'ok' ? label : `${label} — ${t(AVAILABILITY_KEYS[availability])}`,
        icon: kind === 'mp4' ? 'file-video-outline' : 'music-note-outline',
        onPress: () => {
          onClose();
          if (availability === 'ok') {
            onSelect(kind);
          }
        },
      };
    });
  }, [onClose, onSelect, source, t]);
  return (
    <ActionSheetModal
      visible={visible && source != null}
      onClose={onClose}
      title={t('videoPlayer.videoConverter')}
      subtitle={t('mediaEdit.convertSubtitle')}
      actions={actions}
      testID="player-converter-sheet"
    />
  );
});
