import { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import type { DefaultTab } from '@/navigation/helpers/default-tab';
import { useTranslation } from '@/localization';
import { selectDefaultTab, useSettingsStore, type SettingsKey, type SettingsState } from '@/store/settings';
import { parseSettingsBackup, settingsBackupJson } from '@/store/settings/backup';
import { initialSettingsState } from '@/store/settings/state';
import { exportFileName, exportTextFile, importTextFile } from '@/utils/text-file-export';

function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

function currentSettings(): SettingsState {
  const state = useSettingsStore.getState();
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(initialSettingsState)) {
    values[key] = (state as unknown as Record<string, unknown>)[key];
  }
  return values as unknown as SettingsState;
}

/** Default Tab (#474), Reset Settings (#470) and Settings Backup (#471). Only `SettingsState` is ever touched. */
export function useSettingsBackupReset() {
  const { t } = useTranslation();
  const defaultTab = useSettingsStore(selectDefaultTab);
  const [tabSheetVisible, setTabSheetVisible] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const busyRef = useRef(false);

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

  const setDefaultTab = useCallback((tab: DefaultTab) => {
    useSettingsStore.getState().updateSetting('defaultTab', tab);
    setTabSheetVisible(false);
  }, []);

  const exportSettings = useCallback(() => {
    void run('export', async () => {
      const now = new Date();
      const result = await exportTextFile({
        fileName: exportFileName('settings', 'json', now),
        mimeType: 'application/json',
        content: settingsBackupJson(currentSettings() as unknown as Record<string, unknown>, initialSettingsState as unknown as Record<string, unknown>, now),
        shareTitle: t('settingsBackup.exportTitle'),
      });
      if (result === 'saved') {
        announce(t('settingsBackup.exportSaved'));
      } else if (result === 'shared') {
        announce(t('settingsBackup.exportShared'));
      } else if (result === 'failed') {
        announce(t('settingsBackup.failed'));
      }
    });
  }, [run, t]);

  const importSettings = useCallback(() => {
    void run('import', async () => {
      const picked = await importTextFile(['application/json', 'text/plain', 'application/octet-stream']);
      if (picked.status === 'cancelled') {
        return;
      }
      if (picked.status !== 'picked') {
        announce(t('settingsBackup.failed'));
        return;
      }
      const parsed = parseSettingsBackup(picked.text, initialSettingsState as unknown as Record<string, unknown>);
      if (!parsed.ok) {
        announce(parsed.reason === 'unsupported-version' ? t('settingsBackup.newerVersion') : t('settingsBackup.notBackup'));
        return;
      }
      // The store's own validation (its persist merge) decides every value, exactly as when settings load.
      const store = useSettingsStore.getState();
      const current = currentSettings();
      const merge = useSettingsStore.persist.getOptions().merge;
      const merged = (merge ? merge(parsed.values, store) : { ...store, ...parsed.values }) as unknown as Record<string, unknown>;
      let applied = 0;
      for (const key of Object.keys(parsed.values) as SettingsKey[]) {
        const next = merged[key];
        if (next !== (current as unknown as Record<string, unknown>)[key]) {
          // Through updateSetting, so the preference mirrors and the download engine follow as for a manual change.
          store.updateSetting(key, next as never);
          applied += 1;
        }
      }
      announce(
        parsed.ignored.length > 0
          ? t('settingsBackup.importedSome', { applied, ignored: parsed.ignored.length })
          : t('settingsBackup.imported', { applied }),
      );
    });
  }, [run, t]);

  const requestReset = useCallback(() => setResetConfirmVisible(true), []);
  const cancelReset = useCallback(() => setResetConfirmVisible(false), []);
  const confirmReset = useCallback(() => {
    setResetConfirmVisible(false);
    // The store's own reset: SettingsState and its preference mirrors only.
    useSettingsStore.getState().reset();
    announce(t('settingsBackup.resetDone'));
  }, [t]);

  return {
    defaultTab,
    tabSheetVisible,
    openTabSheet: () => setTabSheetVisible(true),
    closeTabSheet: () => setTabSheetVisible(false),
    setDefaultTab,
    busy,
    exportSettings,
    importSettings,
    resetConfirmVisible,
    requestReset,
    cancelReset,
    confirmReset,
  };
}
