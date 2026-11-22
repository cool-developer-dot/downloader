import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { DsIcon, type DsIconName } from './DsIcon';
import { DsIconButton } from './DsIconButton';
import { DsText } from './DsText';
import { ds } from './tokens';

export type DsHeaderAction = {
  icon: DsIconName;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  testID?: string;
};

export type DsHeaderProps = {
  title: string;
  subtitle?: string;
  /** Shows the ← arrow before the title (the design's sub-screens: "← Add download"). */
  onBack?: () => void;
  /** The one round button at the right (⋮, ⚙, +, ♡, search), or any element. */
  action?: DsHeaderAction | ReactNode;
  testID?: string;
};

function isAction(value: DsHeaderProps['action']): value is DsHeaderAction {
  return Boolean(value) && typeof value === 'object' && 'icon' in (value as object);
}

/** The Red theme's band darkens a little towards its bottom edge (#D92D20 → #C42419): eight strips stand in for the gradient. */
const BAND_STRIPS = [0, 0.014, 0.028, 0.042, 0.056, 0.07, 0.084, 0.098];

/**
 * The design's screen header: a 22 dp semibold title (with an optional ← before it), a 12.5 dp secondary line under
 * it, and one 36 dp button at the top right. Sits inside the scroll so it moves with the content.
 *
 * Flat themes draw it on the page. The Red theme draws it as a full-width 85 dp band in the accent with white text
 * and a translucent white button (`theme.colors.headerStyle === 'band'`); the band bleeds past the 16 dp gutters.
 */
export const DsHeader = memo(function DsHeader({ title, subtitle, onBack, action, testID }: DsHeaderProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const band = theme.colors.headerStyle === 'band';
  const textColor = band ? 'headerText' : 'textPrimary';
  return (
    <View
      testID={testID}
      accessibilityRole="header"
      style={
        band
          ? {
              marginHorizontal: -ds.space.screenX,
              paddingHorizontal: ds.space.screenX,
              paddingTop: ds.space.headerTop,
              paddingBottom: 14,
              minHeight: ds.size.headerBand,
              backgroundColor: theme.colors.headerBackground,
              justifyContent: 'flex-start',
            }
          : { paddingTop: ds.space.headerTop, paddingBottom: ds.space.headerBottom - ds.space.stack }
      }>
      {band ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          {BAND_STRIPS.map((alpha) => (
            <View key={alpha} style={{ flex: 1, backgroundColor: `rgba(0, 0, 0, ${alpha})` }} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 10, minHeight: ds.size.headerButton }}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={t('common.goBack')}
              hitSlop={8}
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginStart: 2 }}>
              <DsIcon name={rtl.isRtl ? 'arrow-right' : 'arrow-left'} size={22} color={band ? 'headerIcon' : 'textPrimary'} strokeWidth={2} />
            </Pressable>
          ) : null}
          <DsText variant="title" color={textColor} numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </DsText>
        </View>
        {isAction(action) ? (
          <DsIconButton
            icon={action.icon}
            accessibilityLabel={action.accessibilityLabel}
            accessibilityHint={action.accessibilityHint}
            onPress={action.onPress}
            tone={band ? 'header' : 'surface'}
            testID={action.testID}
          />
        ) : (
          action ?? null
        )}
      </View>
      {subtitle ? (
        <DsText variant="subtitle" color={band ? 'headerSubtitle' : 'textSecondary'} numberOfLines={1} style={{ marginTop: ds.space.headerTitleGap }}>
          {subtitle}
        </DsText>
      ) : null}
    </View>
  );
});
