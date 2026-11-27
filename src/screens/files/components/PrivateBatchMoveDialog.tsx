import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsText } from '@/design';
import { fileBytes } from '@/files/ui/file-fields';
import type { FileEntry } from '@/files/ui/files-index';
import { formatFileSize } from '@/media-detection/utils/format';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { moveLibraryItemToPrivate } from '@/private-vault/move-to-private.runtime';
import { vaultSealedLength } from '@/private-vault/vault-format';
import { usePrivateVaultPrefs } from '@/private-vault/vault-prefs-store';
import { useAppLockStore } from '@/security/app-lock';
import { PrivateCheckbox } from '@/screens/private/PrivateCheckbox';

import { announce } from '../announce';

export type PrivateBatchMoveDialogProps = {
  /** The files to move; null when closed. */
  files: readonly FileEntry[] | null;
  onClose: () => void;
  /** After the moves. */
  onDone: () => void;
};

/**
 * Files F4: Move to Private for a selection — one confirm for the batch (the very first move still needs "I
 * understand"), then each file through the existing move (`moveLibraryItemToPrivate`: encrypt, remove the original
 * through the app's delete path, forget its history), one after another. Without App Lock it offers the setup.
 */
export const PrivateBatchMoveDialog = memo(function PrivateBatchMoveDialog({ files, onClose, onDone }: PrivateBatchMoveDialogProps) {
  const { t } = useTranslation();
  const acknowledged = usePrivateVaultPrefs((s) => s.dataLossAcknowledged);
  const appLockEnabled = useAppLockStore((s) => s.isEnabled);
  const [understood, setUnderstood] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const count = files?.length ?? 0;
  const space = formatFileSize((files ?? []).reduce((sum, file) => sum + vaultSealedLength(fileBytes(file)), 0)) ?? '';

  const close = useCallback(() => {
    if (progress) return;
    setUnderstood(false);
    onClose();
  }, [onClose, progress]);

  const move = useCallback(async () => {
    if (!files) return;
    const prefs = usePrivateVaultPrefs.getState();
    if (!prefs.dataLossAcknowledged) {
      if (!understood) return;
      prefs.acknowledgeDataLoss();
    }
    let moved = 0;
    for (let index = 0; index < files.length; index += 1) {
      setProgress({ done: index + 1, total: files.length });
      const result = await moveLibraryItemToPrivate(files[index]!.id).catch(() => ({ ok: false as const }));
      if (result.ok) moved += 1;
    }
    setProgress(null);
    setUnderstood(false);
    if (moved > 0) announce(t('privateVault.moved'));
    if (moved < files.length) announce(t('fileManager.moveFailed', { count: files.length - moved }));
    onDone();
  }, [files, onDone, t, understood]);

  return (
    <AppModal visible={files !== null} onClose={close} title={t('privateVault.moveTitle')} showCloseButton={!progress} testID="files-private-batch">
      {!appLockEnabled ? (
        <View style={{ gap: 12 }}>
          <DsText variant="body">{t('privateVault.needsAppLockMessage')}</DsText>
          <DsButton
            label={t('privateVault.setUpAppLock')}
            onPress={() => {
              close();
              navigation.push(routePaths.appLockSetup);
            }}
            fullWidth
          />
        </View>
      ) : progress ? (
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
          <ActivityIndicator />
          <DsText variant="body" accessibilityLiveRegion="polite">
            {t('fileManager.privateQueue', { count: progress.total - progress.done + 1 })}
          </DsText>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <DsText variant="body">{t('privateVault.moveMessage', { title: t('fileManager.selectedCount', { count }), size: space })}</DsText>
          <DsText variant="body">{t('privateVault.dataLossCompact')}</DsText>
          {acknowledged ? null : (
            <PrivateCheckbox checked={understood} onToggle={() => setUnderstood((value) => !value)} label={t('privateVault.dataLossAcknowledge')} />
          )}
          <DsButtonRow>
            <DsButton label={t('common.cancel')} variant="secondary" onPress={close} flex />
            <DsButton label={t('privateVault.moveConfirm')} onPress={() => void move()} disabled={!acknowledged && !understood} flex testID="files-private-batch-move" />
          </DsButtonRow>
        </View>
      )}
    </AppModal>
  );
});
