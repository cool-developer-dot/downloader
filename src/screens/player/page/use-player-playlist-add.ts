import { useCallback, useMemo, useState } from 'react';

import { isExternalMediaId } from '@/player/external-media';
import { isStreamMediaId } from '@/player/remote-stream';
import { describeMediaForPlaylist } from '@/playlists/playlist-library';
import type { PlaylistItemInput } from '@/storage/repositories/playlists.repository';

/**
 * P7 #617 in the Player: ⋮ → Tools → "Add to playlist" opens the add sheet for the video playing. A library video or
 * a phone video can be added; a file another app opened and a stream can't (their ids last only while the app runs).
 */
export function usePlayerPlaylistAdd({
  mediaId,
  title,
  endLongPress,
}: {
  mediaId: string | null;
  title: string | null;
  endLongPress: () => void;
}) {
  const [inputs, setInputs] = useState<readonly PlaylistItemInput[] | null>(null);
  const canAdd = mediaId != null && !isExternalMediaId(mediaId) && !isStreamMediaId(mediaId);

  const openAddSheet = useCallback(() => {
    if (!mediaId || !canAdd) {
      return;
    }
    endLongPress();
    void describeMediaForPlaylist(mediaId, title).then((input) => setInputs([input]));
  }, [canAdd, endLongPress, mediaId, title]);

  const closeSheet = useCallback(() => setInputs(null), []);

  /** The options sheet's context field (`PlayerOptionContext.playlists`). */
  const option = useMemo(() => ({ canAdd, openAddSheet }), [canAdd, openAddSheet]);

  return { option, sheetOpen: inputs != null, inputs, closeSheet };
}
