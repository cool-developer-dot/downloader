import { memo } from 'react';

import { CompressVideoSheet } from './CompressVideoSheet';
import { EditProgressSheet } from './EditProgressSheet';
import type { PlayerEditToolsSheetsState } from './use-player-edit-tools';
import { VideoConverterSheet } from './VideoConverterSheet';

/** P10: the Video converter choices, the Compress presets and the running edit's progress (one at a time). */
export const PlayerEditToolsSheets = memo(function PlayerEditToolsSheets({ state }: { state: PlayerEditToolsSheetsState }) {
  return (
    <>
      <VideoConverterSheet
        visible={state.sheet === 'converter'}
        source={state.item}
        onSelect={state.onConvert}
        onClose={state.onClose}
      />
      <CompressVideoSheet
        visible={state.sheet === 'compress'}
        source={state.item}
        onSelect={state.onCompress}
        onClose={state.onClose}
      />
      <EditProgressSheet
        visible={state.sheet === 'progress'}
        sourceId={state.item?.id ?? null}
        kind={state.runningKind}
        onClose={state.onClose}
      />
    </>
  );
});
