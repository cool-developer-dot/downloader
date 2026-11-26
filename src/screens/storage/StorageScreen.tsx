import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { ds, DsButton, DsCard, DsChip, DsChipRow, DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel, DsText } from '@/design';
import { useSaveLocationStore } from '@/downloads/v2/save-location-store';
import { useLeftoverFiles } from '@/downloads/v2/leftovers';
import { filesCapabilities } from '@/files/api';
import { getLowSpaceSettings, planOneTapClean, runClean, setLowSpaceSettings, useLowSpace } from '@/files/ui/cleanup-port';
import { storageBarParts, type StoragePart } from '@/files/ui/storage-bar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { filesSearchWithPath, filesTypeBySizePath, navigation, routePaths } from '@/navigation';
import { announce } from '@/screens/files/announce';
import { useFilesSettingsAction } from '@/screens/files/hooks/use-files-settings-action';
import { useStorageOverview } from '@/screens/files/hooks/use-files-data';
import { formatFileBytes } from '@/screens/files/utils/file-rows';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';
import { useStorageManager } from '@/storage-manager';

import { LeftoverFilesCard } from './components/LeftoverFilesCard';

type CleanPlan = Awaited<ReturnType<typeof planOneTapClean>>;

/** Low space alert's limits: 500 MB, 1 GB or 2 GB. */
const LOW_SPACE_LIMITS = ['524288000', '1073741824', '2147483648'] as const;
type LowSpaceLimit = (typeof LOW_SPACE_LIMITS)[number];

const PART_LABELS: Record<StoragePart, TranslationKey> = {
  vidorax: 'fileManager.storageVidorax',
  other: 'fileManager.storageOtherApps',
  free: 'fileManager.storageFree',
};

/**
 * Files F9 · design 59 Storage: "{free} free of {total}", a bar in three parts (VidoraX, other apps, free) with its
 * legend, each type's size (opening its list biggest first), Largest files, Duplicates (F14), the FILTERS chips, and a
 * cleaning card — one-tap clean (F14's plan; the existing Clear cache and leftover parts stay inside it), Clean
 * downloads (#856) and Low space alert. The download location stays at the bottom as a row.
 */
