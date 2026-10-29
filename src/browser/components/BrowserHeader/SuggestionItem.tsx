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
import { EngineBadge } from '@/browser/components/EngineBadge';
import { getSearchEngine, SEARCH_ENGINES, type SearchEngineId } from '@/browser/search/search-engines';
import type { TranslateFn } from '@/localization';
import { useTheme } from '@/hooks/use-theme';
import { primaryAlphas } from '@/theme';

import { HighlightedText } from './HighlightedText';

export type SuggestionItemProps = {
  item: OmniboxSuggestion;
  onPress: (item: OmniboxSuggestion) => void;
  testID?: string;
};

function kindMeta(kind: SuggestionKind, t: TranslateFn): {
  icon: IconName;
  badge: string;
  badgeColor: 'primary' | 'textSecondary' | 'success';
} {
  switch (kind) {
    case 'bookmark':
      return { icon: 'bookmark', badge: t('browserAddress.suggestionKinds.bookmark'), badgeColor: 'primary' };
    case 'history':
      return { icon: 'history', badge: t('browserAddress.suggestionKinds.history'), badgeColor: 'textSecondary' };
    case 'frequent':
      return { icon: 'chart-line', badge: t('browserAddress.suggestionKinds.frequent'), badgeColor: 'success' };
    case 'domain':
      return { icon: 'web', badge: t('browserAddress.suggestionKinds.site'), badgeColor: 'textSecondary' };
    case 'recent_search':
      return { icon: 'magnify', badge: t('browserAddress.suggestionKinds.recent'), badgeColor: 'textSecondary' };
    case 'search':
      return { icon: 'magnify', badge: t('browserAddress.suggestionKinds.search'), badgeColor: 'primary' };
    case 'calculator':
      return { icon: 'calculator-variant-outline', badge: t('browserAddress.calculator'), badgeColor: 'primary' };
    case 'exact_url':
      return { icon: 'arrow-right', badge: t('browserAddress.suggestionKinds.go'), badgeColor: 'primary' };
    case 'remote_suggest':
      return { icon: 'cloud-outline', badge: t('browserAddress.suggestionKinds.suggest'), badgeColor: 'textSecondary' };
    default:
      return { icon: 'web', badge: t('browserAddress.suggestionKinds.link'), badgeColor: 'textSecondary' };
  }
}

/** B4 #36: a search row's engine, from its results host (a shortcut to a non-engine site has none). */
function engineOfSearchRow(item: OmniboxSuggestion): SearchEngineId | null {
  if (item.kind !== 'search' && item.kind !== 'recent_search') return null;
  const host = item.hostname.toLowerCase();
  for (const engine of Object.values(SEARCH_ENGINES)) {
    const engineHost = new URL(engine.origin).hostname;
    if (host === engineHost || (engine.id === 'yahoo' && host.endsWith('search.yahoo.com'))) {
      return engine.id;
    }
  }
  return host ? null : getSearchEngine().id;
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
  const [pressed, setPressed] = useState(false);
  const isGo = item.kind === 'exact_url';
  const meta = kindMeta(item.kind, t);
  const rowEngine = engineOfSearchRow(item);
  const isCalculator = item.kind === 'calculator';
  const metaLine =
    item.kind === 'history' && item.visitedAt
      ? formatHistoryRelativeTime(item.visitedAt)
      : item.kind === 'frequent' && item.visitCount
        ? t('browserAddress.visits', { count: item.visitCount })
        : item.subtitle;

  const handlePress = useCallback(() => {
    onPress(item);
  }, [item, onPress]);

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      onPressIn={isGo ? () => setPressed(true) : undefined}
      onPressOut={isGo ? () => setPressed(false) : undefined}
      accessibilityRole="button"
      accessibilityLabel={
        isCalculator
          ? `${item.subtitle} ${item.title}. ${t('browserAddress.calculatorA11y', { result: item.title.replace(/^=\s*/, '') })}`
          : `${item.title}. ${item.subtitle}. ${meta.badge}`
      }
      accessibilityHint={isCalculator ? undefined : t('browser.openSuggestionHint')}
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
        {rowEngine ? (
          <EngineBadge engine={rowEngine} size={24} />
        ) : item.faviconUrl && !faviconFailed && item.kind !== 'search' && item.kind !== 'recent_search' ? (
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
          text={item.kind === 'search' || isCalculator ? item.subtitle : item.url}
          query={item.query}
          variant="caption"
          color="textSecondary"
        />
      </Box>

      {isGo ? (
        // The typed address itself: a clear, rounded "Go →" action in the theme's primary colour.
        <Box
          testID={testID ? `${testID}-go` : undefined}
          row
          gap={4}
          style={{
            alignItems: 'center',
            paddingLeft: 14,
            paddingRight: 10,
            height: 34,
            borderRadius: 17,
            backgroundColor: pressed ? theme.colors.primaryDark : theme.colors.primary,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          }}>
          <Text variant="button" color="textOnPrimary" numberOfLines={1}>
            {t('browser.goAction')}
          </Text>
          <Icon name="arrow-right" size="xs" color="onPrimary" />
        </Box>
      ) : (
      <Box gap={4} style={{ alignItems: 'flex-end', maxWidth: 72 }}>
        <Box row gap={4} style={{ alignItems: 'center' }}>
          {item.bookmarked || item.kind === 'bookmark' ? (
            <Icon name="bookmark" size="xs" color="primary" />
          ) : null}
          <Text variant="caption" color={meta.badgeColor} numberOfLines={1}>
            {meta.badge}
          </Text>
        </Box>
        {metaLine && item.kind !== 'search' && !isCalculator ? (
          <Text variant="caption" color="textDisabled" numberOfLines={1}>
            {metaLine}
          </Text>
        ) : null}
      </Box>
      )}
    </Pressable>
  );
});
