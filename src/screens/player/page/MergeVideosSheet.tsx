import { memo, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { DsButton, DsCheckTile, DsIconButton, DsRow, DsRowGroup, DsText } from '@/design';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { useTranslation } from '@/localization';
import {
  MERGE_MAX_VIDEOS,
  MERGE_MIN_VIDEOS,
  isMergeCandidate,
  mergeHasAudio,
  mergeMoveDown,
  mergeMoveUp,
  mergeOutputSize,
  mergeRemove,
  mergeToggle,
  mergeTotalMs,
} from '@/media-edit/merge-plan';
import { formatPlaybackTime } from '@/player/format-time';
import type { LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { PlayerSheetFrame } from './PlayerSheetFrame';

export type MergeVideosSheetProps = {
  /** The video playing: first in the list, and always in it. */
  current: LibraryItem;
  onMerge: (ids: string[]) => void;
  onClose: () => void;
};

/** How many Library items the picker reads (the native page's most). */
const PICKER_LIMIT = 200;

/** "1:02 · 1920 × 1080": a video's length and size, numbers only (not translated). */
function detail(item: LibraryItem): string {
  const length = formatPlaybackTime(typeof item.durationMs === 'number' ? item.durationMs / 1000 : null);
  return typeof item.width === 'number' && typeof item.height === 'number' ? `${length} · ${item.width} × ${item.height}` : length;
}

/**
 * P12 Merge videos (#682): the videos to join, in order — the one playing first, others added from the Library, each
 * moved up or down, removed (never the one playing) — and what the copy will be (the first video's size, the length
 * of all). "Add videos" lists the Library's videos with a check each, at most ten in all. Rendered only while open, so
 * each opening starts with the video playing alone.
 */
export const MergeVideosSheet = memo(function MergeVideosSheet({ current, onMerge, onClose }: MergeVideosSheetProps) {
  const { t } = useTranslation();
  const [ids, setIds] = useState<string[]>([current.id]);
  const [picking, setPicking] = useState(false);
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);

  // The Library's videos, newest first (read once per opening).
  useEffect(() => {
    const engine = getV2Engine();
    if (!engine) {
      return undefined;
    }
    let live = true;
    engine
      .listLibrary({ sort: 'newest', limit: PICKER_LIMIT })
      .then((page) => {
        if (live) {
          setLibrary(page.items.filter(isMergeCandidate));
        }
      })
      .catch(() => {
        if (live) {
          setLibrary([]);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  const byId = useMemo(() => {
    const map = new Map<string, LibraryItem>();
    for (const entry of library ?? []) {
      map.set(entry.id, entry);
    }
    map.set(current.id, current);
    return map;
  }, [current, library]);
  const chosen = ids.map((id) => byId.get(id)).filter((entry): entry is LibraryItem => entry != null);
  const output = chosen[0] ? mergeOutputSize(chosen[0]) : null;
  const someSilent = chosen.length >= MERGE_MIN_VIDEOS && mergeHasAudio(chosen) && chosen.some((entry) => !entry.hasAudio);
  const others = (library ?? []).filter((entry) => entry.id !== current.id);

  if (picking) {
    return (
      <PlayerSheetFrame
        visible
        title={t('videoPlayer.mergeAdd')}
        subtitle={t('videoPlayer.mergePickHint', { count: MERGE_MAX_VIDEOS })}
        onClose={() => setPicking(false)}
        testID="player-merge-pick">
        {library == null && getV2Engine() ? (
          <DsText variant="rowSub">{t('common.loading')}</DsText>
        ) : others.length === 0 ? (
          <DsText variant="rowSub" testID="player-merge-pick-empty">
            {t('videoPlayer.mergePickEmpty')}
          </DsText>
        ) : (
          <DsRowGroup>
            {others.map((entry) => {
              const checked = ids.includes(entry.id);
              return (
                <DsRow
                  key={entry.id}
                  leading={<DsCheckTile checked={checked} />}
                  title={entry.title}
                  subtitle={detail(entry)}
                  onPress={() => setIds((list) => mergeToggle(list, entry.id, current.id))}
                  disabled={!checked && ids.length >= MERGE_MAX_VIDEOS}
                  trailing="none"
                  accessibilityLabel={`${entry.title}, ${detail(entry)}`}
                  accessibilityHint={checked ? t('videoPlayer.mergePickRemoveHint') : t('videoPlayer.mergePickAddHint')}
                  testID={`player-merge-pick-${entry.id}`}
                />
              );
            })}
          </DsRowGroup>
        )}
        <DsButton label={t('common.done')} onPress={() => setPicking(false)} fullWidth testID="player-merge-pick-done" />
      </PlayerSheetFrame>
    );
  }

  return (
    <PlayerSheetFrame
      visible
      title={t('videoPlayer.mergeVideos')}
      subtitle={t('videoPlayer.mergeSubtitle')}
      onClose={onClose}
      testID="player-merge-sheet">
      <DsRowGroup>
        {chosen.map((entry, index) => (
          <DsRow
            key={entry.id}
            title={`${index + 1}. ${entry.title}`}
            subtitle={entry.id === current.id ? `${detail(entry)} · ${t('videoPlayer.mergePlaying')}` : detail(entry)}
            trailing={
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <DsIconButton
                  icon="chevron-up"
                  variant="plain"
                  accessibilityLabel={t('videoPlayer.customizeMoveUp', { name: entry.title })}
                  onPress={() => setIds((list) => mergeMoveUp(list, index))}
                  disabled={index === 0}
                  testID={`player-merge-up-${entry.id}`}
                />
                <DsIconButton
                  icon="chevron-down"
                  variant="plain"
                  accessibilityLabel={t('videoPlayer.customizeMoveDown', { name: entry.title })}
                  onPress={() => setIds((list) => mergeMoveDown(list, index))}
                  disabled={index === chosen.length - 1}
                  testID={`player-merge-down-${entry.id}`}
                />
                {entry.id === current.id ? null : (
                  <DsIconButton
                    icon="x"
                    variant="plain"
                    accessibilityLabel={t('videoPlayer.mergeRemove', { name: entry.title })}
                    onPress={() => setIds((list) => mergeRemove(list, entry.id, current.id))}
                    testID={`player-merge-remove-${entry.id}`}
                  />
                )}
              </View>
            }
            testID={`player-merge-item-${entry.id}`}
          />
        ))}
      </DsRowGroup>
      <DsButton
        label={t('videoPlayer.mergeAdd')}
        variant="secondary"
        icon="plus"
        onPress={() => setPicking(true)}
        disabled={ids.length >= MERGE_MAX_VIDEOS}
        fullWidth
        testID="player-merge-add"
      />
      {output && chosen.length >= MERGE_MIN_VIDEOS ? (
        <DsText variant="rowTitle" testID="player-merge-output">
          {t('videoPlayer.mergeOutput', {
            width: output.width,
            height: output.height,
            length: formatPlaybackTime(mergeTotalMs(chosen) / 1000),
          })}
        </DsText>
      ) : null}
      <DsText variant="rowSub">{t('videoPlayer.mergeFitNote')}</DsText>
      {someSilent ? <DsText variant="rowSub">{t('videoPlayer.mergeSilentNote')}</DsText> : null}
      <DsButton
        label={t('videoPlayer.mergeStart', { count: chosen.length })}
        icon="layers"
        onPress={() => onMerge(chosen.map((entry) => entry.id))}
        disabled={chosen.length < MERGE_MIN_VIDEOS}
        fullWidth
        testID="player-merge-start"
      />
    </PlayerSheetFrame>
  );
});
