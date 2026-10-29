import { memo } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/base/Text';
import { SEARCH_ENGINES, type SearchEngineId } from '@/browser/search/search-engines';
import { useTheme } from '@/hooks/use-theme';

/** B5 #56 / B4 #36: a search engine's bundled letter badge in its own colour (no remote icon, no brand asset). */
export const EngineBadge = memo(function EngineBadge({ engine, size = 28 }: { engine: SearchEngineId; size?: number }) {
  const theme = useTheme();
  const { badge } = SEARCH_ENGINES[engine];
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: badge.color,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text
        variant="label"
        style={{ color: theme.colors.white, fontSize: badge.letter.length > 1 ? size * 0.38 : size * 0.5, lineHeight: size * 0.62 }}>
        {badge.letter}
      </Text>
    </View>
  );
});
