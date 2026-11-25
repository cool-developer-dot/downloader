import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsIcon, DsText, DsThumb, type DsIconName } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation } from '@/localization';

import { ListCardCell } from './ListCardCell';

export type SelectRowProps = {
  title: string;
  meta: string;
  icon: DsIconName;
  pictureUri?: string | null;
  thumbnailSize?: number;
  selected: boolean;
  onToggle: () => void;
  first: boolean;
  last: boolean;
  testID?: string;
};

/**
 * Files F4: a file or folder row while selecting — a check box, its icon or thumbnail, the name and its line. A tap
 * selects or unselects it; TalkBack reads "Selected" or "Not selected".
 */
export const SelectRow = memo(function SelectRow({
  title,
  meta,
  icon,
  pictureUri,
  thumbnailSize = 56,
  selected,
  onToggle,
  first,
  last,
  testID,
}: SelectRowProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const { t } = useTranslation();
  const state = selected ? t('fileManager.selectionOn') : t('fileManager.selectionOff');
  return (
    <ListCardCell first={first} last={last}>
      <Pressable
        testID={testID}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, selected }}
        accessibilityLabel={[title, meta, state].filter(Boolean).join(', ')}
        accessibilityHint={t('fileManager.selectHint')}
        style={({ pressed }) => ({
          backgroundColor: pressed ? theme.colors.surfacePressed : selected ? theme.colors.accentSoft : 'transparent',
        })}>
        <View
          style={{
            flexDirection: rtl.rowDirection,
            alignItems: 'center',
            gap: ds.space.rowGap,
            minHeight: ds.size.rowMinHeight,
            paddingVertical: pictureUri ? 8 : ds.space.rowPadY,
            paddingHorizontal: ds.space.cardPad,
          }}>
          <DsIcon name={selected ? 'square-check' : 'square'} size={22} color={selected ? 'primary' : 'textSecondary'} strokeWidth={1.8} />
          {pictureUri ? (
            <DsThumb uri={pictureUri} kind="video" icon={icon} width={thumbnailSize} height={Math.round(thumbnailSize * 0.75)} />
          ) : (
            <View
              style={{
                width: ds.size.iconTile,
                height: ds.size.iconTile,
                borderRadius: ds.radius.iconTile,
                backgroundColor: theme.colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <DsIcon name={icon} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <DsText variant="rowTitle" numberOfLines={1} ellipsizeMode="middle">
              {title}
            </DsText>
            {meta ? (
              <DsText variant="rowSub" numberOfLines={1}>
                {meta}
              </DsText>
            ) : null}
          </View>
        </View>
      </Pressable>
    </ListCardCell>
  );
});
