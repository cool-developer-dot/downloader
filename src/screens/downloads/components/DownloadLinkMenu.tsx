import { memo, useCallback, useMemo, useState } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { DsIconButton } from '@/design';
import { useTranslation } from '@/localization';
import { isRemoteControlAvailable, sendToComputer } from '@/remote/remote-control';
import { useDownloadsStore } from '@/store/downloads';

import { useDownloadLinkActions, useDownloadLinkTarget } from '../hooks/useDownloadLinkActions';

/**
 * Re-download and Copy link for a card's ⋮ sheet. Empty unless the row is a finished, failed or cancelled v2
 * download with a source page (`resolveDownloadLinkTarget`).
 */
export function useDownloadLinkMenuItems(id: string): ActionSheetItem[] {
  const { t } = useTranslation();
  const target = useDownloadLinkTarget(id);
  const { redownload, copyLink } = useDownloadLinkActions();
  const title = useDownloadsStore((state) => state.itemsById[id]?.title);

  return useMemo<ActionSheetItem[]>(() => {
    if (!target) {
      return [];
    }
    const items: ActionSheetItem[] = [];
    if (target.pageUrl) {
      items.push({
        id: 'redownload',
        label: t('downloadLinks.redownload'),
        onPress: () => redownload(target),
      });
    }
    items.push({
      id: 'copy-link',
      label: t('downloadLinks.copyLink'),
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
}

export type DownloadLinkMenuProps = {
  id: string;
  disabled?: boolean;
  testID?: string;
};

/**
 * A stand-alone "more" button for Re-download and Copy link (the Downloads card folds these into its own ⋮ sheet).
 * Renders nothing when the row has no source page.
 */
export const DownloadLinkMenu = memo(function DownloadLinkMenu({ id, disabled, testID }: DownloadLinkMenuProps) {
  const { t } = useTranslation();
  const actions = useDownloadLinkMenuItems(id);
  const [visible, setVisible] = useState(false);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);

  if (actions.length === 0) {
    return null;
  }

  return (
    <>
      <DsIconButton
        variant="plain"
        icon="ellipsis-vertical"
        onPress={open}
        disabled={disabled}
        accessibilityLabel={t('downloadLinks.moreActions')}
        accessibilityHint={t('downloadLinks.moreActionsHint')}
        testID={testID}
      />
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
