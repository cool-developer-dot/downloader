import { memo, useCallback, useState } from 'react';

import { DsButton, DsButtonRow, DsCard, DsHeader, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { playlistPath } from '@/navigation/constants/route-paths';
import { suggestPlaylistName } from '@/playlists/playlist-names';
import { announcePlaylist, createPlaylistWith, importPlaylistFile } from '@/playlists/playlists-service';
import { usePlaylists } from '@/playlists/use-playlists';

import { ImportResultModal, type ImportResult } from './components/ImportResultModal';
import { PlaylistNameModal } from './components/PlaylistNameModal';

/**
 * P7 #617 / #618 / #629: the user's playlists (name and number of videos), reached from the Library's header. New
 * playlist, and Import M3U (an M3U / M3U8 file of videos in the library).
 */
export const PlaylistsScreen = memo(function PlaylistsScreen() {
  const { t, tp } = useTranslation();
  const { status, playlists } = usePlaylists();
  const [naming, setNaming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const subtitle =
    status === 'ready'
      ? playlists.length === 1
        ? t('playlists.countOne')
        : t('playlists.countOther', { count: playlists.length })
      : undefined;

  const onImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const outcome = await importPlaylistFile();
      if (outcome.kind === 'done') setImportResult(outcome);
      else if (outcome.kind === 'too-large') announcePlaylist(t('playlists.tooLarge'));
      else if (outcome.kind === 'failed') announcePlaylist(t('playlists.importFailed'));
      else if (outcome.kind === 'empty') announcePlaylist(t('playlists.emptyFile'));
    } finally {
      setImporting(false);
    }
  }, [importing, t]);

  return (
    <DsScreen testID="playlists-screen" edges={['top', 'bottom']}>
      <DsHeader title={t('playlists.title')} subtitle={subtitle} onBack={() => navigation.back()} testID="playlists-header" />
      <DsButtonRow>
        <DsButton label={t('playlists.newPlaylist')} icon="plus" flex onPress={() => setNaming(true)} testID="playlists-new" />
        <DsButton
          label={importing ? t('playlists.importing') : t('playlists.importM3u')}
          icon="download"
          variant="secondary"
          flex
          loading={importing}
          disabled={importing}
          accessibilityHint={t('playlists.importHint')}
          onPress={() => {
            void onImport();
          }}
          testID="playlists-import"
        />
      </DsButtonRow>

      {status === 'error' ? <DsText variant="rowSub">{t('playlists.loadFailed')}</DsText> : null}

      {status === 'ready' && playlists.length === 0 ? (
        <DsCard testID="playlists-empty" style={{ gap: 4 }}>
          <DsText variant="bodyStrong">{t('playlists.emptyTitle')}</DsText>
          <DsText variant="rowSub">{t('playlists.emptyBody')}</DsText>
        </DsCard>
      ) : null}

      {playlists.length > 0 ? (
        <DsRowGroup testID="playlists-list">
          {playlists.map((playlist) => (
            <DsRow
              key={playlist.id}
              icon="list"
              title={playlist.name}
              subtitle={tp('plurals.videosOther', playlist.itemCount)}
              onPress={() => navigation.push(playlistPath(playlist.id))}
              testID={`playlists-row-${playlist.id}`}
            />
          ))}
        </DsRowGroup>
      ) : null}

      <PlaylistNameModal
        visible={naming}
        title={t('playlists.newPlaylist')}
        initialName={suggestPlaylistName(
          playlists.map((playlist) => playlist.name),
          (number) => t('playlists.defaultName', { number }),
        )}
        confirmLabel={t('common.create')}
        onClose={() => setNaming(false)}
        onSave={(name) => {
          setNaming(false);
          void createPlaylistWith(name).then((playlist) => {
            if (playlist) navigation.push(playlistPath(playlist.id));
          });
        }}
        testID="playlists-name"
      />
      <ImportResultModal
        result={importResult}
        onClose={() => setImportResult(null)}
        onOpenPlaylist={(id) => {
          setImportResult(null);
          navigation.push(playlistPath(id));
        }}
      />
    </DsScreen>
  );
});
