import { memo, useMemo } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { DEFAULT_TABS, type DefaultTab } from '@/navigation/helpers/default-tab';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { navigation, routePaths } from '@/navigation';
import { SettingsRow } from '@/screens/settings/components/SettingsRow';
import { SettingsSection } from '@/screens/settings/components/SettingsSection';

import { useSettingsBackupReset } from './useSettingsBackupReset';

const TAB_LABELS: Record<DefaultTab, TranslationKey> = {
  browser: 'settingsBackup.tabBrowser',
  downloads: 'settingsBackup.tabDownloads',
  player: 'settingsBackup.tabPlayer',
};

/**
 * Settings → Start & backup: the Default tab, and "Backup & reset", which opens the Backup page of design 62 (Files
 * F11 moved Settings backup, Back up all data, Restore and Reset there).
 */
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
        title={t('fileManager.backupRow')}
        description={t('fileManager.backupRowHint')}
        icon="database-export-outline"
        onPress={() => navigation.push(routePaths.backup)}
        showDivider={false}
        testID={`${testID}-open`}
      />

      <ActionSheetModal
        visible={screen.tabSheetVisible}
        onClose={screen.closeTabSheet}
        title={t('settingsBackup.defaultTab')}
        actions={tabActions}
        testID={`${testID}-default-tab-sheet`}
      />
    </SettingsSection>
  );
});
