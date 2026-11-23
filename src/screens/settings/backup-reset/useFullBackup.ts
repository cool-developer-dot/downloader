import { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { showAppDialog } from '@/components/modals/app-dialog';
import { useTranslation } from '@/localization';
import { backupPreview, type AppBackup, type BackupPreview } from '@/backup/backup-format';
import type { RestoreMode } from '@/backup/backup-restore';
import { exportAppBackup, pickAppBackup, restoreAppBackup } from '@/backup/backup.service';

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.LONG);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

export type PendingRestore = { backup: AppBackup; preview: BackupPreview };

/**
 * P11 #700 Settings → Backup & reset → "Back up all data" and "Restore from backup". Restore: the file is read and
 * shown first (its sections and counts), the user picks Merge or Replace, confirms, and only then is anything written.
 * A file from a newer VidoraX is refused and says so.
 */
export function useFullBackup() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'export' | 'import' | 'restore' | null>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(async (kind: 'export' | 'import' | 'restore', task: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(kind);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, []);

  const exportAll = useCallback(() => {
    void run('export', async () => {
      try {
        const result = await exportAppBackup(t('privacyBackup.backupShareTitle'));
        if (result === 'saved') {
          announce(t('privacyBackup.backupSaved'));
        } else if (result === 'shared') {
          announce(t('privacyBackup.backupShared'));
        } else if (result === 'failed') {
          announce(t('privacyBackup.backupFailed'));
        }
      } catch {
        announce(t('privacyBackup.backupFailed'));
      }
    });
  }, [run, t]);

  const pickRestore = useCallback(() => {
    void run('import', async () => {
      const picked = await pickAppBackup().catch(() => ({ status: 'failed' as const }));
      switch (picked.status) {
        case 'picked':
          setPending({ backup: picked.backup, preview: backupPreview(picked.backup) });
          return;
        case 'cancelled':
          return;
        case 'newer-version':
          announce(t('privacyBackup.restoreNewer'));
          return;
        case 'browser-backup':
          announce(t('privacyBackup.restoreBrowserBackup'));
          return;
        case 'too-large':
          announce(t('privacyBackup.restoreTooLarge'));
          return;
        case 'not-backup':
          announce(t('privacyBackup.restoreNotBackup'));
          return;
        default:
          announce(t('privacyBackup.restoreFailed'));
      }
    });
  }, [run, t]);

  const cancelRestore = useCallback(() => setPending(null), []);

  const chooseMode = useCallback(
    (mode: RestoreMode) => {
      const current = pending;
      if (!current) {
        return;
      }
      setPending(null);
      void run('restore', async () => {
        const confirmed = await showAppDialog({
          title: t(mode === 'replace' ? 'privacyBackup.confirmReplaceTitle' : 'privacyBackup.confirmMergeTitle'),
          message: t(mode === 'replace' ? 'privacyBackup.confirmReplaceMessage' : 'privacyBackup.confirmMergeMessage'),
          confirmLabel: t(mode === 'replace' ? 'privacyBackup.replace' : 'privacyBackup.merge'),
          cancelLabel: t('common.cancel'),
          variant: mode === 'replace' ? 'error' : 'warning',
        });
        if (!confirmed) {
          return;
        }
        try {
          await restoreAppBackup(current.backup, mode);
          announce(t('privacyBackup.restored'));
        } catch {
          announce(t('privacyBackup.restoreFailed'));
        }
      });
    },
    [pending, run, t],
  );

  return { busy, pending, exportAll, pickRestore, cancelRestore, chooseMode };
}
