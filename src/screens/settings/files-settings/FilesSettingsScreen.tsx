import { memo, useCallback, useMemo, useState } from 'react';

import { AppModal } from '@/components/modals/AppModal';
import { DsHeader, DsIcon, DsRow, DsRowGroup, DsScreen, DsSectionLabel } from '@/design';
import {
  FILES_SORT_DIRECTIONS,
  FILES_SORT_KEYS,
  FILES_THUMBNAIL_SIZES,
  FILES_VIEW_MODES,
  GRID_COLUMNS,
  LIST_THUMBNAIL_DP,
  setFilesViewSettings,
  useFilesViewSettings,
  type FilesSortDirection,
  type FilesSortKey,
  type FilesThumbnailSize,
  type FilesViewMode,
} from '@/files/ui/files-view-settings';
import { useTranslation, type TranslationKey } from '@/localization';
import { fileChecksumPath, navigation, routePaths } from '@/navigation';
import { useAndroidBackHandler } from '@/navigation/hooks';
import { updateThemePreference } from '@/services/auth/settings.service';
import { AppearanceSection } from '@/screens/settings/components/AppearanceSection';
import { selectThemeMode, useThemeStore, type ThemePreference } from '@/store/theme';

import { FilePickerModal } from '@/screens/files/components/FilePickerModal';
import { filesCapabilities } from '@/files/api';
import { keepLabel } from '@/files/ui/bin-labels';
import { getBinSettings, setBinSettings } from '@/files/ui/trash-port';
import { useSaveLocationStore } from '@/downloads/v2/save-location-store';

import { ChoiceSheet, type ChoiceOption } from '../browser-settings/ChoiceSheet';

const VIEW_LABELS: Record<FilesViewMode, TranslationKey> = {
  list: 'fileManager.viewList',
  grid: 'fileManager.viewGrid',
};
const SIZE_LABELS: Record<FilesThumbnailSize, TranslationKey> = {
  small: 'fileManager.sizeSmall',
  medium: 'fileManager.sizeMedium',
  large: 'fileManager.sizeLarge',
};
const SORT_LABELS: Record<FilesSortKey, TranslationKey> = {
  name: 'fileManager.sortName',
  date: 'fileManager.sortDate',
  size: 'fileManager.sortSize',
  type: 'fileManager.sortType',
};
const DIRECTION_LABELS: Record<FilesSortDirection, TranslationKey> = {
  asc: 'fileManager.sortAscending',
  desc: 'fileManager.sortDescending',
};
const THEME_LABELS: Record<ThemePreference, TranslationKey> = {
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
  red: 'settings.themeRed',
  cream: 'settings.themeCream',
  midnight: 'settings.themeMidnight',
  blush: 'settings.themeBlush',
};

type Sheet = 'view' | 'size' | null;

/**
 * Design 27 "File manager settings" (Files F2): Settings → File manager, and the ⚙ of every Files screen but the tab.
 * VIEW: View as, Show thumbnails (+ Thumbnail size while on), Show hidden files, Sort by (its own page: Name / Date /
 * Size / Type, Ascending / Descending, Folders first), Show extensions, Accent color (the app's theme picker). SAFETY:
 * Confirm before delete, for Files, the Player tab and Downloads. Every change applies to the Files lists at once and
 * is kept (`files-view-settings.ts`).
 *
 * SAFETY also has F3's "Checksum verify". Later packages add their rows here: F8 "Recycle bin" in SAFETY, Faran's F15
 * the STORAGE ACCESS section and F16 "Open videos with VidoraX".
 */
