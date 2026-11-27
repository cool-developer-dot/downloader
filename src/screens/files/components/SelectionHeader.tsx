import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Pressable } from '@/components/base/Pressable';
import { ds, DsIconButton, DsText } from '@/design';
import { useTranslation } from '@/localization';

export type SelectionHeaderProps = {
  count: number;
  onClose: () => void;
  onSelectAll: () => void;
  onInvert: () => void;
  testID?: string;
};

/**
 * Files F4: the header while selecting — ✕ (leave), "{n} selected" (read out as it changes), Select all, and ⋮ with
 * Invert selection.
 */
export const SelectionHeader = memo(function SelectionHeader({ count, onClose, onSelectAll, onInvert, testID = 'files-selection-header' }: SelectionHeaderProps) {
  const { t, rtl } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: 'invert',
        label: t('fileManager.invertSelection'),
        onPress: () => {
          setMenuOpen(false);
          onInvert();
        },
      },
    ],
    [onInvert, t],
  );

  return (
    <View
      testID={testID}
      accessibilityRole="header"
      style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6, paddingTop: ds.space.headerTop, paddingBottom: ds.space.headerBottom - ds.space.stack }}>
      <DsIconButton icon="x" accessibilityLabel={t('fileManager.leaveSelection')} onPress={onClose} testID={`${testID}-close`} />
      <DsText variant="title" numberOfLines={1} accessibilityLiveRegion="polite" style={{ flex: 1 }}>
        {t('fileManager.selectedCount', { count })}
      </DsText>
      <Pressable
        onPress={onSelectAll}
        accessibilityRole="button"
        accessibilityLabel={t('fileManager.selectAll')}
        hitSlop={8}
        style={{ paddingHorizontal: 8, paddingVertical: 6 }}
        testID={`${testID}-select-all`}>
        <DsText variant="chipSelected">{t('fileManager.selectAll')}</DsText>
      </Pressable>
      <DsIconButton icon="ellipsis-vertical" accessibilityLabel={t('fileManager.selectionMenu')} onPress={() => setMenuOpen(true)} testID={`${testID}-menu`} />
      <ActionSheetModal visible={menuOpen} onClose={() => setMenuOpen(false)} actions={menu} testID={`${testID}-menu-sheet`} />
    </View>
  );
});
