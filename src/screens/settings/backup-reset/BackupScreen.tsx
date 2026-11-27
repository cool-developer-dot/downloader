import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { DsButton, DsButtonRow, DsCard, DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel, DsText } from '@/design';
import { intlLocaleForLanguage, useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { announce } from '@/screens/files/announce';

import { BackupPreviewModal } from './BackupPreviewModal';
import { lastBackupLabel } from './backup-screen-model';
import { backUpNow, shareNewestBackup, useLastBackupStore } from './backup-now';
import { useFullBackup } from './useFullBackup';
import { useSettingsBackupReset } from './useSettingsBackupReset';

/**
 * Files F11 · design 62 Backup (`/backup`): the Last backup card ("Today · 2 MB" or "Never"), Back up now (the folder
 * chosen last time) and Restore (the existing preview, then Merge or Replace), Export data ("Save a copy to…", a folder
 * every time), Settings backup (settings only, as before), Send to device (the newest backup through the share sheet),
 * what is included, and "Reset VidoraX…" with the existing reset and its confirmation (the Default tab stays in
 * Settings). All on the
 * existing backup service; nothing about the backup format changes. Cross-device sync, Backup queue and Auto upload are
 * left out (they need a server or an account).
 */
export const BackupScreen = memo(function BackupScreen() {
  const { t, language } = useTranslation();
  const backup = useFullBackup();
  const screen = useSettingsBackupReset();
  const last = useLastBackupStore((state) => state.last);
  const [busy, setBusy] = useState<'now' | 'send' | null>(null);
  const [settingsSheet, setSettingsSheet] = useState(false);
  const lastLabel = lastBackupLabel(last, new Date(), intlLocaleForLanguage(language));

  const runBackUpNow = useCallback(async () => {
    setBusy('now');
    try {
      const result = await backUpNow();
      if (result === 'saved') announce(t('fileManager.backupSaved'));
      else if (result === 'failed') announce(t('fileManager.backupFailed'));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const send = useCallback(async () => {
    setBusy('send');
    try {
      const result = await shareNewestBackup(t('fileManager.backupShareTitle'));
      if (result === 'too-large') announce(t('fileManager.backupTooBigToShare'));
      else if (result === 'failed') announce(t('fileManager.backupFailed'));
    } finally {
      setBusy(null);
    }
  }, [t]);

  const settingsActions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: 'export',
        label: t('settingsBackup.export'),
        onPress: () => {
          setSettingsSheet(false);
          screen.exportSettings();
        },
      },
      {
        id: 'import',
        label: t('settingsBackup.import'),
        onPress: () => {
          setSettingsSheet(false);
          screen.importSettings();
        },
      },
    ],
    [screen, t],
  );
  const anyBusy = busy !== null || backup.busy !== null || Boolean(screen.busy);

  return (
    <DsScreen testID="backup-screen">
      <DsHeader
        title={t('fileManager.backupTitle')}
        onBack={() => navigation.back()}
        action={{
          icon: 'settings',
          accessibilityLabel: t('lightBrowserSettings.openAppSettingsA11y'),
          onPress: () => navigation.navigate(routePaths.settings),
          testID: 'backup-app-settings',
        }}
        testID="backup-header"
      />
      <DsCard testID="backup-last">
        <View style={{ gap: 4 }}>
          <DsText variant="bodyStrong">{t('fileManager.backupLast')}</DsText>
          <DsText variant="rowSub">{t(lastLabel.key, lastLabel.params)}</DsText>
        </View>
      </DsCard>
      <DsButtonRow>
        <DsButton label={t('fileManager.backupNow')} onPress={() => void runBackUpNow()} loading={busy === 'now'} disabled={anyBusy} testID="backup-now" />
        <DsButton
          label={t('fileManager.backupRestore')}
          variant="secondary"
          onPress={backup.pickRestore}
          loading={backup.busy === 'import' || backup.busy === 'restore'}
          disabled={anyBusy}
          testID="backup-restore"
        />
      </DsButtonRow>
      <DsRowGroup testID="backup-rows">
        <DsRow
          icon="upload"
          title={t('fileManager.backupExport')}
          subtitle={t('fileManager.backupExportSub')}
          onPress={anyBusy ? undefined : backup.exportAll}
          testID="backup-export"
        />
        <DsRow
          icon="settings"
          title={t('fileManager.backupSettings')}
          subtitle={t('fileManager.backupSettingsSub')}
          onPress={anyBusy ? undefined : () => setSettingsSheet(true)}
          testID="backup-settings"
        />
        <DsRow
          icon="smartphone"
          title={t('fileManager.backupSend')}
          subtitle={t('fileManager.backupSendSub')}
          onPress={anyBusy ? undefined : () => void send()}
          testID="backup-send"
        />
      </DsRowGroup>
      <DsText variant="rowSub" testID="backup-includes">
        {t('fileManager.backupIncludes')}
      </DsText>

      <DsSectionLabel>{t('settingsBackup.reset')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow
          icon="rotate-cw"
          title={t('fileManager.backupReset')}
          subtitle={t('settingsBackup.resetHint')}
          destructive
          onPress={anyBusy ? undefined : screen.requestReset}
          disabled={anyBusy}
          testID="backup-reset"
        />
      </DsRowGroup>

      <BackupPreviewModal preview={backup.pending?.preview ?? null} onChoose={backup.chooseMode} onCancel={backup.cancelRestore} testID="backup-preview" />
      <ActionSheetModal
        visible={settingsSheet}
        onClose={() => setSettingsSheet(false)}
        title={t('fileManager.backupSettings')}
        actions={settingsActions}
        testID="backup-settings-sheet"
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
        testID="backup-reset-confirm"
      />
    </DsScreen>
  );
});
