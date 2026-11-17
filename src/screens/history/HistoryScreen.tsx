import { memo, useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, FlatList, Platform, ToastAndroid, View } from 'react-native';

import { ClearBrowsingDataSheet } from '@/browser/history/components/ClearBrowsingDataSheet';
import { HistoryOffBanner } from '@/browser/history/components/HistoryOffBanner';
import { BROWSING_DATA_RANGES, type BrowsingDataRange } from '@/browser/history/browsing-data-range';
import { exportHistoryToFile } from '@/browser/history/history-export.service';
import { historySubtitle } from '@/browser/history/history-highlight';
import { DsChip, DsChipRow, DsHeader, DsRow, DsRowGroup, DsScreen, DsSearchField, DsSectionLabel, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import type { BrowserHistoryEntry } from '@/storage/types';
import { useSettingsStore } from '@/store/settings';

import { HistoryDeleteDialog, HistoryEmptyState, HistoryErrorState, HistorySkeleton } from './components';
import { HistoryDsRow } from './components/HistoryDsRow';
import { useHistoryScreen } from './hooks/useHistoryScreen';
import { formatHistoryClockTime, formatHistoryRelativeTime, groupHistoryByDate, type HistoryDaySection } from './utils/history-format';

/** Design 36's CLEAR chips: Last hour · Today · 7 days · 4 weeks (kept from B10) · All time. */
const RANGE_CHIP_LABELS: Record<BrowsingDataRange, TranslationKey> = {
  hour: 'browserHistory.rangeHour',
  day: 'dataUsage.today',
  week: 'lightHistory.sevenDays',
  fourWeeks: 'lightHistory.fourWeeks',
  all: 'browserHistory.rangeAll',
};

/**
 * Design 36 "History" over B10: header "History / N pages" with ⚙ → Browser settings; the search field (matches
 * highlighted in the rows); one card per day (TODAY, YESTERDAY, the date) of rows "title / host · time" — tap opens
 * the page, long-press removes it; CLEAR chips that open Clear browsing data with that range; then Auto clear on
 * exit, Disable history, Export history and Clear recent searches.
 */
export const HistoryScreen = memo(function HistoryScreen() {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const {
    items,
    total,
    refreshing,
    loadingMore,
    hasMore,
    error,
    status,
    searchDraft,
    deleteTargetId,
    deleting,
    onChangeSearch,
    onSubmitSearch,
    onClearSearch,
    openEntry,
    requestDelete,
    cancelDelete,
    confirmDelete,
    recentSearchTotal,
    clearSearchesVisible,
    clearingSearches,
    openClearSearches,
    cancelClearSearches,
    confirmClearSearches,
    openBrowser,
    refresh,
    loadMore,
    query,
  } = useHistoryScreen();

  const clearOnExit = useSettingsStore((s) => s.clearHistoryOnExit === true);
  const saveHistory = useSettingsStore((s) => s.saveHistory !== false);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  // B10 #98 / #103: clear by time range (the chip that was tapped is the sheet's range), export as CSV.
  const [selectedRange, setSelectedRange] = useState<BrowsingDataRange>('hour');
  const [rangeSheetVisible, setRangeSheetVisible] = useState(false);
  const [exporting, setExporting] = useState(false);

  const sections = useMemo(() => groupHistoryByDate(items), [items]);

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    const notify = (message: string) => {
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      AccessibilityInfo.announceForAccessibility(message);
    };
    try {
      const outcome = await exportHistoryToFile();
      if (outcome === 'empty') notify(t('browserHistory.exportEmpty'));
      else if (outcome === 'saved' || outcome === 'shared') notify(t('browserHistory.exportSaved'));
      else if (outcome === 'failed') notify(t('browserHistory.exportFailed'));
    } catch {
      notify(t('browserHistory.exportFailed'));
    } finally {
      setExporting(false);
    }
  }, [exporting, t]);

  const pickRange = useCallback((range: BrowsingDataRange) => {
    setSelectedRange(range);
    setRangeSheetVisible(true);
  }, []);

  const sectionTitle = useCallback(
    (section: HistoryDaySection): string => {
      if (section.kind === 'today') return t('dataUsage.today');
      if (section.kind === 'yesterday') return t('dates.yesterday');
      const sameYear = section.date.getFullYear() === new Date().getFullYear();
      return new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', {
        day: 'numeric',
        month: 'long',
        ...(sameYear ? {} : { year: 'numeric' }),
      }).format(section.date);
    },
    [language, t],
  );

  const renderSection = useCallback(
    ({ item: section }: { item: HistoryDaySection }) => (
      <View>
        <DsSectionLabel testID={`history-section-${section.key}`}>{sectionTitle(section)}</DsSectionLabel>
        <DsRowGroup>
          {section.data.map((entry: BrowserHistoryEntry) => {
            const title = entry.title || entry.hostname || entry.url;
            const clock = formatHistoryClockTime(entry.visitedAt);
            const host = historySubtitle(entry, query);
            return (
              <HistoryDsRow
                key={entry.id}
                hostname={entry.hostname}
                title={title}
                subtitle={clock ? `${host} · ${clock}` : host}
                query={query}
                onPress={() => openEntry(entry.url)}
                onLongPress={() => requestDelete(entry.id)}
                accessibilityLabel={t('history.itemA11y', { title, url: entry.url, relative: formatHistoryRelativeTime(entry.visitedAt) })}
                accessibilityHint={t('history.openHint')}
                testID={`history-item-${entry.id}`}
              />
            );
          })}
        </DsRowGroup>
      </View>
    ),
    [openEntry, query, requestDelete, sectionTitle, t],
  );

  const pagesCount = new Intl.NumberFormat(language === 'ur' ? 'ur-PK' : 'en-US').format(total);

  const header = (
    <View style={{ gap: ds.space.stack }}>
      <DsHeader
        title={t('history.title')}
        subtitle={total === 1 ? t('lightHistory.pagesOne', { count: pagesCount }) : t('lightHistory.pagesOther', { count: pagesCount })}
        action={{
          icon: 'settings',
          accessibilityLabel: t('lightHistory.settingsA11y'),
          onPress: () => navigation.push(routePaths.browserSettings),
          testID: 'history-settings-button',
        }}
        testID="history-header"
      />
      <DsSearchField
        value={searchDraft}
        onChangeText={onChangeSearch}
        onSubmitEditing={(event) => onSubmitSearch(event.nativeEvent.text)}
        returnKeyType="search"
        placeholder={t('history.searchPlaceholder')}
        actions={searchDraft || query ? [{ icon: 'x', accessibilityLabel: t('lightHistory.clearSearchA11y'), onPress: onClearSearch, testID: 'history-search-clear' }] : undefined}
        testID="history-search-field"
      />
      <HistoryOffBanner />
      {status === 'loading' ? <HistorySkeleton /> : null}
      {status === 'error' && error ? <HistoryErrorState message={error} onRetry={() => void refresh()} /> : null}
      {status === 'empty' ? <HistoryEmptyState onActionPress={openBrowser} /> : null}
      {status === 'empty-search' ? <HistoryEmptyState variant="search" /> : null}
    </View>
  );

  const footer = (
    <View style={{ gap: ds.space.stack }}>
      {loadingMore ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('history.loadingAnnouncement')} /> : null}
      <DsSectionLabel>{t('lightHistory.clear')}</DsSectionLabel>
      <DsChipRow testID="history-clear-chips">
        {BROWSING_DATA_RANGES.map((range) => (
          <DsChip
            key={range}
            label={t(RANGE_CHIP_LABELS[range])}
            selected={range === selectedRange}
            accessibilityLabel={t('lightHistory.rangeChipA11y', { range: t(RANGE_CHIP_LABELS[range]) })}
            onPress={() => pickRange(range)}
            testID={`history-clear-${range}`}
          />
        ))}
      </DsChipRow>
      <DsRowGroup testID="history-settings">
        <DsRow
          icon="trash-2"
          title={t('lightHistory.autoClearOnExit')}
          toggle={{ value: clearOnExit, onValueChange: (next) => updateSetting('clearHistoryOnExit', next), accessibilityLabel: t('browserHistory.clearOnExit') }}
          testID="history-auto-clear"
        />
        <DsRow
          icon="ban"
          title={t('lightHistory.disableHistory')}
          toggle={{ value: !saveHistory, onValueChange: (next) => updateSetting('saveHistory', !next), accessibilityLabel: t('lightHistory.disableHistory') }}
          testID="history-disable"
        />
        <DsRow
          icon="upload"
          title={t('browserHistory.exportHistory')}
          onPress={() => void handleExport()}
          disabled={exporting}
          accessibilityLabel={t('browserHistory.exportA11y')}
          testID="history-export-button"
        />
        {recentSearchTotal > 0 ? (
          <DsRow
            icon="eraser"
            title={t('history.clearSearches')}
            subtitle={t('history.clearSearchesHint')}
            onPress={openClearSearches}
            disabled={clearingSearches}
            testID="history-clear-searches"
          />
        ) : null}
      </DsRowGroup>
    </View>
  );

  return (
    <DsScreen testID="history-screen" scroll={false}>
      <FlatList
        testID="history-list"
        data={status === 'ready' ? sections : []}
        keyExtractor={(section) => section.key}
        renderItem={renderSection}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onEndReached={() => {
          if (!loadingMore && hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24, gap: ds.space.stack }}
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      />

      <HistoryDeleteDialog mode="delete" visible={Boolean(deleteTargetId)} loading={deleting} onConfirm={() => void confirmDelete()} onCancel={cancelDelete} />
      <HistoryDeleteDialog
        mode="clearSearches"
        visible={clearSearchesVisible}
        loading={clearingSearches}
        onConfirm={() => void confirmClearSearches()}
        onCancel={cancelClearSearches}
      />
      <ClearBrowsingDataSheet
        visible={rangeSheetVisible}
        initialRange={selectedRange}
        onClose={() => setRangeSheetVisible(false)}
        testID="history-clear-range"
      />
    </DsScreen>
  );
});
