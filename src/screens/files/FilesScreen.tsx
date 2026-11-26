import { memo, useCallback } from 'react';
import { ToastAndroid } from 'react-native';

import { DsChip, DsChipRow, DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel, DsTile, DsTileGrid } from '@/design';
import { FolderAccessChips } from '@/files/folder-access/FolderAccessChips';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

/**
 * Files tab (design screen 26 "Files · Browse"). The file-manager module is not built yet: this is the design's
 * shell with the rows that already have a screen behind them (videos on the device, the private folder, storage),
 * so the tab bar matches the handoff today and the module can grow into it.
 */
export const FilesScreen = memo(function FilesScreen() {
  const { t } = useTranslation();

  const notYet = useCallback(() => {
    ToastAndroid.show(t('filesTab.notAvailableYet'), ToastAndroid.SHORT);
  }, [t]);

  const openDeviceVideos = useCallback(() => navigation.push(routePaths.deviceVideos), []);
  const openPrivate = useCallback(() => navigation.push(routePaths.private), []);
  const openStorage = useCallback(() => navigation.push(routePaths.storage), []);

  return (
    <DsScreen testID="files-screen">
      <DsHeader
        title={t('filesTab.title')}
        subtitle={t('filesTab.subtitle')}
        action={{ icon: 'search', accessibilityLabel: t('filesTab.searchA11y'), onPress: notYet }}
      />
      <DsChipRow>
        <DsChip label={t('filesTab.internal')} selected />
        {/* F15 (Faran): SD card and Folders I added. */}
        <FolderAccessChips />
      </DsChipRow>
      <DsTileGrid>
        <DsTile icon="film" label={t('filesTab.videos')} onPress={openDeviceVideos} />
        <DsTile icon="music" label={t('filesTab.audio')} onPress={notYet} />
        <DsTile icon="image" label={t('filesTab.images')} onPress={notYet} />
        <DsTile icon="file-text" label={t('filesTab.docs')} onPress={notYet} />
        <DsTile icon="archive" label={t('filesTab.archives')} onPress={notYet} />
        <DsTile icon="package" label={t('filesTab.apks')} onPress={notYet} />
      </DsTileGrid>
      <DsRowGroup>
        <DsRow icon="lock" title={t('filesTab.privateFolder')} subtitle={t('filesTab.privateFolderHint')} onPress={openPrivate} />
      </DsRowGroup>
      <DsSectionLabel>{t('filesTab.folders')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="folder" title={t('filesTab.movies')} subtitle={t('filesTab.moviesPath')} onPress={openStorage} />
        <DsRow icon="folder" title={t('filesTab.download')} subtitle={t('filesTab.downloadPath')} onPress={openStorage} />
        <DsRow icon="folder" title={t('common.brand')} subtitle={t('filesTab.vidoraxPath')} onPress={openStorage} />
      </DsRowGroup>
    </DsScreen>
  );
});
