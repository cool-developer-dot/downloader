import { memo } from 'react';

import { useTranslation } from '@/localization';
import { SettingsRow } from '@/screens/settings/components/SettingsRow';

import { BackupPreviewModal } from './BackupPreviewModal';
import { useFullBackup } from './useFullBackup';

/**
 * P11 #700, in Settings → Backup & reset next to Export / Import settings (which stay as they are): one file with the
 * settings, the Player's and the Library's choices, playlists, video bookmarks and play counts; and its restore, with
 * a preview, Merge or Replace, and a confirm.
 */
export const FullBackupRows = memo(function FullBackupRows({ testID = 'settings-full-backup' }: { testID?: string }) {
  const { t } = useTranslation();
  const backup = useFullBackup();

  return (
    <>
      <SettingsRow
        title={t('privacyBackup.backupAll')}
        description={t('privacyBackup.backupAllHint')}
        icon="database-export-outline"
        onPress={backup.busy ? undefined : backup.exportAll}
        testID={`${testID}-export`}
      />
      <SettingsRow
        title={t('privacyBackup.restoreAll')}
        description={t('privacyBackup.restoreAllHint')}
        icon="database-import-outline"
        onPress={backup.busy ? undefined : backup.pickRestore}
        testID={`${testID}-import`}
      />
      <BackupPreviewModal
        preview={backup.pending?.preview ?? null}
        onChoose={backup.chooseMode}
        onCancel={backup.cancelRestore}
        testID={`${testID}-preview`}
      />
    </>
  );
});
