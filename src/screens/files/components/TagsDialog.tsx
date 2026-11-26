import { memo } from 'react';
import { ScrollView, View } from 'react-native';

import { AppModal } from '@/components/modals/AppModal';
import { DsText } from '@/design';
import { tagColorOf } from '@/files/organize/tag-colors';
import type { FileEntry } from '@/files/ui/files-index';
import { useItemTagsStore, useTagColorsStore } from '@/library/item-organize-store';
import { useTranslation } from '@/localization';
import { ItemTagsEditor } from '@/screens/library/components/ItemTagsEditor';

import { SwatchPicker } from './SwatchPicker';

export type TagsDialogProps = { file: FileEntry | null; onClose: () => void };

/**
 * Files F7 · #939 Tags, #977 Color tags: a file's tags (the existing tags editor, `useItemTagsStore`) and a colour for
 * each of them. A tag's colour is the same on every file.
 */
export const TagsDialog = memo(function TagsDialog({ file, onClose }: TagsDialogProps) {
  const { t } = useTranslation();
  const tags = useItemTagsStore((s) => (file ? (s.tagsById[file.id] ?? []) : []));
  const colors = useTagColorsStore((s) => s.colors);
  return (
    <AppModal visible={file !== null} onClose={onClose} title={file ? t('fileManager.tagsTitle', { name: file.name }) : undefined} showCloseButton testID="files-tags">
      {file ? (
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 14 }}>
          <ItemTagsEditor id={file.id} />
          {tags.map((tag) => (
            <View key={tag} style={{ gap: 6 }}>
              <DsText variant="bodyStrong">{tag}</DsText>
              <SwatchPicker value={tagColorOf(colors, tag)} onChange={(color) => useTagColorsStore.getState().setColor(tag, color)} size={26} testID={`files-tag-color-${tag}`} />
            </View>
          ))}
        </ScrollView>
      ) : null}
    </AppModal>
  );
});
