import { memo, useCallback, useState, type ComponentType } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { Switch } from '@/components/inputs/Switch';
import { ClearBrowsingDataSheet } from '@/browser/history/components/ClearBrowsingDataSheet';
import { exportHistoryToFile } from '@/browser/history/history-export.service';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

// Debug builds only: in a release bundle `__DEV__` is false, so Metro drops this branch and the module with it.
const HistorySeedRow: ComponentType | null = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('@/browser/history/debug/HistorySeedRow') as { HistorySeedRow: ComponentType }).HistorySeedRow
  : null;

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * B10 — Browser settings → History: Save history (#101), Clear history on exit (#99), Clear browsing data (#98) and
 * Export history (#103).
 */
export const HistorySettingsSection = memo(function HistorySettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const saveHistory = useSettingsStore((s) => s.saveHistory !== false);
  const clearOnExit = useSettingsStore((s) => s.clearHistoryOnExit === true);
  const [clearVisible, setClearVisible] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const outcome = await exportHistoryToFile();
      if (outcome === 'empty') notify(t('browserHistory.exportEmpty'));
      else if (outcome === 'saved' || outcome === 'shared') notify(t('browserHistory.exportSaved'));
      else if (outcome === 'failed') notify(t('browserHistory.exportFailed'));
    } catch {
      notify(t('browserHistory.exportFailed'));
    } finally {
      setExporting(false);
    }
  }, [exporting, t]);

  return (
    <SettingsSection
      testID="browser-settings-history"
      title={t('browserHistory.section')}
      description={t('browserHistory.sectionDescription')}
      icon="history">
      <SettingsRow
        title={t('browserHistory.saveHistory')}
        description={t('browserHistory.saveHistoryHint')}
        icon="history"
        trailing={
          <Switch
            value={saveHistory}
            onValueChange={(next) => update('saveHistory', next)}
            accessibilityLabel={t('browserHistory.saveHistory')}
            accessibilityHint={t('browserHistory.saveHistoryHint')}
            testID="browser-settings-save-history"
          />
        }
      />
      <SettingsRow
        title={t('browserHistory.clearOnExit')}
        description={t('browserHistory.clearOnExitHint')}
        icon="exit-run"
        trailing={
          <Switch
            value={clearOnExit}
            onValueChange={(next) => update('clearHistoryOnExit', next)}
            accessibilityLabel={t('browserHistory.clearOnExit')}
            accessibilityHint={t('browserHistory.clearOnExitHint')}
            testID="browser-settings-clear-on-exit"
          />
        }
      />
      <SettingsRow
        title={t('browserHistory.clearData')}
        description={t('browserHistory.clearDataHint')}
        icon="delete-clock-outline"
        onPress={() => setClearVisible(true)}
        accessibilityHint={t('browserHistory.clearDataA11y')}
        testID="browser-settings-clear-data"
      />
      <SettingsRow
        title={t('browserHistory.exportHistory')}
        description={t('browserHistory.exportHistoryHint')}
        icon="file-export-outline"
        onPress={exporting ? undefined : () => void handleExport()}
        showDivider={HistorySeedRow != null}
        accessibilityHint={t('browserHistory.exportA11y')}
        testID="browser-settings-export-history"
      />
      {HistorySeedRow ? <HistorySeedRow /> : null}
      <ClearBrowsingDataSheet visible={clearVisible} onClose={() => setClearVisible(false)} />
    </SettingsSection>
  );
});
