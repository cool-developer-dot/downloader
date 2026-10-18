import { memo, useCallback, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { AppModal } from '@/components/modals/AppModal';
import { useDuplicatePromptStore, type DuplicateChoice } from '@/downloads/v2/duplicate-choice';
import { createStore } from '@/store/shared/create-store';
import { useTranslation } from '@/localization';
import { ItemTagsEditor } from '@/screens/library/components/ItemTagsEditor';

/** Player → long-press → Tags (#387): which saved video's tags are being edited. */
export const useTagEditorStore = createStore<{ id: string | null; title: string }>()(() => ({ id: null, title: '' }));

export function openTagEditor(id: string, title: string): void {
  useTagEditorStore.setState({ id, title });
}

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

/** H12 (#386, Ask): "Already downloaded" with Skip, Keep both and Replace. */
const DuplicatePromptDialog = memo(function DuplicatePromptDialog() {
  const { t } = useTranslation();
  const prompt = useDuplicatePromptStore((s) => s.prompt);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => useDuplicatePromptStore.setState({ prompt: null }), []);

  const choose = useCallback(
    (choice: DuplicateChoice) => {
      const current = useDuplicatePromptStore.getState().prompt;
      if (!current || busy) {
        return;
      }
      if (choice === 'skip') {
        close();
        return;
      }
      setBusy(true);
      void current
        .choose(choice)
        .then((result) => {
          if (result?.ok && !result.deduped) {
            announce(choice === 'replace' ? t('duplicates.replacing') : t('duplicates.keepingBoth'));
          } else if (result && !result.ok) {
            announce(t('duplicates.failed'));
          }
        })
        .catch(() => announce(t('duplicates.failed')))
        .finally(() => {
          setBusy(false);
          if (useDuplicatePromptStore.getState().prompt === current) {
            close();
          }
        });
    },
    [busy, close, t],
  );

  return (
    <AppModal
      visible={prompt !== null}
      onClose={busy ? undefined : close}
      title={t('duplicates.promptTitle')}
      testID="duplicate-prompt">
      <Box gap={12}>
        <Text variant="body" numberOfLines={3}>
          {t('duplicates.promptMessage', { title: prompt?.title ?? '' })}
        </Text>
        <Text variant="caption" color="textSecondary">
          {t('duplicates.replaceHint')}
        </Text>
        <Box gap={8}>
          <Button title={t('duplicates.keepBoth')} onPress={() => choose('keep_both')} loading={busy} fullWidth testID="duplicate-prompt-keep-both" />
          <Button
            title={t('duplicates.replace')}
            variant="outline"
            onPress={() => choose('replace')}
            disabled={busy}
            fullWidth
            testID="duplicate-prompt-replace"
          />
          <Button
            title={t('duplicates.skip')}
            variant="ghost"
            onPress={() => choose('skip')}
            disabled={busy}
            fullWidth
            testID="duplicate-prompt-skip"
          />
        </Box>
      </Box>
    </AppModal>
  );
});

/** Player → long-press → Tags (#387). */
const TagEditorModal = memo(function TagEditorModal() {
  const { t } = useTranslation();
  const id = useTagEditorStore((s) => s.id);
  const title = useTagEditorStore((s) => s.title);
  const close = useCallback(() => useTagEditorStore.setState({ id: null, title: '' }), []);

  return (
    <AppModal visible={id !== null} onClose={close} title={t('organize.tags')} subtitle={title} testID="tag-editor">
      <Box gap={12}>
        {id ? <ItemTagsEditor id={id} testID="tag-editor-tags" /> : null}
        <Button title={t('common.done')} onPress={close} fullWidth testID="tag-editor-done" />
      </Box>
    </AppModal>
  );
});

/** H12's app-wide dialogs: the duplicate choice and the Player's tag editor. */
export const OrganizeHosts = memo(function OrganizeHosts() {
  return (
    <>
      <DuplicatePromptDialog />
      <TagEditorModal />
    </>
  );
});
