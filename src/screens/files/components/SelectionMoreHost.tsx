import { memo, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsText } from '@/design';
import { useFolderColorsStore } from '@/files/organize/organize-stores';
import type { SwatchId } from '@/files/organize/swatches';
import { tagAddedForms } from '@/files/ui/count-wordings';
import { cleanTag, tagProblem } from '@/library/item-organize';
import { useItemTagsStore, useTagColorsStore } from '@/library/item-organize-store';
import { createStore } from '@/store/shared/create-store';
import { translatePlural, useTranslation } from '@/localization';

import { announce } from '../announce';
import { SwatchPicker } from './SwatchPicker';

type Pending = { kind: 'tag' | 'color'; fileIds: string[]; folderIds: string[]; done: () => void } | null;

/** Files F7: which More ⋮ dialog is open, for which selection. */
export const useSelectionMoreStore = createStore<{ pending: Pending }>()(() => ({ pending: null }));

export function openSelectionDialog(pending: NonNullable<Pending>): void {
  useSelectionMoreStore.setState({ pending });
}

/**
 * Files F7: the selection bar's More ⋮ → Tag (one tag, with its colour, on every selected file) and Color (the colour
 * of every selected folder's icon). Hide needs no dialog.
 */
export const SelectionMoreHost = memo(function SelectionMoreHost() {
  const pending = useSelectionMoreStore((state) => state.pending);
  return pending ? <MoreDialog key={`${pending.kind}:${pending.fileIds.join(',')}:${pending.folderIds.join(',')}`} pending={pending} /> : null;
});

function MoreDialog({ pending }: { pending: NonNullable<Pending> }) {
  const { t, language } = useTranslation();
  const [tag, setTag] = useState('');
  const [color, setColor] = useState<SwatchId | null>(null);
  const close = () => useSelectionMoreStore.setState({ pending: null });

  if (pending.kind === 'color') {
    return (
      <AppModal visible onClose={close} title={t('fileManager.folderColorTitle')} showCloseButton testID="files-more-color">
        <SwatchPicker
          value={null}
          onChange={(value) => {
            useFolderColorsStore.getState().setColor(pending.folderIds, value);
            close();
            pending.done();
          }}
        />
      </AppModal>
    );
  }

  const problem = tag.trim() ? tagProblem([], tag) : null;
  return (
    <AppModal visible onClose={close} title={t('fileManager.addTag')} showCloseButton testID="files-more-tag">
      <View style={{ gap: 12 }}>
        <TextField label={t('fileManager.tagName')} value={tag} onChangeText={setTag} autoFocus testID="files-more-tag-input" />
        <SwatchPicker value={color} onChange={setColor} size={26} />
        {problem ? (
          <DsText variant="rowSub" color="error">
            {problem === 'too-long' ? t('fileManager.problemTooLong') : t('fileManager.problemEmpty')}
          </DsText>
        ) : null}
        <DsButton
          label={t('fileManager.addTag')}
          disabled={!tag.trim() || problem !== null}
          onPress={() => {
            const clean = cleanTag(tag);
            for (const id of pending.fileIds) {
              useItemTagsStore.getState().addTag(id, clean);
            }
            if (color) useTagColorsStore.getState().setColor(clean, color);
            announce(translatePlural(pending.fileIds.length, tagAddedForms, { tag: clean }, language));
            close();
            pending.done();
          }}
          fullWidth
          testID="files-more-tag-add"
        />
      </View>
    </AppModal>
  );
}
