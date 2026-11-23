import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { Loader } from '@/components/common/Loader';
import { DsButton, DsButtonRow, DsCard, DsHeader, DsRowGroup, DsScreen, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { playPlaylist } from '@/playlists/play-playlist';
import {
  announcePlaylist,
  deletePlaylistAfterConfirm,
  exportPlaylist,
  movePlaylistEntry,
  removeFromPlaylist,
  renamePlaylistTo,
} from '@/playlists/playlists-service';
import { usePlaylistDetail } from '@/playlists/use-playlists';

import { PlaylistEntryRow } from './components/PlaylistEntryRow';
import { PlaylistNameModal } from './components/PlaylistNameModal';

function routeId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * P7 #618: one playlist. Play (from the first video that can play), Shuffle, tap a video to play from it — always
 * through the play queue, with missing videos left out. ↑ / ↓ reorder, ✕ removes from the playlist; ⋮ renames,
 * exports M3U8 (#629) or deletes the playlist (after a confirm). Nothing here deletes a video file.
 */
export const PlaylistScreen = memo(function PlaylistScreen() {
  const { t, tp } = useTranslation();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = routeId(params.id);

  // Coming back to the front (from the Player, the Library…): the library is read again (a file may have gone).
  const [focusKey, setFocusKey] = useState(0);
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setFocusKey((key) => key + 1);
    }, []),
  );

  const { status, playlist, entries } = usePlaylistDetail(id, focusKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const playableCount = entries.filter((entry) => entry.playable).length;
  const missingCount = entries.length - playableCount;
  const subtitle = playlist
    ? [tp('plurals.videosOther', entries.length), missingCount > 0 ? t('playlists.missingCount', { count: missingCount }) : null]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  const onPlay = useCallback(
    (shuffle: boolean) => {
      if (!playPlaylist(entries, { shuffle })) {
        announcePlaylist(t('playlists.nothingToPlay'));
      }
    },
    [entries, t],
  );

  const onPlayFrom = useCallback(
    (mediaId: string) => {
      if (!playPlaylist(entries, { startId: mediaId })) {
        const entry = entries.find((candidate) => candidate.mediaId === mediaId);
        announcePlaylist(entry?.missing === 'device' ? t('playlists.deviceNotListed') : t('playlists.cantPlayMissing'));
      }
    },
    [entries, t],
  );

  const onMove = useCallback(
    (mediaId: string, delta: number) => {
      if (id) void movePlaylistEntry(id, mediaId, delta);
    },
    [id],
  );

  const onRemove = useCallback(
    (mediaId: string) => {
      if (id) void removeFromPlaylist(id, mediaId);
    },
    [id],
  );

  const menuActions = useMemo<ActionSheetItem[]>(() => {
    if (!playlist) return [];
    return [
      { id: 'rename', label: t('common.rename'), icon: 'pencil', onPress: () => setRenaming(true) },
      {
        id: 'export',
        label: t('playlists.exportM3u8'),
        icon: 'export-variant',
        onPress: () => {
          void exportPlaylist(
            playlist.name,
            entries.map((entry) => ({ title: entry.title, fileName: entry.fileName, durationSeconds: entry.durationSeconds })),
          );
        },
      },
      {
        id: 'delete',
        label: t('playlists.deletePlaylist'),
        icon: 'delete-outline',
        destructive: true,
        onPress: () => {
          void deletePlaylistAfterConfirm(playlist).then((deleted) => {
            if (deleted) navigation.back();
          });
        },
      },
    ];
  }, [entries, playlist, t]);

  return (
    <DsScreen testID="playlist-screen" edges={['top', 'bottom']}>
      <DsHeader
        title={playlist?.name ?? t('playlists.title')}
        subtitle={subtitle}
        onBack={() => navigation.back()}
        action={
          playlist
            ? {
                icon: 'ellipsis-vertical',
                accessibilityLabel: t('playlists.options'),
                onPress: () => setMenuOpen(true),
                testID: 'playlist-menu',
              }
            : undefined
        }
        testID="playlist-header"
      />

      {status === 'loading' ? (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <Loader size="large" accessibilityLabel={t('common.loading')} />
        </View>
      ) : status === 'missing' ? (
        <DsCard>
          <DsText variant="body">{t('playlists.notFound')}</DsText>
        </DsCard>
      ) : status === 'error' ? (
        <DsCard>
          <DsText variant="body">{t('playlists.loadFailed')}</DsText>
        </DsCard>
      ) : (
        <>
          <DsButtonRow>
            <DsButton
              label={t('common.play')}
              icon="play"
              flex
              disabled={playableCount === 0}
              onPress={() => onPlay(false)}
              testID="playlist-play"
            />
            <DsButton
              label={t('playlists.shuffle')}
              icon="shuffle"
              variant="secondary"
              flex
              disabled={playableCount === 0}
              onPress={() => onPlay(true)}
              testID="playlist-shuffle"
            />
          </DsButtonRow>
          {entries.length === 0 ? (
            <DsCard style={{ gap: 4 }}>
              <DsText variant="body">{tp('plurals.videosOther', 0)}</DsText>
              <DsText variant="rowSub">{t('playlists.emptyBody')}</DsText>
            </DsCard>
          ) : (
            <DsRowGroup testID="playlist-entries">
              {entries.map((entry, index) => (
                <PlaylistEntryRow
                  key={entry.mediaId}
                  entry={entry}
                  isFirst={index === 0}
                  isLast={index === entries.length - 1}
                  onPlay={onPlayFrom}
                  onMove={onMove}
                  onRemove={onRemove}
                  testID={`playlist-entry-${index}`}
                />
              ))}
            </DsRowGroup>
          )}
        </>
      )}

      <ActionSheetModal
        visible={menuOpen && playlist != null}
        onClose={() => setMenuOpen(false)}
        title={playlist?.name}
        actions={menuActions}
        testID="playlist-menu-sheet"
      />
      <PlaylistNameModal
        visible={renaming && playlist != null}
        title={t('playlists.renameTitle')}
        initialName={playlist?.name ?? ''}
        confirmLabel={t('common.save')}
        onClose={() => setRenaming(false)}
        onSave={(name) => {
          setRenaming(false);
          if (playlist) void renamePlaylistTo(playlist.id, name);
        }}
        testID="playlist-rename"
      />
    </DsScreen>
  );
});
