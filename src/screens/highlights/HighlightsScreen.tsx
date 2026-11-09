import { memo, useEffect, useMemo, useState } from 'react';
import { FlatList } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { SearchField } from '@/components/inputs/SearchField';
import { HighlightRow } from '@/browser/highlights/components/HighlightsHost';
import { matchesHighlightQuery } from '@/browser/highlights/highlights-core';
import { listAllHighlights, useHighlightsVersion } from '@/browser/highlights/highlights.service';
import { loadUrlActiveTab } from '@/browser/services';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import type { Highlight } from '@/storage/repositories/annotate.repository';

/** B23 #261 — every highlight of this profile: search, share, delete, open the page. */
export const HighlightsScreen = memo(function HighlightsScreen() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const changes = useHighlightsVersion();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<Highlight[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listAllHighlights().then((list) => {
      if (!cancelled) setAll(list);
    });
    return () => {
      cancelled = true;
    };
  }, [changes]);

  const shown = useMemo(() => all.filter((h) => matchesHighlightQuery(h, query)), [all, query]);

  return (
    <SafeAreaScreen
      testID="highlights-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader title={t('browserAnnotate.allTitle')} showBack onBackPress={() => navigation.back()} />
      <Box px={16} py={8}>
        <SearchField value={query} onChangeText={setQuery} onSearch={() => undefined} placeholder={t('browserAnnotate.search')} testID="highlights-search" />
      </Box>
      <FlatList
        data={shown}
        keyExtractor={(h) => h.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 8 }}
        ListEmptyComponent={
          <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign, paddingVertical: 24 }}>
            {query.trim() ? t('browserAnnotate.noMatches') : t('browserAnnotate.allEmpty')}
          </Text>
        }
        renderItem={({ item }) => (
          <HighlightRow
            highlight={item}
            onOpen={() => {
              navigation.push(routePaths.browser);
              loadUrlActiveTab(item.pageUrl);
            }}
          />
        )}
      />
    </SafeAreaScreen>
  );
});
