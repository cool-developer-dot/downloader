import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsText } from '@/design';
import { ILLEGAL_NAME_CHARACTERS, nameProblem, splitExtension, type RenameProblem } from '@/files/rename/batch-rename';
import { findClash, keepBothName } from '@/files/rename/name-clash';
import { deleteForReplace, renameFileTo } from '@/files/rename/rename-runtime';
import { fileLabel } from '@/files/ui/file-fields';
import { folderPath, listFolder, type FileEntry } from '@/files/ui/files-source';
import { useTranslation, type TranslationKey } from '@/localization';

import { announce } from '../announce';
import { NameClashDialog, useNameClash } from './NameClashDialog';

export const PROBLEM_KEYS: Record<RenameProblem, TranslationKey> = {
  empty: 'fileManager.problemEmpty',
  'too-long': 'fileManager.problemTooLong',
  'illegal-characters': 'fileManager.problemIllegal',
  duplicate: 'fileManager.problemDuplicate',
};

export type RenameFileDialogProps = {
  file: FileEntry | null;
  onClose: () => void;
  onRenamed?: () => void;
};

/**
 * Files F5 · #785 Rename: one file's new name. The field starts with the name selected without its extension, and the
 * extension is kept. A name another file in the same folder already has asks Keep both, Replace or Skip.
 */
export const RenameFileDialog = memo(function RenameFileDialog({ file, onClose, onRenamed }: RenameFileDialogProps) {
  const { t } = useTranslation();
  const clash = useNameClash();
  return (
    <>
      <AppModal visible={file !== null} onClose={onClose} title={t('files.renameFile')} showCloseButton testID="files-rename">
        {file ? <RenameBody key={file.id} file={file} onClose={onClose} onRenamed={onRenamed} ask={clash.ask} /> : null}
      </AppModal>
      <NameClashDialog {...clash.dialogProps} />
    </>
  );
});

function RenameBody({
  file,
  onClose,
  onRenamed,
  ask,
}: {
  file: FileEntry;
  onClose: () => void;
  onRenamed?: () => void;
  ask: ReturnType<typeof useNameClash>['ask'];
}) {
  const { t } = useTranslation();
  const [base, extension] = splitExtension(fileLabel(file));
  const [draft, setDraft] = useState(base);
  // Selected without the extension at first; the user's own selection afterwards.
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>({ start: 0, end: base.length });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(async () => {
    let next = `${draft.trim()}${extension}`;
    const problem = nameProblem(next, draft.trim());
    if (problem) {
      setError(t(PROBLEM_KEYS[problem], { characters: ILLEGAL_NAME_CHARACTERS.join(' ') }));
      return;
    }
    if (next === fileLabel(file)) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const listing = await listFolder(file.folderId);
      const others = listing.files.filter((other) => other.id !== file.id);
      const clashing = findClash(next, others.map((other) => fileLabel(other)));
      if (clashing) {
        const path = file.folderId ? await folderPath(file.folderId) : [];
        const answer = await ask(next, path[path.length - 1]?.name ?? t('filesTab.title'), false);
        if (answer.choice === 'skip') {
          onClose();
          return;
        }
        if (answer.choice === 'keep-both') {
          next = keepBothName(next, others.map((other) => fileLabel(other)));
        } else {
          const victim = others.find((other) => fileLabel(other).toLocaleLowerCase() === clashing.toLocaleLowerCase());
          if (victim) await deleteForReplace(victim.id);
        }
      }
      await renameFileTo(file.id, next);
      announce(t('fileManager.renamedOne'));
      onRenamed?.();
      onClose();
    } catch {
      // Never the engine's own English text: "Couldn't be renamed", translated.
      setError(t('fileManager.reasonFailed'));
    } finally {
      setBusy(false);
    }
  }, [ask, draft, extension, file, onClose, onRenamed, t]);

  return (
    <View style={{ gap: 12 }}>
      <TextField
        label={t('files.renameFile')}
        value={draft}
        onChangeText={(value) => {
          setDraft(value);
          setError(null);
        }}
        selection={selection}
        onSelectionChange={() => setSelection(undefined)}
        autoFocus
        error={error ?? undefined}
        disabled={busy}
        onSubmitEditing={() => void save()}
        trailing={extension ? <DsText variant="rowSub">{extension}</DsText> : undefined}
        testID="files-rename-input"
      />
      <DsButton label={t('common.rename')} onPress={() => void save()} loading={busy} disabled={busy || !draft.trim()} fullWidth testID="files-rename-save" />
    </View>
  );
}
