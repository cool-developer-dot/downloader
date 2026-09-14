import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Card } from '@/components/cards/Card';
import { useTranslation, type TranslationKey } from '@/localization';
import type { StorageLocation } from '@/storage-manager';
import { formatBytesLabel } from '@/storage-manager';

const LOCATION_ICONS: Record<StorageLocation['type'], string> = {
  downloads: 'movie-open-outline',
  images: 'image-outline',
  cache: 'cached',
  documents: 'folder-outline',
  temp: 'timer-sand',
};

export type StorageLocationCardProps = {
  location: StorageLocation;
  testID?: string;
};

export const StorageLocationCard = memo(function StorageLocationCard({
  location,
  testID,
}: StorageLocationCardProps) {
  const { t } = useTranslation();
  const titleKey = `storage.locations.${location.label}` as TranslationKey;
  const descriptionKey = `storage.locations.${location.description}` as TranslationKey;
  const title = t(titleKey);
  const description = t(descriptionKey);
  const visibilityLabel =
    location.visibility === 'user-visible'
      ? t('storage.userVisible')
      : t('storage.appPrivate');

  return (
    <Card elevation="sm" padding={12} testID={testID ?? `storage-location-${location.id}`}>
      <Box gap={8}>
        <Box row rtlRow gap={10} style={{ alignItems: 'flex-start' }}>
          <Box style={{ paddingTop: 2 }}>
            <Icon
              name={LOCATION_ICONS[location.type]}
              size="sm"
              color="primary"
            />
          </Box>
          <Box flex={1} gap={4} style={{ minWidth: 0 }}>
            <Box row rtlRow center style={{ justifyContent: 'space-between', gap: 8 }}>
              <Text variant="bodySmall" style={{ fontWeight: '600', flex: 1 }}>
                {title}
              </Text>
              {location.sizeBytes != null ? (
                <Text variant="caption" color="textSecondary">
                  {formatBytesLabel(location.sizeBytes) ?? t('storage.zeroBytes')}
                </Text>
              ) : null}
            </Box>
            <Text variant="caption" color="textSecondary" selectable>
              {location.path}
            </Text>
            <Text variant="caption" color="textSecondary">
              {description}
            </Text>
            <Text variant="caption" color="primary">
              {location.exists
                ? visibilityLabel
                : t('storage.createdWhenNeeded')}
            </Text>
          </Box>
        </Box>
      </Box>
    </Card>
  );
});
