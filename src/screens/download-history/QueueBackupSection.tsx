import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { SettingsRow, SettingsSection } from '@/screens/settings/components';

import { useQueueBackup } from './useQueueBackup';

/** Download history & logs → Queue backup: export, import and the restored pages to reopen. */
export const QueueBackupSection = memo(function QueueBackupSection() {
  const theme = useTheme();
  const { t } = useTranslation();
  const backup = useQueueBackup();
  const summary = backup.summary;

  return (
    <SettingsSection
      testID="queue-backup-section"
      title={t('queueBackup.section')}
      description={t('queueBackup.sectionDescription')}
      icon="playlist-check">
      <SettingsRow
        title={t('queueBackup.export')}
        description={
          backup.exportCount > 0
            ? t('queueBackup.exportHint', { count: backup.exportCount })
            : t('queueBackup.exportNothing')
        }
        icon="export-variant"
        onPress={backup.exportCount > 0 && !backup.busy ? backup.exportQueue : undefined}
        testID="queue-backup-export"
      />
      <SettingsRow
        title={t('queueBackup.import')}
        description={t('queueBackup.importHint')}
        icon="import"
        onPress={!backup.busy ? backup.importQueue : undefined}
        showDivider={backup.entries.length > 0}
        testID="queue-backup-import"
      />

      {backup.entries.length > 0 ? (
        <Box gap={8} py={8}>
          <Text variant="label" color="textSecondary">
            {t('queueBackup.restoredTitle', { count: backup.entries.length })}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('queueBackup.restoredHint')}
          </Text>
          {backup.entries.map((entry) => (
            <Box
              key={entry.key}
              row
              gap={8}
              pb={8}
              style={{
                alignItems: 'center',
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.divider,
                opacity: entry.openedAt ? 0.6 : 1,
              }}>
              <Box flex={1} style={{ minWidth: 0 }}>
                <Text variant="bodySmall" numberOfLines={1}>
                  {entry.title || entry.pageUrl}
                </Text>
                <Text variant="caption" color="textSecondary" numberOfLines={1}>
                  {entry.quality ? t('queueBackup.chosenQuality', { quality: entry.quality }) : entry.pageUrl}
                </Text>
              </Box>
              <Button
                title={t('queueBackup.open')}
                variant="outline"
                size="small"
                onPress={() => backup.openEntry(entry)}
                accessibilityHint={t('queueBackup.openHint')}
                testID={`queue-backup-open-${entry.key}`}
              />
              <Button
                title={t('common.remove')}
                variant="ghost"
                size="small"
                onPress={() => backup.removeEntry(entry.key)}
                testID={`queue-backup-remove-${entry.key}`}
              />
            </Box>
          ))}
          <Button
            title={t('queueBackup.clearRestored')}
            variant="outline"
            size="small"
            onPress={backup.clearEntries}
            testID="queue-backup-clear"
          />
        </Box>
      ) : null}

      <ConfirmModal
        visible={summary != null}
        variant={summary?.fileError ? 'error' : 'success'}
        title={summary?.fileError ? t('queueBackup.importFailedTitle') : t('queueBackup.summaryTitle')}
        message={
          summary?.fileError ??
          (summary
            ? t('queueBackup.summary', {
                added: summary.added.length,
                duplicates: summary.duplicates,
                refused: summary.refused,
                invalid: summary.invalid,
              })
            : '')
        }
        confirmLabel={t('common.ok')}
        cancelLabel={t('common.close')}
        onConfirm={backup.dismissSummary}
        onCancel={backup.dismissSummary}
        testID="queue-backup-summary"
      />
    </SettingsSection>
  );
});
