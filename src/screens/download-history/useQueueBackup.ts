import { useCallback, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { ensureV2LibraryHydrated } from '@/downloads/v2';
import { useImportedQueueStore, type ImportedQueueEntry } from '@/downloads/v2/imported-queue-store';
import {
  parseQueueBackup,
  planQueueImport,
  queueBackupItems,
  queueToJson,
  type QueueImportPlan,
} from '@/downloads/v2/queue-backup';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';
import { exportFileName, exportTextFile, importTextFile } from '@/utils/text-file-export';

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

export type QueueImportSummary = QueueImportPlan & { fileError: string | null };

/**
 * Queue backup (#462, #502, #503) over the v2 rows. Import never touches the engine: restored items are pages the
 * user reopens in the browser, where detection and the engine's duplicate check run as for any page.
 */
export function useQueueBackup() {
  const { t } = useTranslation();
  const engineRowsById = useDownloadsStore((state) => state.engineRowsById);
  const libraryOnlyIds = useDownloadsStore((state) => state.libraryOnlyIds);
  const entries = useImportedQueueStore((state) => state.entries);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [summary, setSummary] = useState<QueueImportSummary | null>(null);
  const busyRef = useRef(false);

  const queueRows = useMemo(
    () => Object.entries(engineRowsById).filter(([id]) => !libraryOnlyIds[id]).map(([, item]) => item),
    [engineRowsById, libraryOnlyIds],
  );
  const exportable = useMemo(() => queueBackupItems(queueRows), [queueRows]);

  const run = useCallback(async (kind: 'export' | 'import', task: () => Promise<void>) => {
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

  const exportQueue = useCallback(() => {
    void run('export', async () => {
      const now = new Date();
      const result = await exportTextFile({
        fileName: exportFileName('download-queue', 'json', now),
        mimeType: 'application/json',
        content: queueToJson(exportable.items, now),
        shareTitle: t('queueBackup.exportTitle'),
      });
      if (result === 'saved') {
        announce(t('queueBackup.exportSaved'));
      } else if (result === 'shared') {
        announce(t('queueBackup.exportShared'));
      } else if (result === 'failed') {
        announce(t('downloadHistory.exportFailed'));
      }
    });
  }, [exportable.items, run, t]);

  const importQueue = useCallback(() => {
    void run('import', async () => {
      const picked = await importTextFile(['application/json', 'text/plain', 'application/octet-stream']);
      if (picked.status === 'cancelled') {
        return;
      }
      if (picked.status !== 'picked') {
        const reason = picked.status === 'too-large' ? t('queueBackup.fileTooLarge') : t('queueBackup.fileUnreadable');
        setSummary({ added: [], duplicates: 0, refused: 0, invalid: 0, fileError: reason });
        return;
      }
      const parsed = parseQueueBackup(picked.text);
      if (!parsed.ok) {
        const reason =
          parsed.reason === 'unsupported-version'
            ? t('queueBackup.fileNewerVersion')
            : parsed.reason === 'too-many'
              ? t('queueBackup.fileTooLarge')
              : t('queueBackup.fileNotBackup');
        setSummary({ added: [], duplicates: 0, refused: 0, invalid: 0, fileError: reason });
        return;
      }
      // Library items reach the downloads store only once loaded (a few seconds after launch, or the Player tab):
      // load them first, so a video already saved is counted as a duplicate here, not added.
      await ensureV2LibraryHydrated().catch(() => undefined);
      // Every page the user already has — downloads of any state and library items — plus pages already restored.
      const existing = [
        ...Object.values(useDownloadsStore.getState().engineRowsById).map((item) => item.sourceUrl),
        ...useImportedQueueStore.getState().entries.map((entry) => entry.pageUrl),
      ];
      const plan = planQueueImport(parsed.items, existing);
      useImportedQueueStore.getState().add(plan.added);
      setSummary({ ...plan, fileError: null });
    });
  }, [run, t]);

  const openEntry = useCallback((entry: ImportedQueueEntry) => {
    // The normal add path: the page opens in the browser like a History entry; the video is offered and
    // downloaded only after detection and the engine's own checks.
    pendingNavigationService.set(entry.pageUrl, { targetTabId: useBrowserStore.getState().activeTabId });
    useImportedQueueStore.getState().markOpened(entry.key);
    navigation.navigate(routePaths.browser);
  }, []);

  const removeEntry = useCallback((key: string) => useImportedQueueStore.getState().remove(key), []);
  const clearEntries = useCallback(() => useImportedQueueStore.getState().clear(), []);
  const dismissSummary = useCallback(() => setSummary(null), []);

  return {
    exportCount: exportable.items.length,
    withoutPage: exportable.withoutPage,
    entries,
    busy,
    summary,
    exportQueue,
    importQueue,
    openEntry,
    removeEntry,
    clearEntries,
    dismissSummary,
  };
}
