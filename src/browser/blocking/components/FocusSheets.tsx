import { memo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { siteFromInput } from '../blocking-settings';
import { FOCUS_MINUTE_CHOICES, TIME_LIMIT_MINUTES, normalizeFocusMinutesChoice, usedSeconds } from '../site-limits';
import { addSite, removeSite, removeTimeLimit, setTimeLimit, useSiteClock, useSiteLimits } from '../site-blocking.service';

/**
 * Light theme · Focus mode (design 37) — the sheets its rows and Edit button open, over B14's site blocking service:
 * the site blocker list, the daily time limits and the focus editor (timer length, distracting sites). The same
 * sheets as Browser settings' blocking section, kept here so the screen owns what it shows.
 */

/** A list of sites with remove buttons, and (with `onAdd`) a field to add one; `extraFooter` goes above the field. */
export const SiteListSheet = memo(function SiteListSheet({
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

/** The site blocker (#276): sites that never open. */
export const BlockedSitesSheet = memo(function BlockedSitesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const limits = useSiteLimits();
  return (
    <SiteListSheet
      visible={visible}
      title={t('lightFocus.siteBlocker')}
      empty={t('browserBlocking.blockedSitesEmpty')}
      sites={limits.blockedSites}
      onAdd={(site) => void addSite('blocked', site)}
      onRemove={(site) => void removeSite('blocked', site)}
      onClose={onClose}
      testID="focus-blocked-sheet"
    />
  );
});

/** Daily time limits (#277): sites with minutes a day and today's time used; add with a chosen number of minutes. */
export const TimeLimitsSheet = memo(function TimeLimitsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
      title={t('lightFocus.timeLimit')}
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
          testID="focus-limit-minutes"
        />
      }
      testID="focus-limits-sheet"
    />
  );
});

/** The focus editor (#278): how long a session lasts, and the distracting sites it blocks. */
export const FocusEditSheet = memo(function FocusEditSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, rtl } = useTranslation();
  const limits = useSiteLimits();
  const update = useSettingsStore((s) => s.updateSetting);
  const chosen = normalizeFocusMinutesChoice(useSettingsStore((s) => s.focusMinutes));

  const header = (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <Chips
        options={FOCUS_MINUTE_CHOICES.map((value) => ({ value, label: t('browserBlocking.focusMinutes', { minutes: value }) }))}
        value={chosen}
        onSelect={(value) => update('focusMinutes', value)}
        label={t('browserBlocking.focusDuration')}
        testID="focus-edit-minutes"
      />
      <Text variant="label" accessibilityRole="header" style={{ textAlign: rtl.textAlign }}>
        {t('browserBlocking.focusSites')}
      </Text>
    </View>
  );

  return (
    <SiteListSheet
      visible={visible}
      title={t('lightFocus.title')}
      empty={t('browserBlocking.focusSitesEmpty')}
      sites={limits.focusSites}
      header={header}
      onAdd={(site) => void addSite('focus', site)}
      onRemove={(site) => void removeSite('focus', site)}
      onClose={onClose}
      testID="focus-edit-sheet"
    />
  );
});

const styles = StyleSheet.create({
  siteRow: { alignItems: 'center', minHeight: 48, gap: 8 },
  remove: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 48, minWidth: 48, paddingHorizontal: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
