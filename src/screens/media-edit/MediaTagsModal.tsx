import { memo, useCallback, useRef, useState } from 'react';
import * as ReactNative from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { renameEngineLibraryItem } from '@/downloads/v2';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { useTranslation } from '@/localization';
import { MAX_ARTIST_LENGTH, normalizeArtist } from '@/media-edit/media-tags';
import { useMediaTagsStore } from '@/media-edit/media-tags-store';

export type MediaTagsModalProps = {
  visible: boolean;
  id: string;
  title: string;
  onClose: () => void;
};

const MAX_TITLE_INPUT = 200;

function announce(message: string): void {
  if (ReactNative.Platform.OS === 'android') {
    ReactNative.ToastAndroid.show(message, ReactNative.ToastAndroid.SHORT);
  }
  ReactNative.AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Metadata Tagging (#375): title and artist. The title is the library title (the existing rename); the artist is an
 * app-level tag. The file itself is never rewritten for tags.
 */
export const MediaTagsModal = memo(function MediaTagsModal({ visible, id, title, onClose }: MediaTagsModalProps) {
  const { t } = useTranslation();
  const savedArtist = useMediaTagsStore((s) => s.artists[id] ?? '');
  const [titleDraft, setTitleDraft] = useState(title);
  const [artistDraft, setArtistDraft] = useState(savedArtist);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const save = useCallback(async () => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const nextTitle = titleDraft.trim();
      if (nextTitle && nextTitle !== title.trim()) {
        await renameEngineLibraryItem(getV2Engine(), id, nextTitle);
      }
      useMediaTagsStore.getState().setArtist(id, normalizeArtist(artistDraft));
      announce(t('mediaEdit.tagsSaved'));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t('mediaEdit.failed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [artistDraft, id, onClose, t, title, titleDraft]);

  return (
    <AppModal visible={visible} onClose={saving ? undefined : onClose} title={t('mediaEdit.tagsTitle')} testID="media-tags">
      <Box gap={12}>
        <TextField
          label={t('mediaEdit.titleField')}
          value={titleDraft}
          onChangeText={setTitleDraft}
          maxLength={MAX_TITLE_INPUT}
          disabled={saving}
          testID="media-tags-title"
        />
        <TextField
          label={t('mediaEdit.artistField')}
          value={artistDraft}
          onChangeText={setArtistDraft}
          maxLength={MAX_ARTIST_LENGTH}
          disabled={saving}
          error={error ?? undefined}
          testID="media-tags-artist"
        />
        <Text variant="caption" color="textSecondary">
          {t('mediaEdit.tagsHint')}
        </Text>
        <Box row rtlRow gap={12}>
          <Box flex={1}>
            <Button title={t('common.cancel')} variant="outline" onPress={onClose} disabled={saving} fullWidth />
          </Box>
          <Box flex={1}>
            <Button
              title={t('common.save')}
              onPress={() => {
                void save();
              }}
              loading={saving}
              fullWidth
              testID="media-tags-save"
            />
          </Box>
        </Box>
      </Box>
    </AppModal>
  );
});
