import { memo, type PropsWithChildren, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { ds } from './tokens';

export type DsScreenProps = PropsWithChildren<{
  /** Scrolls by default; `false` for screens that own a list. */
  scroll?: boolean;
  /** Drawn above the scrolling content (a DsHeader usually goes inside the scroll; use this for a fixed header). */
  fixedHeader?: ReactNode;
  /** Drawn below the content, above the tab bar (a full-width button). */
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: ScrollViewProps['contentContainerStyle'];
  style?: StyleProp<ViewStyle>;
  /** Default `['top']`: the tab bar owns the bottom inset. Pass `['top', 'bottom']` on screens outside the tabs. */
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  testID?: string;
}>;

/**
 * A design screen: the #FAF9FB page, 16 dp side gutters, content that scrolls under a fixed footer. The bottom
 * tab bar is the navigator's, so nothing here pads for it.
 */
export const DsScreen = memo(function DsScreen({
  children,
  scroll = true,
  fixedHeader,
  footer,
  refreshing = false,
  onRefresh,
  contentContainerStyle,
  style,
  edges = ['top'],
  keyboardShouldPersistTaps = 'handled',
  testID,
}: DsScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const background = theme.colors.background;

  const content = scroll ? (
    <ScrollView
      style={{ flex: 1, backgroundColor: background }}
      contentContainerStyle={[
        { paddingHorizontal: ds.space.screenX, paddingBottom: 24, gap: ds.space.stack },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            accessibilityLabel={t('common.refreshA11y')}
          />
        ) : undefined
      }>
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, backgroundColor: background }, contentContainerStyle as ViewStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: background }, style]} testID={testID}>
      {fixedHeader}
      {content}
      {footer ? (
        <View style={{ paddingHorizontal: ds.space.screenX, paddingTop: 8, paddingBottom: 12, backgroundColor: background }}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
});
