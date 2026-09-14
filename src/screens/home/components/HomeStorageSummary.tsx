import { memo, useCallback, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Card } from '@/components/cards/Card';
import { Pressable } from '@/components/base/Pressable';
import { Icon } from '@/components/base/Icon';
import { ProgressBar } from '@/components/common/ProgressBar';
import { navigation, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';
import { useHomeLayout } from '../theme/home-layout';

export type HomeStorageSummaryProps = {
  usedLabel: string | null;
  freeLabel: string | null;
  usageRatio: number | null;
  unavailable: boolean;
};

export const HomeStorageSummary = memo(function HomeStorageSummary({
  usedLabel,
  freeLabel,
  usageRatio,
  unavailable,
}: HomeStorageSummaryProps) {
  const layout = useHomeLayout();
  const { t, rtl } = useTranslation();

  const openStorage = useCallback(() => {
    navigation.push(routePaths.storage);
  }, []);

  const description = useMemo(() => {
    if (unavailable) {
      return t('home.storageUnavailable');
    }
    const parts: string[] = [];
    if (usedLabel) {
      parts.push(`${t('home.storageUsed')} ${usedLabel}`);
    }
    if (freeLabel) {
      parts.push(`${t('home.storageFree')} ${freeLabel}`);
    }
    return parts.join(' · ') || t('home.storageUnavailable');
  }, [freeLabel, t, unavailable, usedLabel]);

  return (
    <Box
      px={16}
      testID="home-storage-summary"
      style={{
        paddingTop: layout.sectionTop,
        paddingBottom: layout.storageBottom,
      }}>
      <Pressable
        onPress={openStorage}
        accessibilityRole="button"
        accessibilityLabel={`${t('home.storage')}. ${description}`}
        accessibilityHint={t('home.viewStorageA11y')}
        testID="home-storage-card">
        <Card elevation="sm">
          <Box gap={12}>
            <Box row rtlRow center style={{ justifyContent: 'space-between' }}>
              <Box row rtlRow center gap={8} style={{ minWidth: 0, flex: 1 }}>
                <Icon name="harddisk" size="sm" color="primary" />
                <Text variant="subtitle">{t('home.storage')}</Text>
              </Box>
              <Icon name={rtl.chevronForward} size="sm" color="secondary" />
            </Box>
            <Text variant="bodySmall" color="textSecondary">
              {description}
            </Text>
            {usageRatio != null ? (
              <ProgressBar
                progress={usageRatio}
                style={{ height: layout.progressHeight }}
                accessibilityLabel={t('home.storageUsageA11y', {
                  percent: Math.round(usageRatio * 100),
                })}
              />
            ) : null}
          </Box>
        </Card>
      </Pressable>
    </Box>
  );
});