export const FilesSettingsScreen = memo(function FilesSettingsScreen() {
  const { t } = useTranslation();
  const settings = useFilesViewSettings();
  const themeMode = useThemeStore(selectThemeMode);
  const [sheet, setSheet] = useState<Sheet>(null);
  // F8: the bin's own settings (F13's), shown while its bin is live.
  const [binSettings, setBinSettingsShown] = useState(() => getBinSettings());
  const [sortPage, setSortPage] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [checksumPickerOpen, setChecksumPickerOpen] = useState(false);
  // F7 #946: where new downloads go — the existing save location (Download settings), or VidoraX's own folder.
  const saveLocationEnabled = useSaveLocationStore((s) => s.enabled);
  const saveLocationFolder = useSaveLocationStore((s) => s.folderName);
  const defaultFolder = saveLocationEnabled && saveLocationFolder ? saveLocationFolder : t('filesTab.vidoraxPath');
  const closeSheet = useCallback(() => setSheet(null), []);

  // The Sort by page is part of this screen: Back returns to the settings.
  useAndroidBackHandler({
    enabled: sortPage,
    onBackPress: () => {
      setSortPage(false);
      return true;
    },
  });

  const viewOptions = useMemo(
    (): ChoiceOption<FilesViewMode>[] => FILES_VIEW_MODES.map((mode) => ({ value: mode, label: t(VIEW_LABELS[mode]) })),
    [t],
  );
  const sizeLine = useCallback(
    (size: FilesThumbnailSize) =>
      settings.viewMode === 'grid'
        ? t('fileManager.sizeGridColumns', { size: t(SIZE_LABELS[size]), columns: GRID_COLUMNS[size] })
        : t('fileManager.sizeListDp', { size: t(SIZE_LABELS[size]), dp: LIST_THUMBNAIL_DP[size] }),
    [settings.viewMode, t],
  );
  const sizeOptions = useMemo(
    (): ChoiceOption<FilesThumbnailSize>[] =>
      FILES_THUMBNAIL_SIZES.map((size) => ({ value: size, label: t(SIZE_LABELS[size]), description: sizeLine(size) })),
    [sizeLine, t],
  );
  const sortSummary = t('fileManager.sortSummary', {
    key: t(SORT_LABELS[settings.sortKey]),
    direction: t(DIRECTION_LABELS[settings.sortDirection]),
  });

  const settingsAction = {
    icon: 'settings' as const,
    accessibilityLabel: t('lightBrowserSettings.openAppSettingsA11y'),
    onPress: () => navigation.navigate(routePaths.settings),
    testID: 'files-settings-app-settings',
  };

  if (sortPage) {
    const check = <DsIcon name="check" size={18} color="primary" strokeWidth={2.2} />;
    return (
      <DsScreen edges={['top', 'bottom']} testID="files-sort-screen">
        <DsHeader title={t('fileManager.sortBy')} subtitle={sortSummary} onBack={() => setSortPage(false)} action={settingsAction} />
        <DsSectionLabel first>{t('fileManager.sortBy')}</DsSectionLabel>
        <DsRowGroup testID="files-sort-keys">
          {FILES_SORT_KEYS.map((key) => (
            <DsRow
              key={key}
              title={t(SORT_LABELS[key])}
              trailing={settings.sortKey === key ? check : 'none'}
              accessibilityLabel={settings.sortKey === key ? t('fileManager.selectedA11y', { name: t(SORT_LABELS[key]) }) : t(SORT_LABELS[key])}
              onPress={() => setFilesViewSettings({ sortKey: key })}
              testID={`files-sort-${key}`}
            />
          ))}
        </DsRowGroup>
        <DsSectionLabel>{t('fileManager.sortOrder')}</DsSectionLabel>
        <DsRowGroup testID="files-sort-directions">
          {FILES_SORT_DIRECTIONS.map((direction) => (
            <DsRow
              key={direction}
              title={t(DIRECTION_LABELS[direction])}
              trailing={settings.sortDirection === direction ? check : 'none'}
              accessibilityLabel={
                settings.sortDirection === direction
                  ? t('fileManager.selectedA11y', { name: t(DIRECTION_LABELS[direction]) })
                  : t(DIRECTION_LABELS[direction])
              }
              onPress={() => setFilesViewSettings({ sortDirection: direction })}
              testID={`files-sort-${direction}`}
            />
          ))}
        </DsRowGroup>
        <DsRowGroup>
          <DsRow
            icon="folder"
            title={t('fileManager.foldersFirst')}
            subtitle={t('fileManager.foldersFirstHint')}
            toggle={{ value: settings.foldersFirst, onValueChange: (on) => setFilesViewSettings({ foldersFirst: on }) }}
            testID="files-sort-folders-first"
          />
        </DsRowGroup>
      </DsScreen>
    );
  }

  return (
    <DsScreen edges={['top', 'bottom']} testID="files-settings-screen">
      <DsHeader
        title={t('fileManager.settingsTitle')}
        subtitle={t('fileManager.settingsSub')}
        onBack={() => navigation.back()}
        action={settingsAction}
        testID="files-settings-header"
      />

      <DsSectionLabel first>{t('fileManager.sectionView')}</DsSectionLabel>
      <DsRowGroup testID="files-settings-view">
        <DsRow
          icon="layout-grid"
          title={t('fileManager.viewAs')}
          subtitle={t(VIEW_LABELS[settings.viewMode])}
          onPress={() => setSheet('view')}
          testID="files-settings-view-as"
        />
        <DsRow
          icon="image"
          title={t('fileManager.showThumbnails')}
          toggle={{ value: settings.showThumbnails, onValueChange: (on) => setFilesViewSettings({ showThumbnails: on }) }}
          testID="files-settings-thumbnails"
        />
        {settings.showThumbnails ? (
          <DsRow
            icon="sliders-horizontal"
            title={t('fileManager.thumbnailSize')}
            subtitle={sizeLine(settings.thumbnailSize)}
            onPress={() => setSheet('size')}
            testID="files-settings-thumbnail-size"
          />
        ) : null}
        <DsRow
          icon="eye"
          title={t('fileManager.showHidden')}
          toggle={{
            value: settings.showHidden,
            onValueChange: (on) => setFilesViewSettings({ showHidden: on }),
            accessibilityHint: t('fileManager.showHiddenHint'),
          }}
          testID="files-settings-hidden"
        />
        <DsRow
          icon="arrow-up-down"
          title={t('fileManager.sortBy')}
          subtitle={sortSummary}
          onPress={() => setSortPage(true)}
          testID="files-settings-sort"
        />
        <DsRow
          icon="type"
          title={t('fileManager.showExtensions')}
          subtitle={t('fileManager.showExtensionsHint')}
          toggle={{ value: settings.showExtensions, onValueChange: (on) => setFilesViewSettings({ showExtensions: on }) }}
          testID="files-settings-extensions"
        />
        <DsRow
          icon="folder"
          title={t('fileManager.defaultFolder', { folder: defaultFolder })}
          accessibilityHint={t('fileManager.defaultFolderHint')}
          onPress={() => navigation.push(routePaths.downloadSettings)}
          testID="files-settings-default-folder"
        />
        <DsRow
          icon="palette"
          title={t('fileManager.accentColor')}
          subtitle={t(THEME_LABELS[themeMode])}
          accessibilityHint={t('fileManager.accentColorHint')}
          onPress={() => setThemeOpen(true)}
          testID="files-settings-accent"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('fileManager.sectionSafety')}</DsSectionLabel>
      <DsRowGroup testID="files-settings-safety">
        <DsRow
          icon="alert-triangle"
          title={t('fileManager.confirmDelete')}
          toggle={{
            value: settings.confirmDelete,
            onValueChange: (on) => setFilesViewSettings({ confirmDelete: on }),
            accessibilityHint: t('fileManager.confirmDeleteHint'),
          }}
          testID="files-settings-confirm-delete"
        />
        {/* F8: the Recycle bin on or off, with how long it keeps files — only once F13's bin is live. */}
        {filesCapabilities.recycleBin ? (
          <DsRow
            icon="trash-2"
            title={t('fileManager.binTitle')}
            subtitle={binSettings.enabled ? t(keepLabel(binSettings.keepDays).key, keepLabel(binSettings.keepDays).params) : t('fileManager.binOff')}
            toggle={{
              value: binSettings.enabled,
              onValueChange: (enabled) => {
                setBinSettings({ enabled });
                setBinSettingsShown(getBinSettings());
              },
            }}
            testID="files-settings-recycle-bin"
          />
        ) : null}
        {/* F3 #827: pick a file, then check its SHA-256. */}
        <DsRow
          icon="shield-check"
          title={t('fileManager.checksumVerifyRow')}
          subtitle={t('fileManager.checksumVerifyHint')}
          onPress={() => setChecksumPickerOpen(true)}
          testID="files-settings-checksum"
        />
      </DsRowGroup>

      <ChoiceSheet
        visible={sheet === 'view'}
        title={t('fileManager.viewAs')}
        options={viewOptions}
        value={settings.viewMode}
        onSelect={(viewMode) => {
          setFilesViewSettings({ viewMode });
          closeSheet();
        }}
        onClose={closeSheet}
        testID="files-settings-view-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'size'}
        title={t('fileManager.thumbnailSize')}
        options={sizeOptions}
        value={settings.thumbnailSize}
        onSelect={(thumbnailSize) => {
          setFilesViewSettings({ thumbnailSize });
          closeSheet();
        }}
        onClose={closeSheet}
        testID="files-settings-size-sheet"
      />
      <FilePickerModal
        visible={checksumPickerOpen}
        title={t('fileManager.pickFileTitle')}
        onPick={(file) => {
          setChecksumPickerOpen(false);
          navigation.push(fileChecksumPath(file.id));
        }}
        onClose={() => setChecksumPickerOpen(false)}
      />
      {/* #775 Accent colors: the app's own theme picker (Settings → Appearance); the picked theme colours Files too. */}
      <AppModal visible={themeOpen} onClose={() => setThemeOpen(false)} title={t('fileManager.accentColor')} showCloseButton testID="files-settings-theme">
        <AppearanceSection themeMode={themeMode} onThemeChange={(mode) => void updateThemePreference(mode)} testID="files-settings-theme-picker" />
      </AppModal>
    </DsScreen>
  );
});
