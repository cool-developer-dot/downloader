import { memo, useMemo, useState } from 'react';

import { Switch } from '@/components/inputs/Switch';
import {
  normalizePreloadPages,
  PRELOAD_PAGES_CHOICES,
  type PreloadPages,
} from '@/browser/preload/preload-policy';
import { normalizeScrollSpeed, SCROLL_SPEEDS, type ScrollSpeed } from '@/browser/scroll/scroll-speed';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';

const SPEED_LABELS: Record<ScrollSpeed, TranslationKey> = {
  slow: 'browserNav.speedSlow',
  normal: 'browserNav.speedNormal',
  fast: 'browserNav.speedFast',
};

const PRELOAD_LABELS: Record<PreloadPages, TranslationKey> = {
  off: 'browserNav.preloadOff',
  wifi: 'browserNav.preloadWifi',
  always: 'browserNav.preloadAlways',
};

/**
 * B6 — Browser settings → Navigation and scrolling: swipe navigation (#45), scroll speed (#53), volume keys (#240)
 * and preload pages (#55).
 */
export const NavigationSettingsSection = memo(function NavigationSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const swipe = useSettingsStore((s) => s.swipeNavigation !== false);
  const speed = normalizeScrollSpeed(useSettingsStore((s) => s.scrollSpeed));
  const volumeKeys = useSettingsStore((s) => s.volumeKeyScroll === true);
  const preload = normalizePreloadPages(useSettingsStore((s) => s.preloadPages));
  const [picker, setPicker] = useState<'speed' | 'preload' | null>(null);

  const speedOptions = useMemo(
    (): ChoiceOption<ScrollSpeed>[] => SCROLL_SPEEDS.map((value) => ({ value, label: t(SPEED_LABELS[value]) })),
    [t],
  );
  const preloadOptions = useMemo(
    (): ChoiceOption<PreloadPages>[] =>
      PRELOAD_PAGES_CHOICES.map((value) => ({
        value,
        label: t(PRELOAD_LABELS[value]),
        description: value === 'off' ? undefined : t('browserNav.preloadSaverNote'),
      })),
    [t],
  );
  const speedLabel = t(SPEED_LABELS[speed]);
  const preloadLabel = t(PRELOAD_LABELS[preload]);

  return (
    <SettingsSection
      testID="browser-settings-navigation"
      title={t('browserNav.section')}
      description={t('browserNav.sectionDescription')}
      icon="gesture-swipe-horizontal">
      <SettingsRow
        title={t('browserNav.swipeNavigation')}
        description={t('browserNav.swipeNavigationHint')}
        icon="gesture-swipe-horizontal"
        trailing={
          <Switch
            value={swipe}
            onValueChange={(next) => update('swipeNavigation', next)}
            accessibilityLabel={t('browserNav.swipeNavigation')}
            accessibilityHint={t('browserNav.swipeNavigationHint')}
            testID="browser-settings-swipe"
          />
        }
      />
      <SettingsRow
        title={t('browserNav.scrollSpeed')}
        description={t('browserNav.scrollSpeedHint')}
        icon="speedometer"
        value={speedLabel}
        onPress={() => setPicker('speed')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserNav.scrollSpeed'), value: speedLabel })}
        testID="browser-settings-scroll-speed"
      />
      <SettingsRow
        title={t('browserNav.volumeKeyScroll')}
        description={t('browserNav.volumeKeyScrollHint')}
        icon="volume-high"
        trailing={
          <Switch
            value={volumeKeys}
            onValueChange={(next) => update('volumeKeyScroll', next)}
            accessibilityLabel={t('browserNav.volumeKeyScroll')}
            accessibilityHint={t('browserNav.volumeKeyScrollHint')}
            testID="browser-settings-volume-keys"
          />
        }
      />
      <SettingsRow
        title={t('browserNav.preloadPages')}
        description={t('browserNav.preloadPagesHint')}
        icon="page-next-outline"
        value={preloadLabel}
        onPress={() => setPicker('preload')}
        showDivider={false}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserNav.preloadPages'), value: preloadLabel })}
        testID="browser-settings-preload"
      />
      <ChoiceSheet
        visible={picker === 'speed'}
        title={t('browserNav.scrollSpeed')}
        options={speedOptions}
        value={speed}
        onSelect={(next) => update('scrollSpeed', next)}
        onClose={() => setPicker(null)}
        testID="browser-settings-speed-sheet"
      />
      <ChoiceSheet
        visible={picker === 'preload'}
        title={t('browserNav.preloadPages')}
        options={preloadOptions}
        value={preload}
        onSelect={(next) => update('preloadPages', next)}
        onClose={() => setPicker(null)}
        testID="browser-settings-preload-sheet"
      />
    </SettingsSection>
  );
});
