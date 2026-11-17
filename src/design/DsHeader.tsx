import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
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

/**
 * The design's screen header: a 22 dp semibold title (with an optional ← before it), a 12.5 dp secondary line under
 * it, and one 36 dp white button at the top right. Sits inside the scroll so it moves with the content.
 */
export const DsHeader = memo(function DsHeader({ title, subtitle, onBack, action, testID }: DsHeaderProps) {
  const { t, rtl } = useTranslation();
  return (
    <View
      testID={testID}
      accessibilityRole="header"
      style={{ paddingTop: ds.space.headerTop, paddingBottom: ds.space.headerBottom - ds.space.stack }}>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 10, minHeight: ds.size.headerButton }}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel={t('common.goBack')}
              hitSlop={8}
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginStart: 2 }}>
              <DsIcon name={rtl.isRtl ? 'arrow-right' : 'arrow-left'} size={22} color="textPrimary" strokeWidth={2} />
            </Pressable>
          ) : null}
          <DsText variant="title" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </DsText>
        </View>
        {isAction(action) ? (
          <DsIconButton
            icon={action.icon}
            accessibilityLabel={action.accessibilityLabel}
            accessibilityHint={action.accessibilityHint}
            onPress={action.onPress}
            testID={action.testID}
          />
        ) : (
          action ?? null
        )}
      </View>
      {subtitle ? (
        <DsText variant="subtitle" numberOfLines={1} style={{ marginTop: ds.space.headerTitleGap }}>
          {subtitle}
        </DsText>
      ) : null}
    </View>
  );
});
