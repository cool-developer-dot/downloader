import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ReactNative from 'react-native';

import { formatFileSize } from '@/media-detection/utils/format';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { canMoveToPrivate, moveLibraryItemToPrivate, privateMoveSource } from '@/private-vault/move-to-private.runtime';
import { isMovingToPrivate } from '@/private-vault/move-to-private';
import { vaultSealedLength } from '@/private-vault/vault-format';
import { getVaultPort } from '@/private-vault/vault-port';
import { useAppLockStore } from '@/security/app-lock';
import { formatUsagePercent } from '@/storage-manager/utils/format-bytes';

export type PrivateMoveDialogState =
  | { kind: 'closed' }
  | { kind: 'needs-app-lock' }
  | { kind: 'confirm'; id: string; title: string; spaceLabel: string | null; inGallery: boolean }
  | { kind: 'moving'; id: string; title: string; percent: string | null };

/** How often the encryption's progress is read while a move runs (memory only on the native side). */
const PROGRESS_POLL_MS = 500;

function announce(message: string): void {
  if (ReactNative.Platform.OS === 'android') {
    ReactNative.ToastAndroid.show(message, ReactNative.ToastAndroid.SHORT);
  }
  ReactNative.AccessibilityInfo.announceForAccessibility(message);
}

/**
 * "Move to Private" (#459) for one screen: the App Lock check, the confirm (with the Gallery note), the move with its
 * progress, and the result. `onMoved` runs after the original is gone (Download details goes back then).
 */
export function usePrivateMove(onMoved?: (id: string) => void) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<PrivateMoveDialogState>({ kind: 'closed' });
  const requestingRef = useRef(false);
  const onMovedRef = useRef(onMoved);

  useEffect(() => {
    onMovedRef.current = onMoved;
  }, [onMoved]);

  const movingId = dialog.kind === 'moving' ? dialog.id : null;

  useEffect(() => {
    const port = getVaultPort();
    if (!movingId || !port) {
      return undefined;
    }
    const timer = setInterval(() => {
      const progress = port.getVaultProgress(movingId);
      const percent = progress && progress.totalBytes > 0 ? formatUsagePercent(progress.bytesDone / progress.totalBytes) : null;
      setDialog((current) => (current.kind === 'moving' && current.id === movingId ? { ...current, percent } : current));
    }, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [movingId]);

  const request = useCallback(
    async (id: string) => {
      if (requestingRef.current || isMovingToPrivate(id) || !canMoveToPrivate(id)) {
        return;
      }
      if (!useAppLockStore.getState().isEnabled) {
        setDialog({ kind: 'needs-app-lock' });
        return;
      }
      requestingRef.current = true;
      try {
        const source = await privateMoveSource(id).catch(() => null);
        if (!source) {
          announce(t('privateVault.moveNotFound'));
          return;
        }
        setDialog({
          kind: 'confirm',
          id,
          title: source.title,
          spaceLabel: formatFileSize(vaultSealedLength(source.sizeBytes)),
          inGallery: Boolean(source.galleryUri),
        });
      } finally {
        requestingRef.current = false;
      }
    },
    [t],
  );

  const confirm = useCallback(async () => {
    if (dialog.kind !== 'confirm') {
      return;
    }
    const { id, title } = dialog;
    setDialog({ kind: 'moving', id, title, percent: null });
    const result = await moveLibraryItemToPrivate(id);
    setDialog({ kind: 'closed' });
    if (result.ok) {
      announce(t('privateVault.moved'));
      onMovedRef.current?.(id);
      return;
    }
    switch (result.reason) {
      case 'app-lock-off':
        setDialog({ kind: 'needs-app-lock' });
        return;
      case 'busy':
        announce(t('privateVault.moveBusy'));
        return;
      case 'not-found':
        announce(t('privateVault.moveNotFound'));
        return;
      case 'original-not-removed':
        announce(result.keptInVault ? t('privateVault.moveKept') : t('privateVault.moveFailed'));
        return;
      default:
        announce(t('privateVault.moveFailed'));
    }
  }, [dialog, t]);

  const cancel = useCallback(() => {
    setDialog((current) => (current.kind === 'moving' ? current : { kind: 'closed' }));
  }, []);

  const setUpAppLock = useCallback(() => {
    setDialog({ kind: 'closed' });
    navigation.push(routePaths.appLockSetup);
  }, []);

  return useMemo(
    () => ({ dialog, request, confirm, cancel, setUpAppLock }),
    [cancel, confirm, dialog, request, setUpAppLock],
  );
}

export type PrivateMoveController = ReturnType<typeof usePrivateMove>;
