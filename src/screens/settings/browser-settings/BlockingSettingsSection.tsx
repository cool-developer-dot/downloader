import { memo, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { Switch } from '@/components/inputs/Switch';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import {
  AUTOPLAY_POLICIES,
  normalizeAutoplay,
  parseAutoplaySites,
  parseSiteList,
  serializeAutoplaySites,
  serializeSiteList,
  siteFromInput,
  withAutoplayForSite,
  type AutoplayPolicy,
} from '@/browser/blocking/blocking-settings';
import { AUTOPLAY_LABELS } from '@/browser/blocking/components/SiteBlockingControls';
import {
  FOCUS_MINUTE_CHOICES,
  TIME_LIMIT_MINUTES,
  isFocusActive,
  normalizeFocusMinutesChoice,
  usedSeconds,
} from '@/browser/blocking/site-limits';
import {
  addSite,
  endFocus,
  removeSite,
  removeTimeLimit,
  setTimeLimit,
  startFocus,
  useSiteClock,
  useSiteLimits,
} from '@/browser/blocking/site-blocking.service';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';

const AUTOPLAY_HINTS: Record<AutoplayPolicy, TranslationKey> = {
  allow: 'browserBlocking.autoplayAllowHint',
  sound: 'browserBlocking.autoplaySoundHint',
  all: 'browserBlocking.autoplayAllHint',
};

type Sheet = 'allowed' | 'autoplay' | 'autoplaySites' | 'blocked' | 'limits' | 'focus' | null;

/** B14 — Browser settings → Ad, tracker and site blocking (per browser profile). */
export const BlockingSettingsSection = memo(function BlockingSettingsSection() {
  const { t, language } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const adBlocker = useSettingsStore((s) => s.adBlocker === true);
  const trackerBlocker = useSettingsStore((s) => s.trackerBlocker === true);
  const allowed = parseSiteList(useSettingsStore((s) => s.adAllowedSites));
  const autoplay = normalizeAutoplay(useSettingsStore((s) => s.autoplay));
  const autoplaySites = parseAutoplaySites(useSettingsStore((s) => s.autoplaySites));
  const dataSaver = useSettingsStore((s) => s.dataSaver === true);
  const limits = useSiteLimits();
  const [sheet, setSheet] = useState<Sheet>(null);
  const now = useSiteClock();
  const focusOn = isFocusActive(limits, now);
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(language === 'ur' ? 'ur-PK' : 'en-GB', { hour: 'numeric', minute: '2-digit' });

  const autoplayOptions = useMemo(
    (): ChoiceOption<AutoplayPolicy>[] =>
      AUTOPLAY_POLICIES.map((value) => ({ value, label: t(AUTOPLAY_LABELS[value]), description: t(AUTOPLAY_HINTS[value]) })),
    [t],
  );
  const count = (n: number) => t('browserBlocking.siteCount', { count: n });

  return (
    <SettingsSection
      testID="browser-settings-blocking"
      title={t('browserBlocking.section')}
      description={t('browserBlocking.sectionDescription')}
      icon="shield-check-outline">
      <SettingsRow
        title={t('browserBlocking.adBlocker')}
        description={t('browserBlocking.adBlockerHint')}
        icon="advertisements-off"
        trailing={
          <Switch
            value={adBlocker}
            onValueChange={(next) => update('adBlocker', next)}
            accessibilityLabel={t('browserBlocking.adBlocker')}
            accessibilityHint={t('browserBlocking.adBlockerHint')}
            testID="browser-settings-ad-blocker"
          />
        }
      />
      <SettingsRow
        title={t('browserBlocking.trackerBlocker')}
        description={t('browserBlocking.trackerBlockerHint')}
        icon="eye-off-outline"
        trailing={
          <Switch
            value={trackerBlocker}
            onValueChange={(next) => update('trackerBlocker', next)}
            accessibilityLabel={t('browserBlocking.trackerBlocker')}
            accessibilityHint={t('browserBlocking.trackerBlockerHint')}
            testID="browser-settings-tracker-blocker"
          />
        }
      />
      <SettingsRow
        title={t('browserBlocking.allowedSites')}
        description={t('browserBlocking.allowedSitesHint')}
        icon="check-decagram-outline"
        value={count(allowed.length)}
        onPress={() => setSheet('allowed')}
        testID="browser-settings-ad-allowed-sites"
      />
      <SettingsRow
        title={t('browserBlocking.autoplay')}
        description={dataSaver ? t('browserBlocking.autoplaySaverNote') : t(AUTOPLAY_HINTS[autoplay])}
        icon="play-circle-outline"
        value={t(AUTOPLAY_LABELS[autoplay])}
        onPress={() => setSheet('autoplay')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserBlocking.autoplay'), value: t(AUTOPLAY_LABELS[autoplay]) })}
        testID="browser-settings-autoplay"
      />
      <SettingsRow
        title={t('browserBlocking.autoplaySites')}
        description={t('browserBlocking.autoplaySitesHint')}
        icon="play-box-multiple-outline"
        value={count(Object.keys(autoplaySites).length)}
        onPress={() => setSheet('autoplaySites')}
        testID="browser-settings-autoplay-sites"
      />
      <SettingsRow
        title={t('browserBlocking.blockedSites')}
        description={t('browserBlocking.blockedSitesHint')}
        icon="cancel"
        value={count(limits.blockedSites.length)}
        onPress={() => setSheet('blocked')}
        testID="browser-settings-blocked-sites"
      />
      <SettingsRow
        title={t('browserBlocking.timeLimits')}
        description={t('browserBlocking.timeLimitsHint')}
        icon="timer-sand"
        value={count(Object.keys(limits.timeLimits).length)}
        onPress={() => setSheet('limits')}
        testID="browser-settings-time-limits"
      />
      <SettingsRow
        title={t('browserBlocking.focus')}
        description={t('browserBlocking.focusHint')}
        icon="target"
        value={focusOn ? t('browserBlocking.focusOn', { time: time(limits.focusEndsAt as number) }) : t('browserBlocking.focusOff')}
        onPress={() => setSheet('focus')}
        showDivider={false}
        testID="browser-settings-focus"
      />
      <ChoiceSheet
        visible={sheet === 'autoplay'}
        title={t('browserBlocking.autoplay')}
        options={autoplayOptions}
        value={autoplay}
        onSelect={(next) => update('autoplay', next)}
        onClose={() => setSheet(null)}
        testID="browser-settings-autoplay-sheet"
      />
      <SiteListSheet
        visible={sheet === 'allowed'}
        title={t('browserBlocking.allowedSites')}
        empty={t('browserBlocking.allowedSitesEmpty')}
        sites={allowed}
        onAdd={(site) => update('adAllowedSites', serializeSiteList([...allowed, site]))}
        onRemove={(site) => update('adAllowedSites', serializeSiteList(allowed.filter((s) => s !== site)))}
        onClose={() => setSheet(null)}
        testID="blocking-allowed-sheet"
      />
      <SiteListSheet
        visible={sheet === 'autoplaySites'}
        title={t('browserBlocking.autoplaySites')}
        empty={t('browserBlocking.autoplaySitesEmpty')}
        sites={Object.keys(autoplaySites)}
        detail={(site) => t(AUTOPLAY_LABELS[autoplaySites[site]])}
        onRemove={(site) => update('autoplaySites', serializeAutoplaySites(withAutoplayForSite(autoplaySites, site, null)))}
        onClose={() => setSheet(null)}
        testID="blocking-autoplay-sites-sheet"
      />
      <SiteListSheet
        visible={sheet === 'blocked'}
        title={t('browserBlocking.blockedSites')}
        empty={t('browserBlocking.blockedSitesEmpty')}
        sites={limits.blockedSites}
        onAdd={(site) => void addSite('blocked', site)}
        onRemove={(site) => void removeSite('blocked', site)}
        onClose={() => setSheet(null)}
        testID="blocking-blocked-sheet"
      />
      <TimeLimitsSheet visible={sheet === 'limits'} onClose={() => setSheet(null)} />
      <FocusSheet visible={sheet === 'focus'} onClose={() => setSheet(null)} />
    </SettingsSection>
  );
});

/** A list of sites with remove buttons, and (with `onAdd`) a field to add one; `extra` goes above the add field. */
const SiteListSheet = memo(function SiteListSheet({
  visible,
  title,
  empty,
  sites,
  detail,
  onAdd,
  onRemove,
  onClose,
  header,
  extraFooter,
  testID,
}: {
  visible: boolean;
  title: string;
  empty: string;
  sites: readonly string[];
  detail?: (site: string) => string;
  onAdd?: (site: string) => void;
  onRemove: (site: string) => void;
  onClose: () => void;
  header?: ReactNode;
  extraFooter?: ReactNode;
  testID: string;
}) {
  const { t, rtl } = useTranslation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();

  const add = () => {
    const site = siteFromInput(draft);
    if (!site) {
      setError(t('browserBlocking.invalidSite'));
      return;
    }
    onAdd?.(site);
    setDraft('');
    setError(undefined);
  };

  return (
    <SheetFrame
      visible={visible}
      title={title}
      onClose={onClose}
      testID={testID}
      footer={
        onAdd ? (
          <View style={{ gap: 12 }}>
            {extraFooter}
            <View style={{ flexDirection: rtl.rowDirection, gap: 12, alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={t('browserBlocking.addSite')}
                  value={draft}
                  onChangeText={(text) => {
                    setDraft(text);
                    setError(undefined);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="done"
                  onSubmitEditing={add}
                  error={error}
                  testID={`${testID}-field`}
                />
              </View>
              <Button title={t('browserBlocking.add')} onPress={add} testID={`${testID}-add`} />
            </View>
          </View>
        ) : undefined
      }>
      {header}
      {sites.length === 0 ? (
        <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {empty}
        </Text>
      ) : (
        <View>
          {sites.map((site) => (
            <View key={site} style={[styles.siteRow, { flexDirection: rtl.rowDirection }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" numberOfLines={1} style={{ writingDirection: 'ltr', textAlign: rtl.textAlign }}>
                  {site}
                </Text>
                {detail ? (
                  <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                    {detail(site)}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserBlocking.removeSiteA11y', { site })}
                onPress={() => onRemove(site)}
                style={styles.remove}
                testID={`${testID}-remove-${site}`}>
                <Icon name="close" size={20} color="secondary" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </SheetFrame>
  );
});

/** A row of choice chips (radio group), at least 48 dp each. */
function Chips<T extends string | number>({
  options,
  value,
  onSelect,
  label,
  testID,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
  label: string;
  testID: string;
}) {
  const theme = useTheme();
  const { rtl } = useTranslation();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
        {label}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', gap: 8 }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={option.label}
              onPress={() => onSelect(option.value)}
              testID={`${testID}-${option.value}`}
              style={[
                styles.chip,
                {
                  borderRadius: theme.radius.md,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primary : 'transparent',
                },
              ]}>
              <Text variant="bodySmall" color={selected ? 'textOnPrimary' : undefined}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** B14 #277: sites with minutes a day, today's time used; add with a chosen number of minutes. */
const TimeLimitsSheet = memo(function TimeLimitsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const limits = useSiteLimits();
  const [minutes, setMinutes] = useState<number>(30);
  const now = useSiteClock();
  const sites = Object.keys(limits.timeLimits);
  const detail = (site: string) => {
    const limit = limits.timeLimits[site];
    const used = Math.floor(usedSeconds(limits, site, now) / 60);
    return used >= limit
      ? `${t('browserBlocking.limitMinutes', { minutes: limit })} · ${t('browserBlocking.limitUsedUp')}`
      : t('browserBlocking.limitUsed', { used, minutes: limit });
  };
  return (
    <SiteListSheet
      visible={visible}
      title={t('browserBlocking.timeLimits')}
      empty={t('browserBlocking.timeLimitsEmpty')}
      sites={sites}
      detail={detail}
      onAdd={(site) => void setTimeLimit(site, minutes)}
      onRemove={(site) => void removeTimeLimit(site)}
      onClose={onClose}
      extraFooter={
        <Chips
          options={TIME_LIMIT_MINUTES.map((value) => ({ value, label: t('browserBlocking.focusMinutes', { minutes: value }) }))}
          value={minutes}
          onSelect={setMinutes}
          label={t('browserBlocking.chooseMinutes')}
          testID="blocking-limit-minutes"
        />
      }
      testID="blocking-limits-sheet"
    />
  );
});

/** B14 #278: the timer (start / end), and the distracting sites it blocks. */
const FocusSheet = memo(function FocusSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, language, rtl } = useTranslation();
  const limits = useSiteLimits();
  const update = useSettingsStore((s) => s.updateSetting);
  const chosen = normalizeFocusMinutesChoice(useSettingsStore((s) => s.focusMinutes));
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [needsSites, setNeedsSites] = useState(false);
  const focusOn = isFocusActive(limits, useSiteClock());
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(language === 'ur' ? 'ur-PK' : 'en-GB', { hour: 'numeric', minute: '2-digit' });

  const start = () => {
    if (limits.focusSites.length === 0) {
      setNeedsSites(true);
      return;
    }
    setNeedsSites(false);
    void startFocus(Number(chosen));
  };

  const header = (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <Text variant="label" accessibilityLiveRegion="polite" style={{ textAlign: rtl.textAlign }} testID="blocking-focus-status">
        {focusOn ? t('browserBlocking.focusOn', { time: time(limits.focusEndsAt as number) }) : t('browserBlocking.focusOff')}
      </Text>
      {focusOn ? (
        <Button title={t('browserBlocking.focusEnd')} variant="outline" onPress={() => setConfirmEnd(true)} testID="blocking-focus-end" />
      ) : (
        <>
          <Chips
            options={FOCUS_MINUTE_CHOICES.map((value) => ({ value, label: t('browserBlocking.focusMinutes', { minutes: value }) }))}
            value={chosen}
            onSelect={(value) => update('focusMinutes', value)}
            label={t('browserBlocking.focusDuration')}
            testID="blocking-focus-minutes"
          />
          <Button title={t('browserBlocking.focusStart')} onPress={start} testID="blocking-focus-start" />
          {needsSites ? (
            <Text variant="caption" color="error" accessibilityRole="alert" style={{ textAlign: rtl.textAlign }}>
              {t('browserBlocking.focusNeedsSites')}
            </Text>
          ) : null}
        </>
      )}
      <Text variant="label" accessibilityRole="header" style={{ textAlign: rtl.textAlign }}>
        {t('browserBlocking.focusSites')}
      </Text>
    </View>
  );

  return (
    <>
      <SiteListSheet
        visible={visible && !confirmEnd}
        title={t('browserBlocking.focus')}
        empty={t('browserBlocking.focusSitesEmpty')}
        sites={limits.focusSites}
        header={header}
        onAdd={(site) => {
          setNeedsSites(false);
          void addSite('focus', site);
        }}
        onRemove={(site) => void removeSite('focus', site)}
        onClose={onClose}
        testID="blocking-focus-sheet"
      />
      <ConfirmModal
        visible={visible && confirmEnd}
        variant="warning"
        title={t('browserBlocking.focusEndTitle')}
        message={t('browserBlocking.focusEndMessage')}
        confirmLabel={t('browserBlocking.focusEnd')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setConfirmEnd(false);
          void endFocus();
        }}
        onCancel={() => setConfirmEnd(false)}
        testID="blocking-focus-end-confirm"
      />
    </>
  );
});

const styles = StyleSheet.create({
  siteRow: { alignItems: 'center', minHeight: 48, gap: 8 },
  remove: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
