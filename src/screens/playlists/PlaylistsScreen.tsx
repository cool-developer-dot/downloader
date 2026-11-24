import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { DsCard, DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, openPlayer, routePaths } from '@/navigation';
import { playlistPath } from '@/navigation/constants/route-paths';
import { suggestPlaylistName } from '@/playlists/playlist-names';
import { announcePlaylist, createPlaylistWith, importPlaylistFile } from '@/playlists/playlists-service';
import { usePlaylists } from '@/playlists/use-playlists';
import { queueNeighbours, usePlayQueueStore } from '@/player/play-queue';
import { EMPTY_QUEUE_MEDIA_INDEX, loadQueueMediaIndex, queueMediaTitle, type QueueMediaIndex } from '@/player/queue-media';
import { usePlayerSessionHostStore } from '@/player/session-host/player-session-store';

import { ImportResultModal, type ImportResult } from './components/ImportResultModal';
import { PlaylistNameModal } from './components/PlaylistNameModal';

/**
 * Design 48 "Playlists" (P7 #617 / #618 / #629, from the Player tab's Playlists chip): the user's playlists (name and
 * number of videos), the play queue of the video playing (Now / Next, P6 #619), then Create playlist, Edit · Reorder
 * (a playlist's own screen), and Import / Export (an M3U / M3U8 file of videos in the library; export is in each
 * playlist's ⋮). The design's music icons stand for audio playlists, which VidoraX doesn't have (Not planned).
 */
export const PlaylistsScreen = memo(function PlaylistsScreen() {
  const { t, tp } = useTranslation();
  const { status, playlists } = usePlaylists();
  const [naming, setNaming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [picking, setPicking] = useState(false);

  // Design 48's PLAY QUEUE: the video playing now (full Player or mini player) and the one after it.
  const live = usePlayerSessionHostStore((s) => s.live);
  const queueIds = usePlayQueueStore((s) => s.ids);
  const nowId = live?.requestedMediaId ?? null;
  const nextId = queueNeighbours(queueIds, nowId).nextId;
  const [mediaIndex, setMediaIndex] = useState<QueueMediaIndex>(EMPTY_QUEUE_MEDIA_INDEX);
  useEffect(() => {
    let alive = true;
    void loadQueueMediaIndex().then((index) => {
      if (alive) setMediaIndex(index);
    });
    return () => {
      alive = false;
    };
  }, [nowId]);
  const nowTitle = live?.session.displayName ?? (nowId ? queueMediaTitle(mediaIndex, nowId) : null);
  const nextTitle = nextId ? queueMediaTitle(mediaIndex, nextId) : null;
  const pickActions = useMemo(
    () =>
      playlists.map((playlist) => ({
        id: playlist.id,
        label: playlist.name,
        onPress: () => {
          setPicking(false);
          navigation.push(playlistPath(playlist.id));
        },
      })),
    [playlists],
  );

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
      <DsHeader
        title={t('playlists.title')}
        subtitle={subtitle}
        onBack={() => navigation.back()}
        action={{
          icon: 'settings',
          accessibilityLabel: t('playerDesign.playerSettings'),
          onPress: () => navigation.push(routePaths.playerSettings),
          testID: 'playlists-settings',
        }}
        testID="playlists-header"
      />

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
              icon="film"
              title={playlist.name}
              subtitle={tp('plurals.videosOther', playlist.itemCount)}
              onPress={() => navigation.push(playlistPath(playlist.id))}
              testID={`playlists-row-${playlist.id}`}
            />
          ))}
        </DsRowGroup>
      ) : null}

      {nowId ? (
        <>
          <DsSectionLabel>{t('playerDesign.playQueue')}</DsSectionLabel>
          <DsRowGroup testID="playlists-queue">
            <DsRow
              icon="play"
              title={t('playerDesign.queueNow', { title: nowTitle ?? '…' })}
              onPress={() => openPlayer(nowId)}
              testID="playlists-queue-now"
            />
            <DsRow
              icon="skip-forward"
              title={nextId ? t('playerDesign.queueNext', { title: nextTitle ?? '…' }) : t('playerDesign.queueNothingNext')}
              onPress={nextId ? () => openPlayer(nextId) : undefined}
              disabled={!nextId}
              testID="playlists-queue-next"
            />
          </DsRowGroup>
        </>
      ) : null}

      <DsRowGroup testID="playlists-actions">
        <DsRow icon="plus" title={t('playerDesign.rowCreatePlaylist')} onPress={() => setNaming(true)} testID="playlists-new" />
        <DsRow
          icon="pencil"
          title={t('playerDesign.rowEditReorder')}
          subtitle={t('playerDesign.rowEditReorderSub')}
          disabled={playlists.length === 0}
          onPress={() => (playlists.length === 1 && playlists[0] ? navigation.push(playlistPath(playlists[0].id)) : setPicking(true))}
          testID="playlists-edit"
        />
        <DsRow
          icon="sliders-horizontal"
          title={importing ? t('playlists.importing') : t('playerDesign.rowImportExport')}
          subtitle={t('playerDesign.rowImportExportSub')}
          disabled={importing}
          accessibilityHint={t('playlists.importHint')}
          onPress={() => {
            void onImport();
          }}
          testID="playlists-import"
        />
      </DsRowGroup>

      <ActionSheetModal
        visible={picking}
        onClose={() => setPicking(false)}
        title={t('playerDesign.pickPlaylist')}
        actions={pickActions}
        testID="playlists-pick"
      />
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
