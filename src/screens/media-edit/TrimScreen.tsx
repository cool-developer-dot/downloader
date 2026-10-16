import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { isEditRunning } from '@/media-edit/edit-job';
import { useEditJobStore } from '@/media-edit/edit-job-store';
import { clampTrimRange, formatTrimTime, trackPlan, type TrimRange } from '@/media-edit/edit-plan';
import { getEditPort } from '@/media-edit/edit-port';
import { navigation } from '@/navigation';
import type { LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { EditJobBanner } from './EditJobBanner';
import { RangeTrack } from './RangeTrack';
import { useRunEdit } from './useRunEdit';

/** A keyframe this close to the chosen start counts as the same moment. */
const SAME_FRAME_MS = 50;
/** Waits for the handle to settle before asking where the nearest keyframe is. */
const KEYFRAME_LOOKUP_DELAY_MS = 250;

/** The preview of the library file: no autoplay, records nothing (it is not the app's Player). */
function TrimPreview({ uri, onPlayer }: { uri: string; onPlayer: (player: VideoPlayer | null) => void }) {
  const player = useVideoPlayer({ uri }, (created) => {
    created.loop = false;
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

function ModeOption({
  selected,
  title,
  hint,
  onPress,
  disabled,
  testID,
}: {
  selected: boolean;
  title: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: Boolean(disabled) }}
      testID={testID}>
      <Box row rtlRow gap={10} py={6} style={{ alignItems: 'flex-start' }}>
        <View
          style={{
            width: 20,
            height: 20,
            marginTop: 2,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: selected ? theme.colors.primary : theme.colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {selected ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.primary }} /> : null}
        </View>
        <Box flex={1} gap={2}>
          <Text variant="body">{title}</Text>
          <Text variant="caption" color="textSecondary">
            {hint}
          </Text>
        </Box>
      </Box>
    </Pressable>
  );
}

/**
 * Trim (#374): start and end handles over the video's timeline, a preview, and the choice between keeping the
 * original quality (the trim starts at the nearest keyframe before the chosen start) and an exact start (the video is
 * re-encoded). Saves a new item; the original is never changed.
 */
export const TrimScreen = memo(function TrimScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const [source, setSource] = useState<LibraryItem | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [range, setRange] = useState<TrimRange>({ startMs: 0, endMs: 0 });
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
        const check = item ? clampTrimRange({ startMs: 0, endMs: item.durationMs ?? 0 }, item.durationMs) : null;
        if (!item || !check?.ok) {
          setStatus('missing');
          return;
        }
        setSource(item);
        setRange(check.range);
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
  }, [id]);

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

  return (
    <SafeAreaScreen
      testID="trim-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader title={t('mediaEdit.trimTitle')} showBack onBackPress={() => navigation.back()} />
      {status === 'loading' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
        </View>
      ) : status === 'missing' || !source ? (
        <EmptyState icon="file-alert-outline" title={t('mediaEdit.missing')} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <View
            style={{ aspectRatio: 16 / 9, backgroundColor: theme.colors.black, borderRadius: 12, overflow: 'hidden' }}
            accessibilityLabel={t('mediaEdit.previewA11y')}>
            <TrimPreview uri={source.fileUri} onPlayer={onPlayer} />
          </View>
          <Text variant="bodySmall" color="textSecondary">
            {t('mediaEdit.trimHint')}
          </Text>
          <RangeTrack
            durationMs={source.durationMs ?? 0}
            range={range}
            onChange={setRange}
            onRelease={seekTo}
            disabled={running}
          />
          <Box row rtlRow style={{ justifyContent: 'space-between' }}>
            <Text variant="caption">{`${t('mediaEdit.start')} ${formatTrimTime(range.startMs)}`}</Text>
            <Text variant="caption">{`${t('mediaEdit.length')} ${formatTrimTime(range.endMs - range.startMs)}`}</Text>
            <Text variant="caption">{`${t('mediaEdit.end')} ${formatTrimTime(range.endMs)}`}</Text>
          </Box>
          <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
            <Button
              title={t('mediaEdit.setStartHere')}
              variant="outline"
              size="small"
              onPress={() => setFromPlayer('start')}
              disabled={running}
              testID="trim-set-start"
            />
            <Button
              title={t('mediaEdit.setEndHere')}
              variant="outline"
              size="small"
              onPress={() => setFromPlayer('end')}
              disabled={running}
              testID="trim-set-end"
            />
          </Box>
          {!copyable || (current && keyframeMs === null) ? (
            <Text variant="caption" color="textSecondary">
              {t('mediaEdit.noKeyframeInfo')}
            </Text>
          ) : onKeyframe ? (
            <Text variant="caption" color="textSecondary">
              {t('mediaEdit.keyframeExact')}
            </Text>
          ) : current && keyframeMs !== null ? (
            <Box gap={4}>
              <ModeOption
                selected={choice === 'keyframe'}
                title={t('mediaEdit.keyframeMode')}
                hint={t('mediaEdit.keyframeModeHint', { time: formatTrimTime(keyframeMs) })}
                onPress={() => setMode('keyframe')}
                disabled={running}
                testID="trim-mode-keyframe"
              />
              <ModeOption
                selected={choice === 'exact'}
                title={t('mediaEdit.exactMode')}
                hint={t('mediaEdit.exactModeHint')}
                onPress={() => setMode('exact')}
                disabled={running}
                testID="trim-mode-exact"
              />
            </Box>
          ) : null}
          <EditJobBanner sourceId={id} />
          <Button
            title={t('mediaEdit.saveTrim')}
            onPress={() => {
              void save();
            }}
            disabled={running || (copyable && !current)}
            loading={running}
            fullWidth
            testID="trim-save"
          />
        </ScrollView>
      )}
    </SafeAreaScreen>
  );
});
