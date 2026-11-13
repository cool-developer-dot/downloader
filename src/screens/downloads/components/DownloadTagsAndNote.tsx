import { memo, useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { MAX_NOTE_LENGTH, cleanNote } from '@/library/item-organize';
import { useItemNotesStore } from '@/library/item-organize-store';
import { useTranslation } from '@/localization';
import { ItemTagsEditor } from '@/screens/library/components/ItemTagsEditor';
import { useDownloadsStore } from '@/store/downloads';

export type DownloadTagsAndNoteProps = {
  id: string;
};

/**
 * Download Details → Tags (#387) and Note (#495), for a completed download only. Both are kept on this device and go
 * with the item when it is deleted.
 */
export const DownloadTagsAndNote = memo(function DownloadTagsAndNote({ id }: DownloadTagsAndNoteProps) {
  const { t } = useTranslation();
  const completed = useDownloadsStore((s) => (s.engineRowsById[id] ?? s.itemsById[id])?.status === 'COMPLETED');
  const saved = useItemNotesStore((s) => s.notesById[id] ?? '');
  const [draft, setDraft] = useState(saved);

  // Another screen (or a delete) changed the note: show what is stored.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const dirty = cleanNote(draft) !== saved;

  const save = useCallback(() => {
    useItemNotesStore.getState().setNote(id, draft);
    AccessibilityInfo.announceForAccessibility(t('organize.noteSaved'));
  }, [draft, id, t]);

  if (!completed) {
    return null;
  }

  return (
    <Box mt={8} gap={12} testID="download-details-organize">
      <Box gap={6}>
        <Text variant="label" color="textSecondary" style={{ letterSpacing: 0.5 }}>
          {t('organize.tags')}
        </Text>
        <ItemTagsEditor id={id} testID="download-details-tags-editor" />
      </Box>
      <Box gap={6}>
        <Text variant="label" color="textSecondary" style={{ letterSpacing: 0.5 }}>
          {t('organize.note')}
        </Text>
        <TextField
          value={draft}
          onChangeText={(value) => setDraft(value.slice(0, MAX_NOTE_LENGTH))}
          placeholder={t('organize.notePlaceholder')}
          multiline
          maxLength={MAX_NOTE_LENGTH}
          helperText={t('organize.noteCount', { count: String(draft.length), max: String(MAX_NOTE_LENGTH) })}
          accessibilityLabel={t('organize.note')}
          testID="download-details-note"
        />
        <Box row rtlRow gap={8}>
          <Button
            title={t('organize.saveNote')}
            size="small"
            onPress={save}
            disabled={!dirty}
            testID="download-details-note-save"
          />
          {saved ? (
            <Button
              title={t('organize.clearNote')}
              variant="ghost"
              size="small"
              onPress={() => {
                setDraft('');
                useItemNotesStore.getState().setNote(id, '');
              }}
              testID="download-details-note-clear"
            />
          ) : null}
        </Box>
      </Box>
    </Box>
  );
});
