import { useCallback, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Share, ToastAndroid } from 'react-native';

import { debugLog, debugLogToText, type DebugLogEntry } from '@/diagnostics/debug-log';
import {
  clearableHistoryIds,
  errorLogToText,
  historyToCsv,
  historyToJson,
  toErrorLog,
  toHistoryRecords,
} from '@/downloads/v2/download-history';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';
import { selectDebugLogs, useSettingsStore } from '@/store/settings';
import { exportFileName, exportTextFile, type TextExportResult } from '@/utils/text-file-export';

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Download history & logs (H13). Reads only the v2 rows the Downloads list shows (never library-only rows, never v1
 * rows). Clearing uses the store's own "Remove from Downloads" path, so finished videos stay in Player.
 */
export function useDownloadHistoryScreen() {
  const { t } = useTranslation();
  const engineRowsById = useDownloadsStore((state) => state.engineRowsById);
  const libraryOnlyIds = useDownloadsStore((state) => state.libraryOnlyIds);
  const debugEnabled = useSettingsStore(selectDebugLogs);
  const [clearConfirmVisible, setClearConfirmVisible] = useState(false);
  const [busy, setBusy] = useState<'clear' | 'json' | 'csv' | null>(null);
  const [debugEntries, setDebugEntries] = useState<readonly DebugLogEntry[] | null>(null);
  const busyRef = useRef(false);

  const rows = useMemo(
    () => Object.entries(engineRowsById).filter(([id]) => !libraryOnlyIds[id]).map(([, item]) => item),
    [engineRowsById, libraryOnlyIds],
  );
  const clearableIds = useMemo(() => clearableHistoryIds(rows), [rows]);
  const errorLog = useMemo(() => toErrorLog(rows, t('downloadHistory.unknownReason')), [rows, t]);

  const run = useCallback(async (kind: 'clear' | 'json' | 'csv', task: () => Promise<void>) => {
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

  const requestClear = useCallback(() => setClearConfirmVisible(true), []);
  const cancelClear = useCallback(() => setClearConfirmVisible(false), []);

  const confirmClear = useCallback(() => {
    setClearConfirmVisible(false);
    const ids = clearableIds;
    void run('clear', async () => {
      let removed = 0;
      for (const id of ids) {
        // The existing "Remove from Downloads": the record goes, a finished video stays in Player.
        if (await useDownloadsStore.getState().remove(id)) {
          removed += 1;
        }
      }
      announce(
        removed === ids.length
          ? t('downloadHistory.cleared')
          : t('downloadHistory.clearedPartly', { removed, total: ids.length }),
      );
    });
  }, [clearableIds, run, t]);

  const announceExport = useCallback(
    (result: TextExportResult) => {
      if (result === 'saved') {
        announce(t('downloadHistory.exportSaved'));
      } else if (result === 'shared') {
        announce(t('downloadHistory.exportShared'));
      } else if (result === 'failed') {
        announce(t('downloadHistory.exportFailed'));
      }
    },
    [t],
  );

  const exportHistory = useCallback(
    (format: 'json' | 'csv') => {
      void run(format, async () => {
        const now = new Date();
        const records = toHistoryRecords(rows);
        const result = await exportTextFile({
          fileName: exportFileName('download-history', format, now),
          mimeType: format === 'json' ? 'application/json' : 'text/csv',
          content: format === 'json' ? historyToJson(records, now) : historyToCsv(records),
          shareTitle: t('downloadHistory.exportTitle'),
        });
        announceExport(result);
      });
    },
    [announceExport, rows, run, t],
  );

  const shareErrorLog = useCallback(() => {
    void Share.share({ message: errorLogToText(errorLog, t('downloadHistory.errorLogTitle')) }).catch(() => {
      announce(t('downloadHistory.exportFailed'));
    });
  }, [errorLog, t]);

  const setDebugEnabled = useCallback((enabled: boolean) => {
    useSettingsStore.getState().updateSetting('debugLogs', enabled);
    setDebugEntries(null);
  }, []);

  const showDebugLog = useCallback(() => setDebugEntries([...debugLog.entries()]), []);

  const shareDebugLog = useCallback(() => {
    const text = debugLogToText(debugLog.entries(), t('downloadHistory.debugLogTitle'));
    void Share.share({ message: text }).catch(() => announce(t('downloadHistory.exportFailed')));
  }, [t]);

  const clearDebugLog = useCallback(() => {
    debugLog.clear();
    setDebugEntries([]);
  }, []);

  return {
    rowCount: rows.length,
    clearableCount: clearableIds.length,
    errorLog,
    busy,
    clearConfirmVisible,
    requestClear,
    cancelClear,
    confirmClear,
    exportHistory,
    shareErrorLog,
    debugEnabled,
    debugEntries,
    setDebugEnabled,
    showDebugLog,
    shareDebugLog,
    clearDebugLog,
  };
}
