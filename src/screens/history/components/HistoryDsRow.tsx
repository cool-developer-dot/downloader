import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { splitHighlight } from '@/browser/history/history-highlight';
import { DsIcon, DsText, ds, type DsTextVariant } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';

import { buildFaviconUrl } from '../utils/history-format';

/** B10 #95 on the kit's text: the parts that match the search in the accent colour and the semibold face. */
const HighlightedDsText = memo(function HighlightedDsText({ text, query, variant }: { text: string; query: string; variant: DsTextVariant }) {
  const parts = useMemo(() => splitHighlight(text, query), [text, query]);
  if (!parts.some((part) => part.match)) {
    return (
      <DsText variant={variant} numberOfLines={1}>
        {text}
      </DsText>
    );
  }
  const strong: DsTextVariant = variant === 'rowSub' ? 'tile' : 'rowTitle';
  return (
    <DsText variant={variant} numberOfLines={1}>
      {parts.map((part, index) =>
        part.match ? (
          <DsText key={index} variant={strong} color="primary">
            {part.text}
          </DsText>
        ) : (
          part.text
        ),
      )}
    </DsText>
  );
});

/** The 34 dp tile: the site's icon, or the design's globe. */
const SiteTile = memo(function SiteTile({ hostname }: { hostname: string }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const favicon = buildFaviconUrl(hostname);
  return (
    <View
      style={{
        width: ds.size.iconTile,
        height: ds.size.iconTile,
        borderRadius: ds.radius.iconTile,
        backgroundColor: theme.colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      {favicon && !failed ? (
        <Image source={{ uri: favicon }} style={{ width: 18, height: 18 }} contentFit="contain" onError={() => setFailed(true)} />
      ) : (
        <DsIcon name="globe" size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
      )}
    </View>
  );
});

export type HistoryDsRowProps = {
  hostname: string;
  title: string;
  subtitle: string;
  query: string;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * Design 36's history row in the kit's list-row look (a `DsRow` whose title and subtitle can carry the search
 * highlight): site tile · title / "host · 10:42" · chevron. Tap opens the page; long-press removes it.
 */
export const HistoryDsRow = memo(function HistoryDsRow({
  hostname,
  title,
  subtitle,
  query,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: HistoryDsRowProps) {
  const theme = useTheme();
  const rtl = useRtl();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={420}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({ backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent' })}>
      <View
        style={{
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          gap: ds.space.rowGap,
          minHeight: ds.size.rowMinHeight,
          paddingHorizontal: ds.space.cardPad,
          paddingVertical: ds.space.rowPadY,
        }}>
        <SiteTile hostname={hostname} />
        <View style={{ flex: 1, gap: 1 }}>
          <HighlightedDsText text={title} query={query} variant="rowTitle" />
          <HighlightedDsText text={subtitle} query={query} variant="rowSub" />
        </View>
        <DsIcon name={rtl.isRtl ? 'chevron-left' : 'chevron-right'} size={ds.size.rowChevron} color="textSecondary" strokeWidth={1.8} />
      </View>
    </Pressable>
  );
});
