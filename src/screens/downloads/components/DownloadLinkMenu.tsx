import { memo, useCallback, useMemo, useState } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { DsIconButton } from '@/design';
import { useTranslation } from '@/localization';

import { useDownloadLinkActions, useDownloadLinkTarget } from '../hooks/useDownloadLinkActions';

/**
 * Re-download and Copy link for a card's ⋮ sheet. Empty unless the row is a finished, failed or cancelled v2
 * download with a source page (`resolveDownloadLinkTarget`).
 */
export function useDownloadLinkMenuItems(id: string): ActionSheetItem[] {
  const { t } = useTranslation();
  const target = useDownloadLinkTarget(id);
  const { redownload, copyLink } = useDownloadLinkActions();

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
    return items;
  }, [copyLink, redownload, t, target]);
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
