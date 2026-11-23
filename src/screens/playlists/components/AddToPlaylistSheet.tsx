import { memo, useState } from 'react';

import { DsIcon, DsRow, DsRowGroup, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { suggestPlaylistName } from '@/playlists/playlist-names';
import { addToPlaylist, createPlaylistWith } from '@/playlists/playlists-service';
import { usePlaylists, usePlaylistsWithMedia } from '@/playlists/use-playlists';
import { PlayerSheetFrame } from '@/screens/player/page/PlayerSheetFrame';
import type { PlaylistItemInput } from '@/storage/repositories/playlists.repository';

import { PlaylistNameModal } from './PlaylistNameModal';

export type AddToPlaylistSheetProps = {
  /** The videos to add; null hides the sheet. */
  inputs: readonly PlaylistItemInput[] | null;
  onClose: () => void;
  /** After the videos were added (the Library leaves its selection mode). */
  onAdded?: () => void;
  testID?: string;
};

/**
 * P7 #617: "Add to playlist" — the playlists (a tick on those that already have the video), and "New playlist", which
 * asks for a name and makes it with the videos in it. Used by the Library (one video, or a selection) and the Player.
 */
export const AddToPlaylistSheet = memo(function AddToPlaylistSheet(props: AddToPlaylistSheetProps) {
  if (!props.inputs || props.inputs.length === 0) {
    return null;
  }
  return <AddToPlaylistBody {...props} inputs={props.inputs} />;
});

function AddToPlaylistBody({
  inputs,
  onClose,
  onAdded,
  testID = 'add-to-playlist-sheet',
}: AddToPlaylistSheetProps & { inputs: readonly PlaylistItemInput[] }) {
  const { t, tp } = useTranslation();
  const { status, playlists } = usePlaylists();
  const single = inputs.length === 1 ? inputs[0]!.mediaId : null;
  const containing = usePlaylistsWithMedia(single, true);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = (done: boolean) => {
    setBusy(false);
    onClose();
    if (done) onAdded?.();
  };

  const subtitle = single ? inputs[0]!.title || inputs[0]!.fileName : tp('plurals.videosOther', inputs.length);

  if (naming) {
    return (
      <PlaylistNameModal
        visible
        title={t('playlists.newPlaylist')}
        initialName={suggestPlaylistName(
          playlists.map((playlist) => playlist.name),
          (number) => t('playlists.defaultName', { number }),
        )}
        confirmLabel={t('common.create')}
        onClose={onClose}
        onSave={(name) => {
          if (busy) return;
          setBusy(true);
          void createPlaylistWith(name, inputs).then((playlist) => finish(playlist != null));
        }}
        testID={`${testID}-name`}
      />
    );
  }

  return (
    <PlayerSheetFrame visible title={t('playlists.addToPlaylist')} subtitle={subtitle} onClose={onClose} testID={testID}>
      <DsRowGroup>
        <DsRow
          icon="plus"
          title={t('playlists.newPlaylist')}
          onPress={() => setNaming(true)}
          trailing="none"
          testID={`${testID}-new`}
        />
        {playlists.map((playlist) => {
          const has = containing.has(playlist.id);
          const count = tp('plurals.videosOther', playlist.itemCount);
          return (
            <DsRow
              key={playlist.id}
              icon="list"
              title={playlist.name}
              subtitle={count}
              disabled={busy}
              trailing={
                has ? <DsIcon name="check" size={18} color="primary" accessibilityLabel={t('playlists.hasVideo')} /> : 'none'
              }
              accessibilityLabel={has ? `${playlist.name}, ${count}, ${t('playlists.hasVideo')}` : `${playlist.name}, ${count}`}
              onPress={() => {
                if (busy) return;
                setBusy(true);
                void addToPlaylist(playlist, inputs).then((result) => finish(result != null));
              }}
              testID={`${testID}-${playlist.id}`}
            />
          );
        })}
      </DsRowGroup>
      {status === 'error' ? <DsText variant="rowSub">{t('playlists.loadFailed')}</DsText> : null}
    </PlayerSheetFrame>
  );
}
