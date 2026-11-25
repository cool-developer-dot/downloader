import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton } from '@/design';
import { createFolder, type FolderEntry } from '@/files/ui/files-source';
import { useTranslation } from '@/localization';

export type NewFolderDialogProps = {
  visible: boolean;
  onClose: () => void;
  onCreated?: (folder: FolderEntry) => void;
  testID?: string;
};

/**
 * Files F1: "New folder" — the same flow as Download details → Manage folders → New folder (the folder store's
 * `createFolder`, its words and its empty-name check), through the F12 door.
 */
export const NewFolderDialog = memo(function NewFolderDialog({ visible, onClose, onCreated, testID = 'files-new-folder' }: NewFolderDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    setDraft('');
    setError(null);
    onClose();
  }, [busy, onClose]);

  const create = useCallback(async () => {
    if (!draft.trim()) {
      setError(t('files.emptyFolderName'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const folder = await createFolder(draft);
      setDraft('');
      onCreated?.(folder);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.unexpected'));
    } finally {
      setBusy(false);
    }
  }, [draft, onClose, onCreated, t]);

  return (
    <AppModal visible={visible} onClose={close} title={t('downloads.newFolder')} showCloseButton testID={testID}>
      <View style={{ gap: 12 }}>
        <TextField
          label={t('downloads.folderName')}
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            setError(null);
          }}
          error={error ?? undefined}
          disabled={busy}
          autoFocus
          onSubmitEditing={() => void create()}
          returnKeyType="done"
          testID={`${testID}-name`}
        />
        <DsButton
          label={t('common.create')}
          onPress={() => void create()}
          loading={busy}
          disabled={!draft.trim() || busy}
          fullWidth
          testID={`${testID}-create`}
        />
      </View>
    </AppModal>
  );
});
