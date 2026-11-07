import { memo, useCallback, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { useTranslation } from '@/localization';
import { SettingsRow } from '@/screens/settings/components';
import { historyRepository } from '@/storage/repositories';
import { useHistoryStore } from '@/store/history';

import { planHistorySeed } from './history-seed';

const SEED_COUNT = 5_000;

/**
 * B10 debug builds only: adds 5,000 old history entries (Browser settings → History). `HistorySettingsSection`
 * requires this file behind `__DEV__`, so release bundles don't contain it.
 */
export const HistorySeedRow = memo(function HistorySeedRow() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const seed = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await historyRepository.createMany(planHistorySeed(SEED_COUNT, Date.now()));
      void useHistoryStore.getState().load(1);
      const message = t('browserHistory.debugSeedDone', { count: created.length });
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      AccessibilityInfo.announceForAccessibility(message);
    } catch {
      // Debug aid only.
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  return (
    <SettingsRow
      title={t('browserHistory.debugSeed')}
      description={t('browserHistory.debugSeedHint')}
      icon="bug-outline"
      onPress={busy ? undefined : () => void seed()}
      testID="browser-settings-history-seed"
    />
  );
});
