import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon, DsText } from '@/design';
import { useRtl, useTranslation } from '@/localization';

import { breadcrumbSpeech, type Crumb } from '../utils/breadcrumbs';

export type BreadcrumbsProps = {
  crumbs: readonly Crumb[];
  onPressCrumb: (id: string | null) => void;
  testID?: string;
};

/**
 * Files F1 · #742: the path under the folder screen's header — "Files › Movies › 2026". Every crumb but the last one
 * opens its folder. Right to left, the crumbs run from the right and the separators point left.
 */
export const Breadcrumbs = memo(function Breadcrumbs({ crumbs, onPressCrumb, testID = 'files-breadcrumbs' }: BreadcrumbsProps) {
  const rtl = useRtl();
  const { t } = useTranslation();
  return (
    <View
      testID={testID}
      accessibilityLabel={t('fileManager.pathA11y', { path: breadcrumbSpeech(crumbs) })}
      style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
      {crumbs.map((crumb, index) => (
        <View key={crumb.id ?? 'root'} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 2 }}>
          {index > 0 ? (
            <DsIcon name={rtl.isRtl ? 'chevron-left' : 'chevron-right'} size={14} color="textSecondary" strokeWidth={1.8} />
          ) : null}
          {crumb.current ? (
            <DsText variant="chipSelected" numberOfLines={1} accessibilityRole="text" style={{ paddingVertical: 6 }}>
              {crumb.label}
            </DsText>
          ) : (
            <Pressable
              onPress={() => onPressCrumb(crumb.id)}
              accessibilityRole="link"
              accessibilityLabel={t('fileManager.crumbA11y', { name: crumb.label })}
              hitSlop={6}
              testID={`${testID}-${crumb.id ?? 'root'}`}
              style={{ paddingVertical: 6, paddingHorizontal: 2 }}>
              <DsText variant="chip" color="textSecondary" numberOfLines={1}>
                {crumb.label}
              </DsText>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
});
