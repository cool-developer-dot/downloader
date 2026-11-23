import { memo } from 'react';
import { View } from 'react-native';

import { DsButton, DsButtonRow, DsText, ds } from '@/design';
import { useTranslation } from '@/localization';

export type LibrarySelectionBarProps = {
  count: number;
  onAdd: () => void;
  onCancel: () => void;
};

/** P7 #617: the Library's selection mode — how many are selected, "Add to playlist" and Cancel. */
export const LibrarySelectionBar = memo(function LibrarySelectionBar({ count, onAdd, onCancel }: LibrarySelectionBarProps) {
  const { t } = useTranslation();
  return (
    <View
      testID="library-selection-bar"
      style={{ paddingHorizontal: ds.space.screenX, paddingBottom: 8, gap: 6 }}
      accessibilityLiveRegion="polite">
      <DsText variant="bodyStrong">
        {count > 0 ? t('playlists.selectedCount', { count }) : t('playlists.selectionHint')}
      </DsText>
      <DsButtonRow>
        <DsButton
          label={t('playlists.addToPlaylist')}
          icon="list"
          flex
          disabled={count === 0}
          onPress={onAdd}
          testID="library-selection-add"
        />
        <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onCancel} testID="library-selection-cancel" />
      </DsButtonRow>
    </View>
  );
});
