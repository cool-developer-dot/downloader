import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { DsCard, DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel, DsStatCard, DsText, ds } from '@/design';
import { refreshDataUsageSummary, useDataUsageStore } from '@/downloads/v2/data-usage-store';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useQueueBackup } from '@/screens/download-history/useQueueBackup';
import { formatDownloadFileSize } from '@/screens/downloads/utils/download-format';
import { useNotAvailableYet } from '@/screens/settings/download-settings/light/useNotAvailableYet';
import { useDownloadsStore } from '@/store/downloads';
import { selectDataLimitDailyMb, useSettingsStore } from '@/store/settings';

const MIB = 1024 * 1024;

function bytesLabel(bytes: number): string {
  return formatDownloadFileSize(String(Math.max(0, Math.round(bytes)))) ?? '0 B';
}

/**
 * Design 15 "Statistics": today / month / total from the data-usage counters (H6) and the downloads store, the
 * largest download, the data limit alert (#422), the history & logs screen (H13), and the AUTOMATION rows.
 */
export const StatisticsScreen = memo(function StatisticsScreen() {
  const { t } = useTranslation();
  const notYet = useNotAvailableYet();
  const summary = useDataUsageStore((state) => state.summary);
  const dailyMb = useSettingsStore(selectDataLimitDailyMb);
  const engineRowsById = useDownloadsStore((state) => state.engineRowsById);
  const itemsById = useDownloadsStore((state) => state.itemsById);
  const backup = useQueueBackup();
  const [queueSheet, setQueueSheet] = useState(false);

  useEffect(() => {
    refreshDataUsageSummary();
  }, []);

  const { totalCount, largest } = useMemo(() => {
    const rows = new Map<string, { title: string; size: number }>();
    for (const [id, item] of [...Object.entries(itemsById), ...Object.entries(engineRowsById)]) {
      const size = Number(item.fileSize);
      rows.set(id, { title: item.title?.trim() || item.fileName?.trim() || t('downloads.untitled'), size: Number.isFinite(size) ? size : 0 });
    }
    let best: { title: string; size: number } | null = null;
    for (const row of rows.values()) {
      if (row.size > 0 && (!best || row.size > best.size)) {
        best = row;
      }
    }
    return { totalCount: rows.size, largest: best };
  }, [engineRowsById, itemsById, t]);

  const goBack = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.downloadSettings), []);
  const openDataUsage = useCallback(() => navigation.push(routePaths.dataUsage), []);
  const openHistory = useCallback(() => navigation.push(routePaths.downloadHistory), []);
  const openGrabber = useCallback(() => navigation.push(routePaths.downloadsLinkGrabber), []);

  const toggleDataLimit = useCallback(
    (value: boolean) => {
      if (value) {
        // A limit needs a number: the editor asks for it.
        openDataUsage();
        return;
      }
      const update = useSettingsStore.getState().updateSetting;
      update('dataLimitDailyMb', 0);
      update('dataLimitMonthlyMb', 0);
    },
    [openDataUsage],
  );

  const queueActions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: 'export',
        label: t('queueBackup.export'),
        icon: 'export-variant',
        onPress: () => {
          setQueueSheet(false);
          if (backup.exportCount > 0 && !backup.busy) backup.exportQueue();
        },
      },
      {
        id: 'import',
        label: t('queueBackup.import'),
        icon: 'import',
        onPress: () => {
          setQueueSheet(false);
          if (!backup.busy) backup.importQueue();
        },
      },
    ],
    [backup, t],
  );

  const importSummary = backup.summary;

  return (
    <DsScreen testID="downloads-statistics-screen">
      <DsHeader
        title={t('lightStatistics.title')}
        onBack={goBack}
        action={{ icon: 'settings', accessibilityLabel: t('lightDetails.settingsA11y'), onPress: openSettings }}
      />
      <View style={{ flexDirection: 'row', gap: ds.space.grid }}>
        <DsStatCard value={bytesLabel(summary.todayBytes)} label={t('lightStatistics.today')} testID="downloads-statistics-today" />
        <DsStatCard value={bytesLabel(summary.monthBytes)} label={t('lightStatistics.month')} testID="downloads-statistics-month" />
        <DsStatCard value={String(totalCount)} label={t('lightStatistics.total')} testID="downloads-statistics-total" />
      </View>
      <DsCard testID="downloads-statistics-largest">
        <DsText variant="cardTitle">{t('lightStatistics.largestDownload')}</DsText>
        <DsText variant="body" color="textPrimary" numberOfLines={1} style={{ marginTop: 4 }}>
          {largest
            ? t('lightStatistics.largestLine', { title: largest.title, size: formatDownloadFileSize(String(largest.size)) ?? t('lightStatistics.none') })
            : t('lightStatistics.none')}
        </DsText>
      </DsCard>
      <DsRowGroup>
        <DsRow
          icon="bell"
          title={t('lightStatistics.dataLimitAlert')}
          subtitle={dailyMb > 0 ? t('lightStatistics.perDay', { limit: bytesLabel(dailyMb * MIB) }) : t('common.off')}
          toggle={{ value: dailyMb > 0, onValueChange: toggleDataLimit, accessibilityLabel: t('lightStatistics.dataLimitAlert') }}
          onPress={openDataUsage}
          testID="downloads-statistics-data-limit"
        />
        <DsRow icon="file-text" title={t('lightStatistics.historyExportClear')} onPress={openHistory} testID="downloads-statistics-history" />
        <DsRow icon="bug" title={t('lightStatistics.errorLogDebug')} onPress={openHistory} testID="downloads-statistics-errors" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightStatistics.automation')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="link" title={t('lightStatistics.pageLinkGrabber')} onPress={openGrabber} testID="downloads-statistics-grabber" />
        <DsRow icon="layers" title={t('lightStatistics.patternDownload')} onPress={openGrabber} testID="downloads-statistics-pattern" />
        <DsRow icon="cpu" title={t('lightStatistics.apiCliBridge')} onPress={notYet} testID="downloads-statistics-api" />
        <DsRow icon="upload" title={t('lightStatistics.exportImportQueue')} onPress={() => setQueueSheet(true)} testID="downloads-statistics-queue-backup" />
      </DsRowGroup>

      <ActionSheetModal
        visible={queueSheet}
        onClose={() => setQueueSheet(false)}
        title={t('queueBackup.section')}
        subtitle={backup.exportCount > 0 ? t('queueBackup.exportHint', { count: backup.exportCount }) : t('queueBackup.exportNothing')}
        actions={queueActions}
        testID="downloads-statistics-queue-sheet"
      />
      <ConfirmModal
        visible={importSummary != null}
        variant={importSummary?.fileError ? 'error' : 'success'}
        title={importSummary?.fileError ? t('queueBackup.importFailedTitle') : t('queueBackup.summaryTitle')}
        message={
          importSummary?.fileError ??
          (importSummary
            ? t('queueBackup.summary', {
                added: importSummary.added.length,
                duplicates: importSummary.duplicates,
                refused: importSummary.refused,
                invalid: importSummary.invalid,
              })
            : '')
        }
        confirmLabel={t('common.ok')}
        cancelLabel={t('common.close')}
        onConfirm={backup.dismissSummary}
        onCancel={backup.dismissSummary}
        testID="downloads-statistics-queue-summary"
      />
    </DsScreen>
  );
});
