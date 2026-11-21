import { memo, useCallback, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ToastAndroid, View } from 'react-native';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { DsButton, DsButtonRow, DsCard, DsHeader, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';

import { normalizeAutoplay } from '../blocking-settings';
import { isFocusActive, normalizeFocusMinutesChoice } from '../site-limits';
import { endFocus, startFocus, useSiteClock, useSiteLimits } from '../site-blocking.service';
import { BlockedSitesSheet, FocusEditSheet, TimeLimitsSheet } from './FocusSheets';

type Sheet = 'blocked' | 'limits' | 'edit' | 'confirmEnd' | null;

function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "25:00" — minutes (not capped at 59) and seconds. */
export function formatFocusClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}

function subscribeEverySecond(listener: () => void): () => void {
  const timer = setInterval(listener, 1_000);
  return () => clearInterval(timer);
}
function subscribeNever(): () => void {
  return () => undefined;
}
const wholeSecondsNow = () => Math.floor(Date.now() / 1_000);

/** The time now (ms), refreshed every second while `running` (the focus countdown); the service's clock otherwise. */
function useCountdownClock(running: boolean): number {
  'use no memo';
  const serviceNow = useSiteClock();
  const seconds = useSyncExternalStore(running ? subscribeEverySecond : subscribeNever, wholeSecondsNow, wholeSecondsNow);
  return running ? Math.max(seconds * 1_000, serviceNow) : serviceNow;
}

/**
 * Design 37 "Focus & site blocker" — the focus timer (B14 #278), the site blocker (#276), daily time limits (#277)
 * and autoplay blocking (#218), as the design's card, buttons and rows.
 */
export const FocusScreen = memo(function FocusScreen() {
  const { t } = useTranslation();
  const limits = useSiteLimits();
  const update = useSettingsStore((s) => s.updateSetting);
  const chosen = normalizeFocusMinutesChoice(useSettingsStore((s) => s.focusMinutes));
  const autoplay = normalizeAutoplay(useSettingsStore((s) => s.autoplay));
  const serviceNow = useSiteClock();
  const focusOn = isFocusActive(limits, serviceNow);
  const now = useCountdownClock(focusOn);
  const remaining = focusOn && limits.focusEndsAt != null ? (limits.focusEndsAt - now) / 1000 : Number(chosen) * 60;
  const clock = formatFocusClock(remaining);

  const [sheet, setSheet] = useState<Sheet>(null);
  const close = () => setSheet(null);
  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);

  const start = () => {
    if (limits.focusSites.length === 0) {
      toast(t('browserBlocking.focusNeedsSites'));
      setSheet('edit');
      return;
    }
    void startFocus(Number(chosen));
  };

  const blockedCount = limits.focusSites.length;
  const summary = blockedCount === 1 ? t('lightFocus.sessionOne') : t('lightFocus.sessionMany', { count: blockedCount });

  const limitSites = Object.keys(limits.timeLimits);
  const leastMinutes = limitSites.reduce((least, site) => Math.min(least, limits.timeLimits[site]), Number.POSITIVE_INFINITY);
  const limitSubtitle =
    limitSites.length === 0
      ? t('lightFocus.none')
      : limitSites.length === 1
        ? t('lightFocus.limitPerDay', { minutes: leastMinutes })
        : t('lightFocus.limitSites', { minutes: leastMinutes, count: limitSites.length });

  return (
    <DsScreen testID="focus-screen">
      <DsHeader
        title={t('lightFocus.title')}
        subtitle={t('lightFocus.subtitle')}
        action={{ icon: 'settings', accessibilityLabel: t('lightFocus.settingsA11y'), onPress: openSettings, testID: 'focus-settings' }}
      />
      <DsCard testID="focus-timer-card">
        <View style={{ alignItems: 'center', gap: 4, paddingVertical: 12 }}>
          <DsText variant="hero" align="center" accessibilityLiveRegion="polite" accessibilityLabel={t('lightFocus.timerA11y', { time: clock })} testID="focus-clock">
            {clock}
          </DsText>
          <DsText variant="body" align="center" testID="focus-summary">
            {summary}
          </DsText>
        </View>
      </DsCard>
      <DsButtonRow>
        <DsButton
          flex
          variant="primary"
          label={focusOn ? t('lightFocus.stopFocus') : t('lightFocus.startFocus')}
          onPress={focusOn ? () => setSheet('confirmEnd') : start}
          testID="focus-start"
        />
        <DsButton flex variant="secondary" label={t('lightFocus.edit')} onPress={() => setSheet('edit')} testID="focus-edit" />
      </DsButtonRow>
      <DsRowGroup testID="focus-rows">
        <DsRow
          icon="ban"
          title={t('lightFocus.siteBlocker')}
          subtitle={limits.blockedSites.length ? limits.blockedSites.join(', ') : t('lightFocus.none')}
          onPress={() => setSheet('blocked')}
          testID="focus-site-blocker"
        />
        <DsRow icon="clock" title={t('lightFocus.timeLimit')} subtitle={limitSubtitle} onPress={() => setSheet('limits')} testID="focus-time-limit" />
        <DsRow
          icon="ban"
          title={t('lightFocus.blockAutoplay')}
          toggle={{ value: autoplay === 'all', onValueChange: (next) => update('autoplay', next ? 'all' : 'sound') }}
          testID="focus-block-autoplay"
        />
        <DsRow
          icon="moon"
          title={t('lightFocus.quietDownloads')}
          toggle={{ value: false, onValueChange: () => toast(t('common.notAvailableYet')) }}
          testID="focus-quiet-downloads"
        />
      </DsRowGroup>

      <BlockedSitesSheet visible={sheet === 'blocked'} onClose={close} />
      <TimeLimitsSheet visible={sheet === 'limits'} onClose={close} />
      <FocusEditSheet visible={sheet === 'edit'} onClose={close} />
      <ConfirmModal
        visible={sheet === 'confirmEnd'}
        variant="warning"
        title={t('browserBlocking.focusEndTitle')}
        message={t('browserBlocking.focusEndMessage')}
        confirmLabel={t('lightFocus.stopFocus')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          close();
          void endFocus();
        }}
        onCancel={close}
        testID="focus-end-confirm"
      />
    </DsScreen>
  );
});
