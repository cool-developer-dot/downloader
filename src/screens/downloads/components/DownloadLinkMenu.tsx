import { memo, useCallback, useMemo, useState } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { useTranslation } from '@/localization';
import { isRemoteControlAvailable, sendToComputer } from '@/remote/remote-control';
import { useDownloadsStore } from '@/store/downloads';

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
  const title = useDownloadsStore((state) => state.itemsById[id]?.title);
  const [visible, setVisible] = useState(false);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  const actions = useMemo<ActionSheetItem[]>(() => {
    if (!target) {
      return [];
    }
    const items: ActionSheetItem[] = [];
    if (target.pageUrl) {
      items.push({
        id: 'redownload',
        label: t('downloadLinks.redownload'),
        icon: 'download-outline',
        onPress: () => redownload(target),
      });
    }
    items.push({
      id: 'copy-link',
      label: t('downloadLinks.copyLink'),
      icon: 'content-copy',
      onPress: () => void copyLink(target),
    });
    // P6 #511: the page — and, when finished, the video itself — to "Sent from phone" in the Web UI.
    if (isRemoteControlAvailable()) {
      items.push({
        id: 'send-to-computer',
        label: t('remoteControl.sendToComputer'),
        icon: 'monitor-arrow-down',
        onPress: () => void sendToComputer({ url: target.copyUrl, title: title || target.copyUrl, downloadId: id }),
      });
    }
    return items;
  }, [copyLink, id, redownload, t, target, title]);

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
