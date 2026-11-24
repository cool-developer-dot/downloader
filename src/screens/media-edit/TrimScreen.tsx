import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { EmptyState } from '@/components/common/EmptyState';
import { ds, DsButton, DsButtonRow, DsCard, DsHeader, DsIcon, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation } from '@/localization';
import { isEditRunning } from '@/media-edit/edit-job';
import { useEditJobStore } from '@/media-edit/edit-job-store';
import { clampTrimRange, formatTrimTime, trackPlan, type TrimRange } from '@/media-edit/edit-plan';
import { getEditPort } from '@/media-edit/edit-port';
import { navigation } from '@/navigation';
import { parseTrimStartParam } from '@/player/edit-tools';
import type { LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { EditJobBanner } from './EditJobBanner';
import { RangeTrack } from './RangeTrack';
import { useRunEdit } from './useRunEdit';

/** A keyframe this close to the chosen start counts as the same moment. */
const SAME_FRAME_MS = 50;
/** Waits for the handle to settle before asking where the nearest keyframe is. */
const KEYFRAME_LOOKUP_DELAY_MS = 250;

/** The preview of the library file: no autoplay, records nothing (it is not the app's Player). */
function TrimPreview({
  uri,
  onPlayer,
  startSeconds = 0,
}: {
  uri: string;
  onPlayer: (player: VideoPlayer | null) => void;
  /** P10: opened from the Player, the preview starts where the trim starts. */
  startSeconds?: number;
}) {
  const player = useVideoPlayer({ uri }, (created) => {
    created.loop = false;
    if (startSeconds > 0) {
      created.currentTime = startSeconds;
    }
  });
  useEffect(() => {
    onPlayer(player);
    return () => onPlayer(null);
  }, [onPlayer, player]);
  return (
    <VideoView
      player={player}
      style={{ flex: 1 }}
      nativeControls
      contentFit="contain"
      allowsPictureInPicture={false}
      fullscreenOptions={{ enable: false }}
    />
  );
}

/**
 * Trim (#374): start and end handles over the video's timeline, a preview, and the choice between keeping the
 * original quality (the trim starts at the nearest keyframe before the chosen start) and an exact start (the video is
 * re-encoded). Saves a new item; the original is never changed. Drawn as design 53 "Trim video" (the design kit).
 */
export const TrimScreen = memo(function TrimScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const rtl = useRtl();
  const params = useLocalSearchParams<{ id?: string | string[]; startMs?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  // P10: the Player opens Trim at the moment playing (`startMs`); without it the range starts at 0 as before.
  const startParam = parseTrimStartParam(params.startMs);
  const [source, setSource] = useState<LibraryItem | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [range, setRange] = useState<TrimRange>({ startMs: 0, endMs: 0 });
  const [previewStartMs, setPreviewStartMs] = useState(0);
  const [keyframe, setKeyframe] = useState<{ forStartMs: number; keyframeMs: number | null } | null>(null);
  const [mode, setMode] = useState<'keyframe' | 'exact'>('keyframe');
  const playerRef = useRef<VideoPlayer | null>(null);
  const savingRef = useRef(false);
  const job = useEditJobStore((s) => s.job);
  const running = isEditRunning(job) && job.sourceId === id;
  const runEdit = useRunEdit();

  useEffect(() => {
    const engine = getV2Engine();
    if (!engine || !id) {
      return undefined;
    }
    let live = true;
    engine
      .getLibraryItem(id)
      .then((item) => {
        if (!live) {
          return;
        }
        const check = item ? clampTrimRange({ startMs: startParam ?? 0, endMs: item.durationMs ?? 0 }, item.durationMs) : null;
        if (!item || !check?.ok) {
          setStatus('missing');
          return;
        }
        setSource(item);
        setRange(check.range);
        setPreviewStartMs(check.range.startMs);
        setStatus('ready');
      })
      .catch(() => {
        if (live) {
          setStatus('missing');
        }
      });
    return () => {
      live = false;
    };
  }, [id, startParam]);

  // Where the nearest keyframe at or before the start is: the start of a trim that keeps the original quality.
  useEffect(() => {
    const port = getEditPort();
    if (!port || status !== 'ready') {
      return undefined;
    }
    const startMs = range.startMs;
    let live = true;
    const timer = setTimeout(() => {
      port
        .getTrimStart(id, startMs)
        .then((keyframeMs) => {
          if (live) {
            setKeyframe({ forStartMs: startMs, keyframeMs: typeof keyframeMs === 'number' ? keyframeMs : null });
          }
        })
        .catch(() => {
          if (live) {
            setKeyframe({ forStartMs: startMs, keyframeMs: null });
          }
        });
    }, KEYFRAME_LOOKUP_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, range.startMs, status]);

  const onPlayer = useCallback((player: VideoPlayer | null) => {
    playerRef.current = player;
  }, []);

  const seekTo = useCallback((ms: number) => {
    const player = playerRef.current;
    if (player) {
      player.currentTime = ms / 1000;
    }
  }, []);

  const setFromPlayer = useCallback(
    (handle: 'start' | 'end') => {
      const player = playerRef.current;
      if (!player || !source) {
        return;
      }
      const ms = Math.round(player.currentTime * 1000);
      const next = handle === 'start' ? { startMs: ms, endMs: range.endMs } : { startMs: range.startMs, endMs: ms };
      const check = clampTrimRange(next, source.durationMs);
      if (check.ok) {
        setRange(check.range);
      }
    },
    [range.endMs, range.startMs, source],
  );

  const current = keyframe && keyframe.forStartMs === range.startMs ? keyframe : null;
  const copyable = source ? trackPlan('trim', source, true).video === 'copy' : false;
  const keyframeMs = copyable ? (current?.keyframeMs ?? null) : null;
  const onKeyframe = keyframeMs !== null && Math.abs(keyframeMs - range.startMs) <= SAME_FRAME_MS;
  const choice = !copyable || (current && keyframeMs === null) ? 'exact' : onKeyframe ? 'keyframe' : mode;

  const save = useCallback(async () => {
    if (savingRef.current || running || !source) {
      return;
    }
    savingRef.current = true;
    try {
      playerRef.current?.pause();
      const useKeyframe = choice === 'keyframe' && keyframeMs !== null;
      const check = clampTrimRange(
        { startMs: useKeyframe ? keyframeMs : range.startMs, endMs: range.endMs },
        source.durationMs,
      );
      if (!check.ok) {
        return;
      }
      const result = await runEdit(id, 'trim', { range: check.range, keyframeStart: useKeyframe });
      if (result?.phase === 'done') {
        navigation.back();
      }
    } finally {
      savingRef.current = false;
    }
  }, [choice, id, keyframeMs, range.endMs, range.startMs, runEdit, running, source]);

  const modeRow = (value: 'keyframe' | 'exact', title: string, hint: string, testID: string) => (
    <DsRow
      icon={value === 'keyframe' ? 'film' : 'scissors'}
      title={title}
      subtitle={hint}
      trailing={choice === value ? <DsIcon name="check" size={18} color="primary" /> : 'none'}
      onPress={() => setMode(value)}
      disabled={running}
      accessibilityLabel={`${title}${choice === value ? `, ${t('common.selected')}` : ''}`}
      testID={testID}
    />
  );

  return (
    <DsScreen testID="trim-screen" edges={['top', 'bottom']}>
      <DsHeader
        title={t('playerDesign.trimTitle')}
        subtitle={source?.title || source?.fileName || undefined}
        onBack={() => navigation.back()}
        testID="trim-header"
      />
      {status === 'loading' ? (
        <View style={{ paddingVertical: 48, alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
        </View>
      ) : status === 'missing' || !source ? (
        <EmptyState icon="file-alert-outline" title={t('mediaEdit.missing')} />
      ) : (
        <>
          <View
            style={{ aspectRatio: 16 / 9, backgroundColor: theme.colors.black, borderRadius: ds.radius.card, overflow: 'hidden' }}
            accessibilityLabel={t('mediaEdit.previewA11y')}>
            <TrimPreview uri={source.fileUri} onPlayer={onPlayer} startSeconds={previewStartMs / 1000} />
          </View>
          <DsCard style={{ gap: 10 }}>
            <DsText variant="rowSub">{t('mediaEdit.trimHint')}</DsText>
            <RangeTrack
              durationMs={source.durationMs ?? 0}
              range={range}
              onChange={setRange}
              onRelease={seekTo}
              disabled={running}
            />
            <View style={{ flexDirection: rtl.rowDirection, justifyContent: 'space-between' }}>
              <DsText variant="rowSub">{formatTrimTime(range.startMs)}</DsText>
              <DsText variant="rowSub">{formatTrimTime(range.endMs - range.startMs)}</DsText>
              <DsText variant="rowSub">{formatTrimTime(range.endMs)}</DsText>
            </View>
          </DsCard>
          <DsButtonRow>
            <DsButton
              label={t('mediaEdit.setStartHere')}
              variant="secondary"
              flex
              onPress={() => setFromPlayer('start')}
              disabled={running}
              testID="trim-set-start"
            />
            <DsButton
              label={t('mediaEdit.setEndHere')}
              variant="secondary"
              flex
              onPress={() => setFromPlayer('end')}
              disabled={running}
              testID="trim-set-end"
            />
          </DsButtonRow>
          {!copyable || (current && keyframeMs === null) ? (
            <DsText variant="rowSub">{t('mediaEdit.noKeyframeInfo')}</DsText>
          ) : onKeyframe ? (
            <DsText variant="rowSub">{t('mediaEdit.keyframeExact')}</DsText>
          ) : current && keyframeMs !== null ? (
            <DsRowGroup testID="trim-modes">
              {modeRow(
                'keyframe',
                t('mediaEdit.keyframeMode'),
                t('mediaEdit.keyframeModeHint', { time: formatTrimTime(keyframeMs) }),
                'trim-mode-keyframe',
              )}
              {modeRow('exact', t('mediaEdit.exactMode'), t('mediaEdit.exactModeHint'), 'trim-mode-exact')}
            </DsRowGroup>
          ) : null}
          <EditJobBanner sourceId={id} />
          <DsButton
            label={t('playerDesign.saveAsNew')}
            icon="scissors"
            fullWidth
            onPress={() => {
              void save();
            }}
            disabled={running || (copyable && !current)}
            loading={running}
            testID="trim-save"
          />
        </>
      )}
    </DsScreen>
  );
});
