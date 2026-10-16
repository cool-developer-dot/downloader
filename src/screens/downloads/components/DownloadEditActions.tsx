import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { isEngineOwned } from '@/downloads/v2';
import { useTranslation } from '@/localization';
import { editAvailability, type EditSource } from '@/media-edit/edit-plan';
import { getEditPort } from '@/media-edit/edit-port';
import { useMediaArtist } from '@/media-edit/media-tags-store';
import { navigation } from '@/navigation';
import { EditJobBanner } from '@/screens/media-edit/EditJobBanner';
import { MediaTagsModal } from '@/screens/media-edit/MediaTagsModal';
import { AVAILABILITY_KEYS, useRunEdit } from '@/screens/media-edit/useRunEdit';
import { useDownloadsStore } from '@/store/downloads';

export type DownloadEditActionsProps = {
  id: string;
};

/** The Trim screen's route (src/app/(app)/edit-trim.tsx). */
export const EDIT_TRIM_ROUTE = '/edit-trim';

/**
 * Download details → Edit (#374, #375, #376): Trim, Convert (MP4 or audio only), Title & artist. Every edit saves a
 * new copy; the original is never changed. Only for completed library items; hidden on builds without the editor.
 */
export const DownloadEditActions = memo(function DownloadEditActions({ id }: DownloadEditActionsProps) {
  const { t } = useTranslation();
  const completed = useDownloadsStore((s) => (s.engineRowsById[id] ?? s.itemsById[id])?.status === 'COMPLETED');
  const owned = useDownloadsStore((s) => isEngineOwned(s, id));
  // A rename (Title & artist) changes the row: the item is read again so the dialog shows the new title.
  const rowTitle = useDownloadsStore((s) => (s.engineRowsById[id] ?? s.itemsById[id])?.title ?? null);
  const artist = useMediaArtist(id);
  const runEdit = useRunEdit();
  const [source, setSource] = useState<EditSource | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const available = Boolean(getEditPort()) && completed && owned;

  useEffect(() => {
    const engine = getV2Engine();
    if (!available || !engine) {
      return undefined;
    }
    let live = true;
    engine
      .getLibraryItem(id)
      .then((item) => {
        if (live) {
          setSource(item);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [available, id, rowTitle]);

  const convertActions = useMemo<ActionSheetItem[]>(() => {
    if (!source) {
      return [];
    }
    return (['mp4', 'audio'] as const).map((kind) => {
      const availability = editAvailability(kind, source);
      const label = kind === 'mp4' ? t('mediaEdit.convertMp4') : t('mediaEdit.convertAudio');
      return {
        id: `convert-${kind}`,
        label: availability === 'ok' ? label : `${label} — ${t(AVAILABILITY_KEYS[availability])}`,
        icon: kind === 'mp4' ? 'file-video-outline' : 'music-note-outline',
        onPress: () => {
          setConvertOpen(false);
          if (availability === 'ok') {
            void runEdit(id, kind);
          }
        },
      };
    });
  }, [id, runEdit, source, t]);

  const openTrim = useCallback(() => {
    navigation.push({ pathname: EDIT_TRIM_ROUTE, params: { id } });
  }, [id]);

  if (!available || !source) {
    return null;
  }

  const trimAvailability = editAvailability('trim', source);

  return (
    <Box mt={8} gap={8} testID="download-details-edit">
      <Text variant="label" color="textSecondary" style={{ letterSpacing: 0.5 }}>
        {t('mediaEdit.section')}
      </Text>
      {artist ? (
        <Text variant="bodySmall" testID="download-details-artist">
          {`${t('mediaEdit.artistLabel')}: ${artist}`}
        </Text>
      ) : null}
      <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
        <Button
          title={t('mediaEdit.trim')}
          variant="outline"
          size="small"
          leftIcon="content-cut"
          onPress={openTrim}
          disabled={trimAvailability !== 'ok'}
          accessibilityHint={trimAvailability !== 'ok' ? t(AVAILABILITY_KEYS[trimAvailability]) : undefined}
          testID="download-details-trim"
        />
        <Button
          title={t('mediaEdit.convert')}
          variant="outline"
          size="small"
          leftIcon="swap-horizontal"
          onPress={() => setConvertOpen(true)}
          testID="download-details-convert"
        />
        <Button
          title={t('mediaEdit.tags')}
          variant="outline"
          size="small"
          leftIcon="tag-edit-outline"
          onPress={() => setTagsOpen(true)}
          testID="download-details-tags"
        />
      </Box>
      <Text variant="caption" color="textSecondary">
        {t('mediaEdit.note')}
      </Text>
      <EditJobBanner sourceId={id} />
      <ActionSheetModal
        visible={convertOpen}
        onClose={() => setConvertOpen(false)}
        title={t('mediaEdit.convertTitle')}
        subtitle={t('mediaEdit.convertSubtitle')}
        actions={convertActions}
        testID="download-details-convert-sheet"
      />
      {tagsOpen ? (
        <MediaTagsModal visible id={id} title={source.title} onClose={() => setTagsOpen(false)} />
      ) : null}
    </Box>
  );
});
