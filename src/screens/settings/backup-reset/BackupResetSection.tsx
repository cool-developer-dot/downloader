import { memo, useMemo } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { DEFAULT_TABS, type DefaultTab } from '@/navigation/helpers/default-tab';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { SettingsRow } from '@/screens/settings/components/SettingsRow';
import { SettingsSection } from '@/screens/settings/components/SettingsSection';

import { useSettingsBackupReset } from './useSettingsBackupReset';

const TAB_LABELS: Record<DefaultTab, TranslationKey> = {
  browser: 'settingsBackup.tabBrowser',
  downloads: 'settingsBackup.tabDownloads',
  player: 'settingsBackup.tabPlayer',
};

/** Settings → Start & backup: Default tab, export/import settings, reset settings. */
export const BackupResetSection = memo(function BackupResetSection({
  testID = 'settings-backup-reset',
}: {
  testID?: string;
}) {
  const { t } = useTranslation();
  const screen = useSettingsBackupReset();

  const { defaultTab, setDefaultTab } = screen;
  const tabActions = useMemo<ActionSheetItem[]>(
    () =>
      DEFAULT_TABS.map((tab) => ({
        id: tab,
        label: t(TAB_LABELS[tab]),
        selected: defaultTab === tab,
        onPress: () => setDefaultTab(tab),
      })),
    [defaultTab, setDefaultTab, t],
  );

  return (
    <SettingsSection
      testID={testID}
      title={t('settingsBackup.section')}
      description={t('settingsBackup.sectionDescription')}
      icon="cog-sync-outline">
      <SettingsRow
        title={t('settingsBackup.defaultTab')}
        description={t('settingsBackup.defaultTabHint')}
        icon="tab"
        value={t(TAB_LABELS[screen.defaultTab] ?? TAB_LABELS.browser)}
        onPress={screen.openTabSheet}
        testID={`${testID}-default-tab`}
      />
      <SettingsRow
        title={t('settingsBackup.export')}
        description={t('settingsBackup.exportHint')}
        icon="export-variant"
        onPress={screen.busy ? undefined : screen.exportSettings}
        testID={`${testID}-export`}
      />
      <SettingsRow
        title={t('settingsBackup.import')}
        description={t('settingsBackup.importHint')}
        icon="import"
        onPress={screen.busy ? undefined : screen.importSettings}
        testID={`${testID}-import`}
      />
      <SettingsRow
        title={t('settingsBackup.reset')}
        description={t('settingsBackup.resetHint')}
        icon="restore"
        destructive
        onPress={screen.requestReset}
        showDivider={false}
        testID={`${testID}-reset`}
      />

      <ActionSheetModal
        visible={screen.tabSheetVisible}
        onClose={screen.closeTabSheet}
        title={t('settingsBackup.defaultTab')}
        actions={tabActions}
        testID={`${testID}-default-tab-sheet`}
      />
      <ConfirmModal
        visible={screen.resetConfirmVisible}
        variant="warning"
        title={t('settingsBackup.resetConfirmTitle')}
        message={t('settingsBackup.resetConfirmMessage')}
        confirmLabel={t('settingsBackup.reset')}
        cancelLabel={t('common.cancel')}
        onConfirm={screen.confirmReset}
        onCancel={screen.cancelReset}
        testID={`${testID}-reset-confirm`}
      />
    </SettingsSection>
  );
});