export const StorageScreen = memo(function StorageScreen() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const settingsAction = useFilesSettingsAction();
  const { data, refreshing, refresh } = useStorageOverview();
  const manager = useStorageManager();
  const leftovers = useLeftoverFiles();
  const lowSpace = useLowSpace();
  const [lowSpaceOn, setLowSpaceOn] = useState(() => getLowSpaceSettings().enabled);
  const [plan, setPlan] = useState<CleanPlan | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [confirmCache, setConfirmCache] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const saveLocationEnabled = useSaveLocationStore((s) => s.enabled);
  const saveLocationFolder = useSaveLocationStore((s) => s.folderName);

  const loadPlan = useCallback(() => {
    void planOneTapClean()
      .then(setPlan)
      .catch(() => setPlan(null));
  }, []);
  useFocusEffect(loadPlan);

  const refreshAll = useCallback(() => {
    void refresh();
    manager.refresh();
    void leftovers.refresh();
    loadPlan();
  }, [leftovers, loadPlan, manager, refresh]);

  const space = data.space;
  const parts = useMemo(() => (space ? storageBarParts(space) : null), [space]);
  const size = (bytes: number | null | undefined) => formatFileBytes(bytes ?? 0) ?? '0 B';
  const counts = data.counts;

  const clean = useCallback(async () => {
    if (!plan || plan.total <= 0) return;
    setCleaning(true);
    try {
      const { freedBytes } = await runClean(plan);
      announce(t('fileManager.oneTapFreed', { size: formatFileBytes(freedBytes) ?? '0 B' }));
    } catch {
      announce(t('fileManager.binFailed'));
    } finally {
      setCleaning(false);
      refreshAll();
    }
  }, [plan, refreshAll, t]);

  const limitOptions = useMemo<ChoiceOption<LowSpaceLimit>[]>(
    () => LOW_SPACE_LIMITS.map((value) => ({ value, label: formatFileBytes(Number(value)) ?? value })),
    [],
  );
  const limitValue = (LOW_SPACE_LIMITS.find((value) => Number(value) === lowSpace.thresholdBytes) ?? LOW_SPACE_LIMITS[1]) as LowSpaceLimit;
  const planLines = plan
    ? (
        [
          ['fileManager.planCache', plan.cacheBytes],
          ['fileManager.planLeftovers', plan.leftoverBytes],
          ['fileManager.planTemp', plan.tempBytes],
          ['fileManager.planBinExpired', plan.binExpiredBytes],
        ] as const
      ).filter(([, bytes]) => bytes > 0)
    : [];

  return (
    <DsScreen refreshing={refreshing || manager.refreshing} onRefresh={refreshAll} testID="storage-screen">
      <DsHeader
        title={t('fileManager.storageTitle')}
        subtitle={space ? t('fileManager.storageFreeOf', { free: size(space.freeBytes), total: size(space.totalBytes) }) : undefined}
        onBack={() => navigation.back()}
        action={settingsAction}
        testID="storage-header"
      />

      {lowSpace.low ? (
        <DsCard testID="storage-low-space">
          <DsText variant="bodyStrong" color="error">
            {t('fileManager.lowSpaceNow', { free: size(lowSpace.freeBytes) })}
          </DsText>
        </DsCard>
      ) : null}

      <DsCard testID="storage-bar">
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={
            parts && space
              ? t('fileManager.storageBarA11y', {
                  vidorax: size(parts[0]!.bytes),
                  other: size(parts[1]!.bytes),
                  free: size(parts[2]!.bytes),
                })
              : undefined
          }
          style={{ height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: rtl.rowDirection, backgroundColor: theme.colors.surfacePressed }}>
          {parts
            ? parts.map((part) => (
                <View
                  key={part.part}
                  style={{
                    width: `${part.percent}%`,
                    backgroundColor:
                      part.part === 'vidorax' ? theme.colors.primary : part.part === 'other' ? theme.colors.textSecondary : theme.colors.surfacePressed,
                  }}
                />
              ))
            : null}
        </View>
        {parts ? (
          <View style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', gap: 12, marginTop: 10 }} importantForAccessibility="no-hide-descendants">
            {parts.map((part) => (
              <View key={part.part} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor:
                      part.part === 'vidorax' ? theme.colors.primary : part.part === 'other' ? theme.colors.textSecondary : theme.colors.surfacePressed,
                    borderWidth: part.part === 'free' ? 1 : 0,
                    borderColor: theme.colors.border,
                  }}
                />
                <DsText variant="rowSub">{t('fileManager.storageLegendItem', { name: t(PART_LABELS[part.part]), size: size(part.bytes) })}</DsText>
              </View>
            ))}
          </View>
        ) : null}
      </DsCard>

      <DsRowGroup testID="storage-types">
        <DsRow icon="film" title={t('filesTab.videos')} subtitle={size(counts?.video.bytes)} onPress={() => navigation.push(filesTypeBySizePath('video'))} testID="storage-videos" />
        <DsRow icon="music" title={t('filesTab.audio')} subtitle={size(counts?.audio.bytes)} onPress={() => navigation.push(filesTypeBySizePath('audio'))} testID="storage-audio" />
        <DsRow icon="image" title={t('filesTab.images')} subtitle={size(counts?.image.bytes)} onPress={() => navigation.push(filesTypeBySizePath('image'))} testID="storage-images" />
        <DsRow
          icon="archive"
          title={t('fileManager.storageArchivesApks')}
          subtitle={size((counts?.archive.bytes ?? 0) + (counts?.apk.bytes ?? 0))}
          onPress={() => navigation.push(filesSearchWithPath({ types: ['archive', 'apk'], sort: 'size' }))}
          testID="storage-archives"
        />
        <DsRow
          icon="sliders-vertical"
          title={t('fileManager.storageLargest')}
          subtitle={t('fileManager.storageView')}
          onPress={() => navigation.push(filesSearchWithPath({ sort: 'size' }))}
          testID="storage-largest"
        />
        {filesCapabilities.duplicates ? (
          <DsRow
            icon="layers"
            title={t('fileManager.storageDuplicates')}
            subtitle={t('fileManager.storageCleanUp')}
            onPress={() => navigation.push(routePaths.filesDuplicates)}
            testID="storage-duplicates"
          />
        ) : null}
      </DsRowGroup>

      <DsSectionLabel>{t('fileManager.storageFilters')}</DsSectionLabel>
      <DsChipRow>
        <DsChip label={t('fileManager.filterOver100')} onPress={() => navigation.push(filesSearchWithPath({ minMb: 100, sort: 'size' }))} testID="storage-filter-large" />
        <DsChip label={t('fileManager.filterOld')} onPress={() => navigation.push(filesSearchWithPath({ oldMonths: 6 }))} testID="storage-filter-old" />
        {filesCapabilities.duplicates ? (
          <DsChip label={t('fileManager.filterDuplicate')} onPress={() => navigation.push(routePaths.filesDuplicates)} testID="storage-filter-duplicate" />
        ) : null}
      </DsChipRow>

      <DsSectionLabel>{t('fileManager.storageCleaning')}</DsSectionLabel>
      <DsCard testID="storage-one-tap">
        <View style={{ gap: 8 }}>
          <DsText variant="bodyStrong">{t('fileManager.oneTapClean')}</DsText>
          <DsText variant="rowSub">{t('fileManager.oneTapCleanHint')}</DsText>
          {planLines.map(([key, bytes]) => (
            <DsText key={key} variant="body">
              {t(key, { size: size(bytes) })}
            </DsText>
          ))}
          <DsButton
            label={plan && plan.total > 0 ? t('fileManager.oneTapCleanButton', { total: size(plan.total) }) : t('fileManager.oneTapNothing')}
            onPress={() => void clean()}
            disabled={!plan || plan.total <= 0 || cleaning}
            loading={cleaning}
            fullWidth
            testID="storage-one-tap-clean"
          />
        </View>
      </DsCard>
      <DsRowGroup testID="storage-clean-rows">
        {/* The existing Clear cache stays inside one-tap clean. */}
        <DsRow
          icon="eraser"
          title={t('storage.clearCache')}
          onPress={() => setConfirmCache(true)}
          disabled={manager.clearingCache}
          testID="storage-clear-cache"
        />
        <DsRow
          icon="list-checks"
          title={t('fileManager.cleanDownloads')}
          subtitle={t('fileManager.cleanDownloadsHint')}
          onPress={() => navigation.push(routePaths.filesCleanDownloads)}
          testID="storage-clean-downloads"
        />
        <DsRow
          icon="bell"
          title={t('fileManager.lowSpace')}
          subtitle={t('fileManager.lowSpaceSub', { size: size(lowSpace.thresholdBytes) })}
          toggle={{
            value: lowSpaceOn,
            onValueChange: (enabled) => {
              setLowSpaceSettings({ enabled });
              setLowSpaceOn(enabled);
            },
          }}
          testID="storage-low-space-switch"
        />
        <DsRow
          icon="gauge"
          title={t('fileManager.lowSpaceLimit')}
          value={size(lowSpace.thresholdBytes)}
          onPress={() => setLimitOpen(true)}
          testID="storage-low-space-limit"
        />
      </DsRowGroup>
      {/* The existing leftover-parts card, also part of the cleaning. */}
      <LeftoverFilesCard state={leftovers} onCleaned={manager.refresh} />

      <DsRowGroup style={{ marginTop: ds.space.stack }} testID="storage-location">
        <DsRow
          icon="folder"
          title={t('fileManager.downloadLocation')}
          subtitle={saveLocationEnabled && saveLocationFolder ? saveLocationFolder : t('filesTab.vidoraxPath')}
          onPress={() => navigation.push(routePaths.downloadSettings)}
          testID="storage-download-location"
        />
      </DsRowGroup>

      <ConfirmModal
        visible={confirmCache}
        variant="delete"
        title={t('storage.clearCacheTitle')}
        message={t('storage.clearCacheMessage')}
        confirmLabel={t('storage.clearCacheConfirm')}
        cancelLabel={t('common.cancel')}
        loading={manager.clearingCache}
        onConfirm={() => {
          void manager.clearCache().finally(() => {
            setConfirmCache(false);
            loadPlan();
          });
        }}
        onCancel={() => setConfirmCache(false)}
        testID="storage-clear-cache-confirm"
      />
      <ChoiceSheet
        visible={limitOpen}
        title={t('fileManager.lowSpaceLimit')}
        options={limitOptions}
        value={limitValue}
        onSelect={(value) => {
          setLowSpaceSettings({ thresholdBytes: Number(value) });
          setLimitOpen(false);
        }}
        onClose={() => setLimitOpen(false)}
        testID="storage-low-space-sheet"
      />
    </DsScreen>
  );
});
