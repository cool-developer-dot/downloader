import { memo, useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow } from '@/design';
import { renameMediaFileOnDevice } from '@/downloads/engine';
import { getV2Engine, isEngineOwned, renameEngineLibraryItem } from '@/downloads/v2';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

export type RenameModalProps = {
  visible: boolean;
  id: string;
  onClose: () => void;
};

/**
 * Design 45 → Rename: the same rename as Download details — a native-engine library item by its title (its private
 * file keeps a stable name), a legacy row by its file name.
 */
export const RenameModal = memo(function RenameModal({ visible, id, onClose }: RenameModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const state = useDownloadsStore.getState();
    const item = state.engineRowsById[id] ?? state.itemsById[id];
    setDraft(isEngineOwned(state, id) ? item?.title?.trim() || '' : item?.fileName?.trim() || item?.title?.trim() || '');
    setError(null);
    setBusy(false);
  }, [id, visible]);

  const confirm = useCallback(async () => {
    const next = draft.trim();
    if (!next) {
      setError(t('files.emptyName'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isEngineOwned(useDownloadsStore.getState(), id)) {
        await renameEngineLibraryItem(getV2Engine(), id, next);
      } else {
        await renameMediaFileOnDevice(id, next);
        useDownloadsStore.getState().patchItem(id, { fileName: next, title: next });
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('files.unavailable'));
    } finally {
      setBusy(false);
    }
  }, [draft, id, onClose, t]);

  return (
    <AppModal visible={visible} onClose={busy ? undefined : onClose} title={t('files.renameFile')} subtitle={t('downloads.renameDisplayName')} testID="file-actions-rename-modal">
      <View style={{ gap: 12 }}>
        <TextField
          label={t('downloads.newName')}
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            setError(null);
          }}
          error={error ?? undefined}
          disabled={busy}
          accessibilityLabel={t('downloads.newName')}
          testID="file-actions-rename-field"
        />
        <DsButtonRow>
          <DsButton label={t('common.save')} flex onPress={() => void confirm()} loading={busy} disabled={!draft.trim()} testID="file-actions-rename-save" />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} disabled={busy} testID="file-actions-rename-cancel" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
});
