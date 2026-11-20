import { memo, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';

import { redirectsFor } from './probe-observations';
import { assessSource, type SourceCheckLevel, type SourceCheckReason, type SourceCheckSignal } from './source-check';

const LEVEL: Record<SourceCheckLevel, { key: TranslationKey; icon: IconName; color: 'success' | 'warning' | 'error' }> = {
  secure: { key: 'sourceCheck.secure', icon: 'shield-check-outline', color: 'success' },
  check: { key: 'sourceCheck.check', icon: 'shield-alert-outline', color: 'warning' },
  'not-secure': { key: 'sourceCheck.notSecure', icon: 'shield-off-outline', color: 'error' },
};

const REASON_KEYS: Record<SourceCheckSignal, TranslationKey> = {
  https: 'sourceCheck.reasonHttps',
  http: 'sourceCheck.reasonHttp',
  downgrade: 'sourceCheck.reasonDowngrade',
  'ip-host': 'sourceCheck.reasonIpHost',
  punycode: 'sourceCheck.reasonPunycode',
  'mixed-script': 'sourceCheck.reasonMixedScript',
  shortener: 'sourceCheck.reasonShortener',
  'file-locker': 'sourceCheck.reasonFileLocker',
  redirects: 'sourceCheck.reasonRedirects',
};

export type SourceCheckBadgeProps = {
  /** The links in the order the download follows them (page or pasted link, media URL, final URL). */
  urls: readonly (string | null | undefined)[];
  testID?: string;
};

/**
 * P8 #514 Source check in the quality sheet: Secure / Check source / Not secure, from the links alone (no lookup).
 * Tapping it lists every reason.
 */
export const SourceCheckBadge = memo(function SourceCheckBadge({ urls, testID = 'source-check-badge' }: SourceCheckBadgeProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const key = urls.join('\n');
  const result = useMemo(
    () => assessSource({ urls, redirects: redirectsFor(urls) }),
    // `urls` is a fresh array each render; its contents decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  if (result.reasons.length === 0) {
    return null;
  }
  const level = LEVEL[result.level];
  const tint = theme.colors[level.color];
  const reasonText = (reason: SourceCheckReason) =>
    t(REASON_KEYS[reason.signal], { host: reason.host ?? '', count: String(reason.count ?? 0) });

  return (
    <Box gap={8} testID={testID}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${t('sourceCheck.title')}: ${t(level.key)}`}
        accessibilityHint={t('sourceCheck.hint')}
        testID={`${testID}-${result.level}`}
        style={{
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: 32,
          paddingHorizontal: 12,
          borderRadius: theme.radius.full,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: tint,
        }}>
        <Icon name={level.icon} size={16} color={level.color} />
        <Text variant="label" style={{ color: tint }}>
          {t(level.key)}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color="secondary" />
      </Pressable>
      {open ? (
        <Box
          gap={6}
          p={12}
          borderRadius="md"
          testID={`${testID}-reasons`}
          style={{
            backgroundColor: theme.colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}>
          {result.reasons.map((reason) => (
            <Box key={`${reason.signal}|${reason.host ?? ''}`} row rtlRow gap={8} style={{ alignItems: 'flex-start' }}>
              <Text variant="caption" color="textSecondary">
                •
              </Text>
              <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
                {reasonText(reason)}
              </Text>
            </Box>
          ))}
          <Text variant="caption" color="textSecondary" style={{ opacity: 0.8 }}>
            {t('sourceCheck.localOnly')}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
