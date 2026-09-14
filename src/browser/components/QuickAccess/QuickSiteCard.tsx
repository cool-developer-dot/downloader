import { Image } from 'expo-image';
import { memo, useCallback, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import type { QuickSite } from '@/browser/config/quick-sites';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';

import {
  getQuickAccessTokens,
  type QuickAccessDensity,
} from './quick-access-tokens';

export type QuickSiteCardProps = {
  site: QuickSite;
  onPress: (url: string) => void;
  density?: QuickAccessDensity;
  testID?: string;
};

export const QuickSiteCard = memo(function QuickSiteCard({
  site,
  onPress,
  density = 'default',
  testID,
}: QuickSiteCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [faviconFailed, setFaviconFailed] = useState(false);
  const tokens = getQuickAccessTokens(density);
  const isCompact = density === 'compact' || density === 'startPage';

  const faviconUrl = useMemo(
    () => buildFaviconUrl(site.hostname),
    [site.hostname],
  );

  const accentColor = theme.colors[site.accent] ?? theme.colors.primary;

  const handlePress = useCallback(() => {
    onPress(site.url);
  }, [onPress, site.url]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t('browser.home.openSiteA11y', { name: site.name })}
      accessibilityHint={t('browser.home.openSiteHint')}
      testID={testID ?? `quick-site-${site.id}`}
      style={({ pressed }) => ({
        minHeight: tokens.tileMinHeight,
        minWidth: tokens.minTouchTarget,
        borderRadius: tokens.tileRadius,
        paddingVertical: tokens.tilePaddingY,
        paddingHorizontal: tokens.tilePaddingX,
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.labelGap,
        backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: 1,
        elevation: 0,
      })}>
      <Box
        center
        style={{
          width: tokens.tileIconSize,
          height: tokens.tileIconSize,
          borderRadius: tokens.iconContainerRadius,
          backgroundColor: `${accentColor}14`,
          overflow: 'hidden',
        }}>
        {faviconUrl && !faviconFailed ? (
          <Image
            source={{ uri: faviconUrl }}
            style={{
              width: tokens.faviconSize,
              height: tokens.faviconSize,
            }}
            contentFit="contain"
            onError={() => setFaviconFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Icon
            name={site.icon}
            size={isCompact ? 'md' : 'lg'}
            color="primary"
          />
        )}
      </Box>

      <Text
        variant={isCompact ? 'caption' : 'bodySmall'}
        align="center"
        numberOfLines={2}
        style={{
          lineHeight: isCompact ? 16 : 18,
          fontWeight: '500',
        }}>
        {site.name}
      </Text>
    </Pressable>
  );
});
