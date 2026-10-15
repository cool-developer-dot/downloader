import { memo, useCallback, useMemo, useState } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { useTranslation } from '@/localization';

import { useDownloadLinkActions, useDownloadLinkTarget } from '../hooks/useDownloadLinkActions';
import { useDownloadsTokens } from '../theme/downloads-tokens';

export type DownloadLinkMenuProps = {
  id: string;
  disabled?: boolean;
  testID?: string;
};

/**
 * A card's "more" button for Re-download and Copy link. Renders nothing unless the row is a finished, failed or
 * cancelled v2 download with a source page (`resolveDownloadLinkTarget`).
 */
export const DownloadLinkMenu = memo(function DownloadLinkMenu({ id, disabled, testID }: DownloadLinkMenuProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  const target = useDownloadLinkTarget(id);
  const { redownload, copyLink } = useDownloadLinkActions();
  const [visible, setVisible] = useState(false);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  const actions = useMemo<ActionSheetItem[]>(() => {
    if (!target) {
      return [];
    }
    return [
      {
        id: 'redownload',
        label: t('downloadLinks.redownload'),
        icon: 'download-outline',
        onPress: () => redownload(target),
      },
      {
        id: 'copy-link',
        label: t('downloadLinks.copyLink'),
        icon: 'content-copy',
        onPress: () => void copyLink(target),
      },
    ];
  }, [copyLink, redownload, t, target]);

  if (!target) {
    return null;
  }

  return (
    <>
      <Pressable
        onPress={open}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t('downloadLinks.moreActions')}
        accessibilityHint={t('downloadLinks.moreActionsHint')}
        accessibilityState={{ disabled: Boolean(disabled) }}
        hitSlop={8}
        testID={testID}
        style={({ pressed }) => ({
          minWidth: downloadsTokens.actionButtonSize,
          minHeight: downloadsTokens.actionButtonSize,
          borderRadius: downloadsTokens.radius.action,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
          backgroundColor: pressed ? downloadsTokens.actionButtonPressed : downloadsTokens.actionButtonBg,
          transform: [{ scale: pressed && !disabled ? 0.94 : 1 }],
        })}>
        <Icon name="dots-vertical" size="sm" color="primary" />
      </Pressable>
      <ActionSheetModal
        visible={visible}
        onClose={close}
        title={t('downloadLinks.menuTitle')}
        actions={actions}
        testID={testID ? `${testID}-sheet` : undefined}
      />
    </>
  );
});
