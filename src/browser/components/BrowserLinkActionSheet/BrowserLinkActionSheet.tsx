import { memo, useMemo } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation } from '@/localization';

export type BrowserLinkActionSheetProps = {
  visible: boolean;
  title: string;
  subtitle: string;
  actions: ActionSheetItem[];
  onClose: () => void;
  testID?: string;
};

/**
 * Premium link long-press sheet — presentation only.
 * Actions come from the browser action registry via the controller hook.
 */
export const BrowserLinkActionSheet = memo(function BrowserLinkActionSheet({
  visible,
  title,
  subtitle,
  actions,
  onClose,
  testID = 'browser-link-action-sheet',
}: BrowserLinkActionSheetProps) {
  // Only actionable rows (enabled registry entries). Placeholders stay registered.
  const { t } = useTranslation();
  const actionable = useMemo(
    () => actions.filter((action) => typeof action.onPress === 'function'),
    [actions],
  );

  return (
    <ActionSheetModal
      visible={visible}
      title={title}
      subtitle={subtitle}
      actions={actionable}
      onClose={onClose}
      cancelLabel={t('common.dismiss')}
      testID={testID}
    />
  );
});
