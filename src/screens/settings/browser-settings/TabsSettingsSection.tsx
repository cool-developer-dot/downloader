import { memo, useEffect, useMemo, useState } from 'react';

import { getVidoraWeb, isVidoraWebAvailable, type AppMemoryInfo } from '@modules/vidorax-web';
import { useBrowserStore } from '@/browser/stores';
import {
  normalizeTabSleepAfter,
  TAB_SLEEP_CHOICES,
  tabWakeCounts,
  type TabSleepAfter,
} from '@/browser/tab-sound/tab-sleep';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';

const SLEEP_LABELS: Record<TabSleepAfter, TranslationKey> = {
  off: 'browserTabSound.sleepOff',
  '15m': 'browserTabSound.sleep15m',
  '30m': 'browserTabSound.sleep30m',
  '1h': 'browserTabSound.sleep1h',
  '3h': 'browserTabSound.sleep3h',
};

const MEMORY_POLL_MS = 5_000;

/** Reads the app's memory now and every 5 s while shown (VidoraWeb `getAppMemory`); null on older native builds. */
function useAppMemory(): AppMemoryInfo | null {
  const [memory, setMemory] = useState<AppMemoryInfo | null>(null);
  useEffect(() => {
    if (!isVidoraWebAvailable()) return undefined;
    const web = getVidoraWeb();
    if (!web.getAppMemory) return undefined;
    let cancelled = false;
    const read = () => {
      web
        .getAppMemory?.()
        .then((value) => {
          if (!cancelled) setMemory(value);
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, MEMORY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return memory;
}

/** B3 — Browser settings → Tabs: Sleep unused tabs (#15) and the memory monitor (#190). */
export const TabsSettingsSection = memo(function TabsSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const sleep = normalizeTabSleepAfter(useSettingsStore((s) => s.tabSleepAfter));
  const tabIds = useBrowserStore((s) => s.tabs.map((tab) => tab.id).join(','));
  const mounted = useBrowserStore((s) => s.mountedTabIds.join(','));
  const counts = useMemo(() => {
    const ids = tabIds ? tabIds.split(',') : [];
    return tabWakeCounts(ids.length, mounted ? mounted.split(',') : [], ids);
  }, [mounted, tabIds]);
  const memory = useAppMemory();
  const [picker, setPicker] = useState(false);

  const options = useMemo(
    (): ChoiceOption<TabSleepAfter>[] => TAB_SLEEP_CHOICES.map((value) => ({ value, label: t(SLEEP_LABELS[value]) })),
    [t],
  );
  const sleepLabel = t(SLEEP_LABELS[sleep]);
  const memoryValue = memory
    ? t('browserTabSound.memoryValue', {
        used: Math.round(memory.totalPssKb / 1024),
        awake: counts.awake,
        asleep: counts.asleep,
      })
    : t('browserTabSound.memoryUnavailable', { awake: counts.awake, asleep: counts.asleep });

  return (
    <SettingsSection
      testID="browser-settings-tabs"
      title={t('browserTabSound.section')}
      description={t('browserTabSound.sectionDescription')}
      icon="tab">
      <SettingsRow
        title={t('browserTabSound.sleep')}
        description={t('browserTabSound.sleepHint')}
        icon="sleep"
        value={sleepLabel}
        onPress={() => setPicker(true)}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserTabSound.sleep'), value: sleepLabel })}
        testID="browser-settings-tab-sleep"
      />
      <SettingsRow
        title={t('browserTabSound.memory')}
        description={
          memory?.lowMemory ? `${t('browserTabSound.memoryLow')}. ${t('browserTabSound.memoryHint')}` : t('browserTabSound.memoryHint')
        }
        icon="memory"
        value={memoryValue}
        showDivider={false}
        testID="browser-settings-memory"
      />
      <ChoiceSheet
        visible={picker}
        title={t('browserTabSound.sleep')}
        options={options}
        value={sleep}
        onSelect={(next) => update('tabSleepAfter', next)}
        onClose={() => setPicker(false)}
        testID="browser-settings-tab-sleep-sheet"
      />
    </SettingsSection>
  );
});
