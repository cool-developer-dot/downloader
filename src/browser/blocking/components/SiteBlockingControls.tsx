import { memo } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import { Switch } from '@/components/inputs/Switch';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import {
  AUTOPLAY_POLICIES,
  normalizeAutoplay,
  parseAutoplaySites,
  parseSiteList,
  serializeAutoplaySites,
  serializeSiteList,
  withAutoplayForSite,
  type AutoplayPolicy,
} from '../blocking-settings';

export const AUTOPLAY_LABELS: Record<AutoplayPolicy, TranslationKey> = {
  allow: 'browserBlocking.autoplayAllow',
  sound: 'browserBlocking.autoplaySound',
  all: 'browserBlocking.autoplayAll',
};

/**
 * B14 — the lock-icon panel's part: how many requests were blocked on this page (#121), "Allow ads on this site"
 * (#121, shown while the ad or tracker blocker is on) and autoplay for this site (#218). Each change is saved per
 * browser profile; `onChanged` reloads the page so it takes effect.
 */
export const SiteBlockingControls = memo(function SiteBlockingControls({
  site,
  blocked,
  onChanged,
}: {
  site: string;
  blocked: number | null;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const blocking = useSettingsStore((s) => s.adBlocker === true || s.trackerBlocker === true);
  const allowedRaw = useSettingsStore((s) => s.adAllowedSites);
  const autoplaySitesRaw = useSettingsStore((s) => s.autoplaySites);
  const globalAutoplay = normalizeAutoplay(useSettingsStore((s) => s.autoplay));
  const allowed = parseSiteList(allowedRaw);
  const adsAllowed = allowed.includes(site);
  const autoplaySites = parseAutoplaySites(autoplaySitesRaw);
  const ownAutoplay: AutoplayPolicy | null = autoplaySites[site] ?? null;

  const toggleAds = (next: boolean) => {
    update('adAllowedSites', serializeSiteList(next ? [...allowed, site] : allowed.filter((s) => s !== site)));
    onChanged();
  };
  const chooseAutoplay = (policy: AutoplayPolicy | null) => {
    update('autoplaySites', serializeAutoplaySites(withAutoplayForSite(autoplaySites, site, policy)));
    onChanged();
  };

  const choices: { value: AutoplayPolicy | null; label: string }[] = [
    { value: null, label: t('browserBlocking.autoplayDefault', { value: t(AUTOPLAY_LABELS[globalAutoplay]) }) },
    ...AUTOPLAY_POLICIES.map((value) => ({ value, label: t(AUTOPLAY_LABELS[value]) })),
  ];

  return (
    <Box gap={8} testID="browser-site-info-blocking">
      <Divider />
      {blocking ? (
        <>
          <Box row rtlRow gap={12} style={{ alignItems: 'flex-start' }}>
            <Text variant="caption" color="textSecondary" style={{ width: 110, textAlign: rtl.textAlign }}>
              {t('browserBlocking.blockedOnPage')}
            </Text>
            <Text variant="bodySmall" style={{ flex: 1, minWidth: 0, textAlign: rtl.textAlign }} testID="browser-site-info-blocked-count">
              {blocked == null
                ? '…'
                : blocked > 0
                  ? t('browserBlocking.blockedOnPageCount', { count: blocked })
                  : t('browserBlocking.blockedOnPageNone')}
            </Text>
          </Box>
          <Box row rtlRow center gap={12} style={{ minHeight: 56 }}>
            <Box flex={1} style={{ minWidth: 0 }}>
              <Text variant="body" style={{ textAlign: rtl.textAlign }}>
                {t('browserBlocking.allowAdsHere')}
              </Text>
              <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                {t('browserBlocking.allowAdsHereHint')}
              </Text>
            </Box>
            <Switch
              value={adsAllowed}
              onValueChange={toggleAds}
              accessibilityLabel={t('browserBlocking.allowAdsHere')}
              accessibilityHint={t('browserBlocking.allowAdsHereHint')}
              testID="browser-site-info-allow-ads"
            />
          </Box>
        </>
      ) : null}
      <Text variant="body" accessibilityRole="header" style={{ textAlign: rtl.textAlign }}>
        {t('browserBlocking.autoplayHere')}
      </Text>
      <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }} accessibilityRole="radiogroup">
        {choices.map((choice) => {
          const selected = choice.value === ownAutoplay;
          return (
            <Pressable
              key={choice.value ?? 'default'}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={choice.label}
              accessibilityHint={t('browserBlocking.autoplayChangedHint')}
              onPress={() => chooseAutoplay(choice.value)}
              testID={`browser-site-info-autoplay-${choice.value ?? 'default'}`}
              style={[
                styles.chip,
                {
                  borderRadius: theme.radius.md,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primary : 'transparent',
                },
              ]}>
              <Text variant="bodySmall" color={selected ? 'textOnPrimary' : undefined}>
                {choice.label}
              </Text>
            </Pressable>
          );
        })}
      </Box>
    </Box>
  );
});

const styles = StyleSheet.create({
  chip: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
