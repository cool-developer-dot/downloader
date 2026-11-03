import { memo, useCallback, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import type { BackupCounts, BrowserBackup } from '@/browser/data/data-backup';
import {
  backUpBrowserData,
  exportProfileData,
  pickBackupFile,
  restoreBrowserBackup,
} from '@/browser/profiles/data-transfer.service';
import { announceProfileMessage } from '@/browser/profiles/profile-feedback';
import { GUEST_PROFILE, MAX_PROFILES } from '@/browser/profiles/profile-registry';
import { useProfilesStore } from '@/browser/profiles/profile-service';
import { useProfileActions } from '@/browser/profiles/use-profile-actions';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { SettingsRow, SettingsSection } from '../components';

type Busy = 'backup' | 'restore' | 'export' | null;

/**
 * B20 — Browser settings → Back up and export: #209 Backup and restore (every profile, one file the user keeps)
 * and #210 Export data (the active profile's bookmarks and history in formats other apps read). Not shown in guest
 * mode: a backup holds every profile.
 */
export const BrowserDataSection = memo(function BrowserDataSection() {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const activeId = useProfilesStore((s) => s.activeId);
  const profiles = useProfilesStore((s) => s.profiles);
  const { defaultName, displayName } = useProfileActions();
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<{ backup: BrowserBackup; counts: BackupCounts } | null>(null);

  const run = useCallback(async (kind: Exclude<Busy, null>, task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      await task();
    } catch {
      announceProfileMessage(kind === 'restore' ? t('browserProfiles.restoreFailed') : t('browserProfiles.backupFailed'));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [t]);

  if (activeId === GUEST_PROFILE) return null;

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const activeName = displayName(active);

  const backup = () =>
    void run('backup', async () => {
      const result = await backUpBrowserData(t('browserProfiles.backupTitle'));
      if (result === 'saved') announceProfileMessage(t('browserProfiles.backupSaved'));
      else if (result === 'shared') announceProfileMessage(t('browserProfiles.backupShared'));
      else if (result === 'failed') announceProfileMessage(t('browserProfiles.backupFailed'));
    });

  const pickRestore = () =>
    void run('restore', async () => {
      const picked = await pickBackupFile();
      if (picked.status === 'picked') {
        setPending({ backup: picked.backup, counts: picked.counts });
        return;
      }
      if (picked.status === 'cancelled') return;
      const key =
        picked.status === 'not-backup'
          ? 'browserProfiles.notBackup'
          : picked.status === 'newer-version'
            ? 'browserProfiles.newerBackup'
            : picked.status === 'too-large'
              ? 'browserProfiles.tooLarge'
              : 'browserProfiles.readFailed';
      announceProfileMessage(t(key));
    });

  const confirmRestore = () => {
    const chosen = pending;
    setPending(null);
    if (!chosen) return;
    void run('restore', async () => {
      const summary = await restoreBrowserBackup(chosen.backup, defaultName);
      const done = t('browserProfiles.restored', {
        bookmarks: summary.bookmarks,
        history: summary.history,
        settings: summary.settings,
      });
      announceProfileMessage(
        summary.profilesSkipped > 0
          ? `${done} ${t('browserProfiles.restoredSkipped', { count: summary.profilesSkipped, max: MAX_PROFILES })}`
          : done,
      );
    });
  };

  const exportData = () =>
    void run('export', async () => {
      const result = await exportProfileData(activeId, {
        folderName: t('browserProfiles.exportFolder', { name: activeName }),
        csvHeaders: {
          title: t('browserProfiles.csvTitle'),
          url: t('browserProfiles.csvUrl'),
          visitedAt: t('browserProfiles.csvVisited'),
        },
        shareTitle: t('browserProfiles.exportTitle'),
      });
      if (result === 'saved') announceProfileMessage(t('browserProfiles.exported'));
      else if (result === 'failed') announceProfileMessage(t('browserProfiles.exportFailed'));
    });

  const spinner = <ActivityIndicator size="small" color={theme.colors.primary} />;
  const madeOn = pending
    ? new Date(pending.backup.exportedAt).toLocaleDateString(language === 'ur' ? 'ur-PK' : 'en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  return (
    <SettingsSection
      testID="browser-settings-data"
      title={t('browserProfiles.dataSection')}
      description={t('browserProfiles.dataSectionDescription')}
      icon="backup-restore">
      <SettingsRow
        title={t('browserProfiles.backup')}
        description={t('browserProfiles.backupHint')}
        icon="archive-arrow-down-outline"
        onPress={busy ? undefined : backup}
        trailing={busy === 'backup' ? spinner : undefined}
        testID="browser-settings-backup"
      />
      <SettingsRow
        title={t('browserProfiles.restore')}
        description={t('browserProfiles.restoreHint')}
        icon="restore"
        onPress={busy ? undefined : pickRestore}
        trailing={busy === 'restore' ? spinner : undefined}
        testID="browser-settings-restore"
      />
      <SettingsRow
        title={t('browserProfiles.exportData')}
        description={t('browserProfiles.exportDataHint', { name: activeName })}
        icon="file-export-outline"
        showDivider={false}
        onPress={busy ? undefined : exportData}
        trailing={busy === 'export' ? spinner : undefined}
        testID="browser-settings-export"
      />
      <ConfirmModal
        visible={pending != null}
        variant="warning"
        title={t('browserProfiles.restoreTitle')}
        message={
          pending
            ? t('browserProfiles.restoreMessage', {
                date: madeOn,
                profiles: pending.counts.profiles,
                bookmarks: pending.counts.bookmarks,
                history: pending.counts.history,
              })
            : ''
        }
        confirmLabel={t('browserProfiles.restoreConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmRestore}
        onCancel={() => setPending(null)}
        testID="browser-settings-restore-confirm"
      />
    </SettingsSection>
  );
});
