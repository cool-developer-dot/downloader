import { memo, useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsText } from '@/design';
import type { ClashChoice } from '@/files/rename/name-clash';
import { useTranslation } from '@/localization';
import { PrivateCheckbox } from '@/screens/private/PrivateCheckbox';

export type ClashAnswer = { choice: ClashChoice; forAll: boolean };

type Pending = { name: string; folder: string; batch: boolean };

/**
 * Files F5 · #797: asks what to do when a rename or a move would give a folder two files of the same name. `ask`
 * resolves with Keep both, Replace or Skip; in a batch, "Do this for all" makes the answer stick for every later clash.
 */
export function useNameClash() {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolveRef = useRef<((answer: ClashAnswer) => void) | null>(null);

  const ask = useCallback(
    (name: string, folder: string, batch: boolean) =>
      new Promise<ClashAnswer>((resolve) => {
        resolveRef.current = resolve;
        setPending({ name, folder, batch });
      }),
    [],
  );

  const answer = useCallback((choice: ClashChoice, forAll: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.({ choice, forAll });
  }, []);

  return { ask, dialogProps: { pending, onAnswer: answer } };
}

export type NameClashDialogProps = {
  pending: Pending | null;
  onAnswer: (choice: ClashChoice, forAll: boolean) => void;
};

export const NameClashDialog = memo(function NameClashDialog({ pending, onAnswer }: NameClashDialogProps) {
  const { t } = useTranslation();
  const [forAll, setForAll] = useState(false);
  const choose = (choice: ClashChoice) => {
    const all = forAll;
    setForAll(false);
    onAnswer(choice, all);
  };
  return (
    <AppModal visible={pending !== null} onClose={() => choose('skip')} title={t('fileManager.clashTitle')} showCloseButton testID="files-name-clash">
      {pending ? (
        <View style={{ gap: 12 }}>
          <DsText variant="body">{t('fileManager.clashMessage', { name: pending.name, folder: pending.folder })}</DsText>
          <DsText variant="rowSub">{t('fileManager.clashReplaceNote')}</DsText>
          {pending.batch ? (
            <PrivateCheckbox checked={forAll} onToggle={() => setForAll((value) => !value)} label={t('fileManager.clashForAll')} testID="files-name-clash-all" />
          ) : null}
          <DsButton label={t('fileManager.clashKeepBoth')} onPress={() => choose('keep-both')} fullWidth testID="files-name-clash-keep" />
          <DsButton label={t('fileManager.clashReplace')} variant="secondary" onPress={() => choose('replace')} fullWidth testID="files-name-clash-replace" />
          <DsButton label={t('fileManager.clashSkip')} variant="secondary" onPress={() => choose('skip')} fullWidth testID="files-name-clash-skip" />
        </View>
      ) : null}
    </AppModal>
  );
});
