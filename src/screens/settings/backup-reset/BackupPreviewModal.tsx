import { memo } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { AppModal } from '@/components/modals/AppModal';
import { useTranslation, type TranslationKey } from '@/localization';
import type { BackupPreview, BackupPreviewRow } from '@/backup/backup-format';
import type { RestoreMode } from '@/backup/backup-restore';

const ROW_KEYS: Record<BackupPreviewRow['section'], TranslationKey> = {
  settings: 'privacyBackup.previewSettings',
  preferences: 'privacyBackup.previewPreferences',
  loops: 'privacyBackup.previewLoops',
  hiddenFolders: 'privacyBackup.previewHiddenFolders',
  playlists: 'privacyBackup.previewPlaylists',
  videoBookmarks: 'privacyBackup.previewBookmarks',
  playStats: 'privacyBackup.previewPlayCounts',
};

export type BackupPreviewModalProps = {
  preview: BackupPreview | null;
  onChoose: (mode: RestoreMode) => void;
  onCancel: () => void;
  testID?: string;
};

/**
 * P11 #700: what a backup file holds — every section with its count, when it was made — before anything is written.
 * Merge or Replace (then a confirm), or Cancel.
 */
export const BackupPreviewModal = memo(function BackupPreviewModal({
  preview,
  onChoose,
  onCancel,
  testID = 'backup-preview',
}: BackupPreviewModalProps) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  if (!preview) {
    return null;
  }
  const made = preview.exportedAt ? preview.exportedAt.slice(0, 10) : null;

  return (
    <AppModal visible onClose={onCancel} showCloseButton={false} testID={testID}>
      <Box gap={14}>
        <Text variant="title">{t('privacyBackup.previewTitle')}</Text>
        <ScrollView style={{ maxHeight: height * 0.5, flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
          {made ? (
            <Text variant="bodySmall" color="textSecondary">
              {t('privacyBackup.previewMade', { date: made })}
            </Text>
          ) : null}
          {preview.settingsOnly ? (
            <Text variant="bodySmall" color="textSecondary">
              {t('privacyBackup.previewSettingsOnly')}
            </Text>
          ) : null}
          {preview.empty ? (
            <Text variant="body">{t('privacyBackup.previewEmpty')}</Text>
          ) : (
            preview.rows.map((row) => (
              <Text key={row.section} variant="body" testID={`${testID}-${row.section}`}>
                {row.section === 'playlists'
                  ? t(ROW_KEYS[row.section], { count: row.count, videos: row.videos })
                  : t(ROW_KEYS[row.section], { count: row.count })}
              </Text>
            ))
          )}
          <Text variant="caption" color="textSecondary">
            {t('privacyBackup.previewNever')}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('privacyBackup.mergeHint')}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('privacyBackup.replaceHint')}
          </Text>
        </ScrollView>
        <Box gap={10}>
          <Button
            title={t('privacyBackup.merge')}
            onPress={() => onChoose('merge')}
            disabled={preview.empty}
            fullWidth
            testID={`${testID}-merge`}
          />
          <Button
            title={t('privacyBackup.replace')}
            variant="destructive"
            onPress={() => onChoose('replace')}
            disabled={preview.empty}
            fullWidth
            testID={`${testID}-replace`}
          />
          <Button title={t('common.cancel')} variant="outline" onPress={onCancel} fullWidth testID={`${testID}-cancel`} />
        </Box>
      </Box>
    </AppModal>
  );
});
