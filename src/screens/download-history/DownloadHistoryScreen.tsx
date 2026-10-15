import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { Switch } from '@/components/inputs/Switch';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { SettingsRow, SettingsSection } from '@/screens/settings/components';
import { useSettingsTokens } from '@/screens/settings/theme/settings-tokens';

import { QueueBackupSection } from './QueueBackupSection';
import { useDownloadHistoryScreen } from './useDownloadHistoryScreen';

const MAX_ERROR_ROWS = 50;
const MAX_DEBUG_ROWS = 200;

function formatWhen(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

/**
 * Download history & logs: Clear History (#415), Export History (#423), Error Log (#421), Debug Logs (#518).
 * This is the Downloads list's history only — browsing History, bookmarks and favorites are never touched.
 */
export const DownloadHistoryScreen = memo(function DownloadHistoryScreen() {
  const theme = useTheme();
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const screen = useDownloadHistoryScreen();
  const goBack = useCallback(() => navigation.back(), []);

  return (
    <SafeAreaScreen
      testID="download-history-screen"
      scrollable
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: settingsTokens.background }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: settingsTokens.spacing.screenX,
        paddingBottom: 40,
        gap: settingsTokens.spacing.sectionGap,
      }}>
      <ScreenHeader title={t('downloadHistory.title')} showBack onBackPress={goBack} testID="download-history-header" />

      <SettingsSection
        testID="download-history-section"
        title={t('downloadHistory.historySection')}
        description={t('downloadHistory.historySectionDescription')}
        icon="history">
        <SettingsRow
          title={t('downloadHistory.exportJson')}
          description={t('downloadHistory.exportJsonHint')}
          icon="code-json"
          onPress={screen.rowCount > 0 && !screen.busy ? () => screen.exportHistory('json') : undefined}
          testID="download-history-export-json"
        />
        <SettingsRow
          title={t('downloadHistory.exportCsv')}
          description={t('downloadHistory.exportCsvHint')}
          icon="file-delimited-outline"
          onPress={screen.rowCount > 0 && !screen.busy ? () => screen.exportHistory('csv') : undefined}
          testID="download-history-export-csv"
        />
        <SettingsRow
          title={t('downloadHistory.clear')}
          description={
            screen.clearableCount > 0
              ? t('downloadHistory.clearHint', { count: screen.clearableCount })
              : t('downloadHistory.clearNothing')
          }
          icon="delete-sweep-outline"
          destructive
          onPress={screen.clearableCount > 0 && !screen.busy ? screen.requestClear : undefined}
          showDivider={false}
          testID="download-history-clear"
        />
      </SettingsSection>

      <QueueBackupSection />

      <SettingsSection
        testID="download-history-errors"
        title={t('downloadHistory.errorLogTitle')}
        description={t('downloadHistory.errorLogDescription')}
        icon="alert-circle-outline">
        {screen.errorLog.length === 0 ? (
          <Box py={12}>
            <Text variant="bodySmall" color="textSecondary">
              {t('downloadHistory.errorLogEmpty')}
            </Text>
          </Box>
        ) : (
          <Box gap={10} py={8}>
            {screen.errorLog.slice(0, MAX_ERROR_ROWS).map((entry) => (
              <Box
                key={entry.id}
                gap={2}
                pb={8}
                style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
                accessible
                accessibilityLabel={`${entry.title}. ${entry.site ?? ''}. ${entry.reason}. ${formatWhen(entry.at)}`}>
                <Text variant="bodySmall" numberOfLines={1}>
                  {entry.title || t('downloadHistory.untitled')}
                </Text>
                <Text variant="caption" color="textSecondary" numberOfLines={1}>
                  {`${formatWhen(entry.at)} · ${entry.site ?? '—'}`}
                </Text>
                <Text variant="caption" color="error" numberOfLines={2}>
                  {entry.reason}
                </Text>
              </Box>
            ))}
            <Button
              title={t('downloadHistory.shareErrorLog')}
              variant="outline"
              size="small"
              leftIcon="share-variant"
              onPress={screen.shareErrorLog}
              testID="download-history-share-errors"
            />
          </Box>
        )}
      </SettingsSection>

      <SettingsSection
        testID="download-history-advanced"
        title={t('downloadHistory.advancedSection')}
        description={t('downloadHistory.advancedDescription')}
        icon="bug-outline">
        <SettingsRow
          title={t('downloadHistory.debugLogs')}
          description={t('downloadHistory.debugLogsHint')}
          icon="text-box-search-outline"
          trailing={
            <Switch
              value={screen.debugEnabled}
              onValueChange={screen.setDebugEnabled}
              accessibilityLabel={t('downloadHistory.debugLogs')}
              accessibilityHint={t('downloadHistory.debugLogsHint')}
              testID="download-history-debug-switch"
            />
          }
          showDivider={false}
          testID="download-history-debug"
        />
        {screen.debugEnabled ? (
          <Box gap={8} py={8}>
            <Box row gap={8} style={{ flexWrap: 'wrap' }}>
              <Button
                title={t('downloadHistory.viewDebugLog')}
                variant="outline"
                size="small"
                onPress={screen.showDebugLog}
                testID="download-history-debug-view"
              />
              <Button
                title={t('downloadHistory.shareDebugLog')}
                variant="outline"
                size="small"
                leftIcon="share-variant"
                onPress={screen.shareDebugLog}
                testID="download-history-debug-share"
              />
              <Button
                title={t('downloadHistory.clearDebugLog')}
                variant="outline"
                size="small"
                onPress={screen.clearDebugLog}
                testID="download-history-debug-clear"
              />
            </Box>
            {screen.debugEntries ? (
              screen.debugEntries.length === 0 ? (
                <Text variant="caption" color="textSecondary">
                  {t('downloadHistory.debugLogEmpty')}
                </Text>
              ) : (
                <Box gap={4}>
                  {screen.debugEntries.slice(-MAX_DEBUG_ROWS).map((entry, index) => (
                    <Text
                      // Entries are append-only snapshots; position plus time is stable for one snapshot.
                      key={`${entry.at}-${index}`}
                      variant="caption"
                      color="textSecondary"
                      style={{ fontFamily: 'monospace' }}>
                      {`${new Date(entry.at).toISOString().slice(11, 19)} [${entry.source}] ${entry.message}`}
                    </Text>
                  ))}
                </Box>
              )
            ) : null}
          </Box>
        ) : null}
      </SettingsSection>

      <ConfirmModal
        visible={screen.clearConfirmVisible}
        variant="delete"
        title={t('downloadHistory.clearConfirmTitle')}
        message={t('downloadHistory.clearConfirmMessage', { count: screen.clearableCount })}
        confirmLabel={t('downloadHistory.clear')}
        cancelLabel={t('common.cancel')}
        onConfirm={screen.confirmClear}
        onCancel={screen.cancelClear}
        testID="download-history-clear-confirm"
      />
    </SafeAreaScreen>
  );
});
