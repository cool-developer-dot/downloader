import { memo } from 'react';

import { EditProgressSheet } from './EditProgressSheet';
import { GifSheet } from './GifSheet';
import { MergeVideosSheet } from './MergeVideosSheet';
import { SpeedExportSheet } from './SpeedExportSheet';
import type { PlayerExportExtrasSheetsState } from './use-player-export-extras';

/**
 * P12: Create GIF, Merge videos, Change speed and the running export's progress (one at a time). The three choice
 * sheets are rendered only while open (keyed by the video and the moment they opened), so each starts afresh.
 */
export const PlayerExportExtrasSheets = memo(function PlayerExportExtrasSheets({ state }: { state: PlayerExportExtrasSheetsState }) {
  const item = state.item;
  return (
    <>
      {state.sheet === 'gif' && item ? (
        <GifSheet
          key={`gif-${item.id}-${state.openedAtMs}`}
          source={item}
          startMs={state.openedAtMs}
          readPositionMs={state.readPositionMs}
          onCreate={state.onCreateGif}
          onClose={state.onClose}
        />
      ) : null}
      {state.sheet === 'merge' && item ? (
        <MergeVideosSheet key={`merge-${item.id}`} current={item} onMerge={state.onMerge} onClose={state.onClose} />
      ) : null}
      {state.sheet === 'speed' && item ? (
        <SpeedExportSheet
          key={`speed-${item.id}-${state.openedAtMs}`}
          source={item}
          positionMs={state.openedAtMs}
          onSave={state.onSpeed}
          onClose={state.onClose}
        />
      ) : null}
      <EditProgressSheet
        visible={state.sheet === 'progress'}
        sourceId={item?.id ?? null}
        kind={state.runningKind}
        onClose={state.onClose}
      />
    </>
  );
});
