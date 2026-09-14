import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import type { OmniboxSuggestion, SuggestionKind } from '@/browser/suggestions';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { useTranslation } from '@/localization';
import { formatHistoryRelativeTime } from '@/screens/history/utils/history-format';
import { useTheme } from '@/hooks/use-theme';
import { primaryAlphas } from '@/theme';

import { HighlightedText } from './HighlightedText';

export type SuggestionItemProps = {
  item: OmniboxSuggestion;
  onPress: (item: OmniboxSuggestion) => void;
  testID?: string;
};

function kindMeta(kind: SuggestionKind): {
  icon: IconName;
  badge: string;
  badgeColor: 'primary' | 'textSecondary' | 'success';
} {
  switch (kind) {
    case 'bookmark':
      return { icon: 'bookmark', badge: 'Bookmark', badgeColor: 'primary' };
    case 'history':
      return { icon: 'history', badge: 'History', badgeColor: 'textSecondary' };
    case 'frequent':
      return { icon: 'chart-line', badge: 'Frequent', badgeColor: 'success' };
    case 'domain':
      return { icon: 'web', badge: 'Site', badgeColor: 'textSecondary' };
    case 'recent_search':
      return { icon: 'magnify', badge: 'Recent', badgeColor: 'textSecondary' };
    case 'search':
      return { icon: 'magnify', badge: 'Search', badgeColor: 'primary' };
    case 'exact_url':
      return { icon: 'arrow-right', badge: 'Go', badgeColor: 'primary' };
    case 'remote_suggest':
      return { icon: 'cloud-outline', badge: 'Suggest', badgeColor: 'textSecondary' };
    default:
      return { icon: 'web', badge: 'Link', badgeColor: 'textSecondary' };
  }
}

export const SuggestionItem = memo(function SuggestionItem({
  item,
  onPress,
  testID,
}: SuggestionItemProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const primary = primaryAlphas(theme.colors.primary);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const meta = kindMeta(item.kind);
  const metaLine =
    item.kind === 'history' && item.visitedAt
      ? formatHistoryRelativeTime(item.visitedAt)
      : item.kind === 'frequent' && item.visitCount
        ? `${item.visitCount} visits`
        : item.subtitle;

  const handlePress = useCallback(() => {
    onPress(item);
  }, [item, onPress]);

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.subtitle}. ${meta.badge}`}
      accessibilityHint={t('browser.openSuggestionHint')}
      style={({ pressed }) => ({
        minHeight: BROWSER_TOUCH_TARGET + 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: pressed ? primary.pressed : 'transparent',
      })}>
      <Box
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: primary.subtle,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
        {item.faviconUrl && !faviconFailed && item.kind !== 'search' && item.kind !== 'recent_search' ? (
          <Image
            source={{ uri: item.faviconUrl }}
            style={{ width: 20, height: 20 }}
            contentFit="contain"
            onError={() => setFaviconFailed(true)}
          />
        ) : (
          <Icon name={meta.icon} size="sm" color="secondary" />
        )}
      </Box>

      <Box flex={1} gap={2} style={{ minWidth: 0 }}>
        <HighlightedText text={item.title} query={item.query} variant="bodySmall" />
        <HighlightedText
          text={item.kind === 'search' ? item.subtitle : item.url}
          query={item.query}
          variant="caption"
          color="textSecondary"
        />
      </Box>

      <Box gap={4} style={{ alignItems: 'flex-end', maxWidth: 72 }}>
        <Box row gap={4} style={{ alignItems: 'center' }}>
          {item.bookmarked || item.kind === 'bookmark' ? (
            <Icon name="bookmark" size="xs" color="primary" />
          ) : null}
          <Text variant="caption" color={meta.badgeColor} numberOfLines={1}>
            {meta.badge}
          </Text>
        </Box>
        {metaLine && item.kind !== 'search' ? (
          <Text variant="caption" color="textDisabled" numberOfLines={1}>
            {metaLine}
          </Text>
        ) : null}
      </Box>
    </Pressable>
  );
});
