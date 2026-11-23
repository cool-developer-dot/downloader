/**
 * Faran's Player packages (P14–P19) on the Player screen: one hook keeps the native player in step with their
 * settings and gives the options sheet its `engine` part and the screen its sheets' state. The screen calls it once;
 * each package's part is its own hook (`use-stream-engine`, `use-headset-keys`, …).
 */

import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { useTranslation } from '@/localization';
import type { AudioEffectsInfo } from '@modules/vidorax-media';

import type { AdjustmentHud } from '../adjustment-hud';
import type { PlayerVolumeState } from '../hooks/use-player-volume';
import { setAudioEffects, useAudioEffects, type BuiltInPreset } from './audio-effects';
import { audioTrackLabel, formatAudioDelay } from './audio-settings';
import { closeEngineSheet, openEngineSheet, useOpenEngineSheet } from './engine-sheets';
import { applyTrackLimits } from './native-player';
import type { PlayerEngineOption } from './types';
import {
  formatDuration,
  limitSecondsLeft,
  localDay,
  setKidLock,
  sleepMinutesLeft,
  useLimitState,
  useSleepTimer,
} from './sleep-limits';
import { useAudioEngine, type AudioEngine } from './use-audio-engine';
import { useEffectsEngine } from './use-effects-engine';
import { useHeadsetKeys, type HeadsetKeys, type PlayerKeyHandlers } from './use-headset-keys';
import { useSleepLimitsView } from './use-sleep-limits';
import { useSpeedEngine } from './use-speed-engine';
import { useStreamEngine, type StreamQualitySheetState } from './use-stream-engine';

export { streamCapLabel } from './use-stream-engine';

export type UsePlayerEngineInput = {
  player: VideoPlayer;
  mediaId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  positionSeconds: number;
  seekStepSeconds: number;
  isFullscreen: boolean;
  pipActive: boolean;
  /** A sheet is open or the screen is locked: keys keep their normal job. */
  inputBlocked: boolean;
  handlers: PlayerKeyHandlers;
  volume: PlayerVolumeState;
  hud: AdjustmentHud;
  volumeFallback: { level: number; set: (level: number) => void };
  /** Leaves the Player for the Downloads tab (the video carries on in the mini player). */
  leaveToDownloads: () => void;
  /** P16: the session's speed, and how to set it (the session's own, so the chip and the notification follow). */
  playbackRate: number;
  setPlaybackRate: (rate: number) => boolean;
};

export type PlayerEngineSheets = {
  streamQuality: StreamQualitySheetState;
  headsetKeys: { visible: boolean; close: () => void };
  audio: { visible: boolean; close: () => void; engine: AudioEngine; effectsInfo: AudioEffectsInfo | null };
  sleepTimer: { visible: boolean; close: () => void };
  dailyLimit: { visible: boolean; close: () => void };
  limitReached: { visible: boolean; close: () => void };
};

export type PlayerEngine = {
  option: PlayerEngineOption;
  sheets: PlayerEngineSheets;
  keys: HeadsetKeys;
  /** P17 #574: no picture is decoded; the screen shows the audio-only cover. */
  audioOnly: boolean;
  /** P18 #712: the Kid Lock overlay covers the Player. */
  kidLock: boolean;
};

/** A short message, shown and spoken (the Player's own toasts). */
function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

export function usePlayerEngine(input: UsePlayerEngineInput): PlayerEngine {
  const { t } = useTranslation();
  const { player, isReady } = input;

  // P14
  const stream = useStreamEngine({
    t,
    player,
    mediaId: input.mediaId,
    isReady,
    isPlaying: input.isPlaying,
    leaveToDownloads: input.leaveToDownloads,
  });

  // P17
  const audio = useAudioEngine({ player, mediaId: input.mediaId, isReady, playbackRate: input.playbackRate });

  // The track limits: P14's stream quality cap and P17's Audio Only Mode.
  const { maxLongSide } = stream;
  const videoDisabled = audio.audioOnly;
  useEffect(() => {
    if (isReady) {
      applyTrackLimits(player, { maxLongSide, videoDisabled });
    }
  }, [isReady, maxLongSide, player, videoDisabled]);

  // P15
  const keys = useHeadsetKeys({
    player,
    isReady,
    positionSeconds: input.positionSeconds,
    seekStepSeconds: input.seekStepSeconds,
    isFullscreen: input.isFullscreen,
    pipActive: input.pipActive,
    inputBlocked: input.inputBlocked,
    handlers: input.handlers,
    volume: input.volume,
    hud: input.hud,
    volumeFallback: input.volumeFallback,
  });
  // P16
  useSpeedEngine({
    player,
    mediaId: input.mediaId,
    isReady,
    playbackRate: input.playbackRate,
    setPlaybackRate: input.setPlaybackRate,
  });

  // P19
  const effectsEngine = useEffectsEngine({ player, isReady });
  const fx = useAudioEffects();
  const presetKey = fx.preset.startsWith('user:') ? null : (fx.preset as BuiltInPreset | 'custom');
  const userPresetName = fx.preset.startsWith('user:')
    ? (fx.userPresets.find((p) => `user:${p.id}` === fx.preset)?.name ?? null)
    : null;
  const eqLabel = !fx.eqEnabled
    ? t('playerEngine.volumeBoostOff')
    : (userPresetName ??
      t(
        presetKey === 'custom'
          ? 'playerEngine.eqPresetCustom'
          : presetKey === 'bass'
            ? 'playerEngine.eqPresetBass'
            : presetKey === 'vocal'
              ? 'playerEngine.eqPresetVocal'
              : presetKey === 'rock'
                ? 'playerEngine.eqPresetRock'
                : presetKey === 'pop'
                  ? 'playerEngine.eqPresetPop'
                  : presetKey === 'classical'
                    ? 'playerEngine.eqPresetClassical'
                    : presetKey === 'jazz'
                      ? 'playerEngine.eqPresetJazz'
                      : 'playerEngine.eqPresetFlat',
      ));
  const boostLabel =
    fx.volumeBoost <= 100 ? t('playerEngine.volumeBoostOff') : t('playerEngine.percent', { n: fx.volumeBoost });
  const effectsOption = useMemo(
    () => ({
      eqLabel,
      boostLabel,
      nightMode: fx.nightMode,
      mono: fx.mono,
      set: (patch: { nightMode?: boolean; mono?: boolean }) => setAudioEffects(patch),
      open: () => openEngineSheet('audio'),
    }),
    [boostLabel, eqLabel, fx.mono, fx.nightMode],
  );

  // P18 (its countdown and counting run with the session: useSleepLimitSession in PlayerSessionHost)
  const sleepLimits = useSleepLimitsView();
  const sleepTimer = useSleepTimer();
  const limitState = useLimitState();
  const sleepMinutes = sleepMinutesLeft(sleepTimer);
  const sleepLabel =
    sleepTimer.mode === 'endOfVideo'
      ? t('playerEngine.sleepEndValue')
      : sleepMinutes != null
        ? t('playerEngine.sleepLeft', { time: formatDuration(t, sleepMinutes) })
        : t('playerEngine.sleepOff');
  const limitLeft = limitSecondsLeft(limitState, localDay(new Date()));
  const limitLabel =
    limitLeft == null
      ? t('playerEngine.limitOff')
      : t('playerEngine.limitLeftValue', { time: formatDuration(t, limitLeft / 60) });
  const openSleep = useCallback(() => openEngineSheet('sleepTimer'), []);
  const openLimit = useCallback(() => openEngineSheet('dailyLimit'), []);
  const startKidLock = useCallback(() => {
    closeEngineSheet();
    setKidLock(true);
    announce(t('playerEngine.kidLockOn'));
  }, [t]);

  const openSheet = useOpenEngineSheet();
  const openHeadsetKeys = useCallback(() => openEngineSheet('headsetKeys'), []);
  const openAudio = useCallback(() => openEngineSheet('audio'), []);

  const trackIndex = audio.track ? audio.tracks.findIndex((track) => track === audio.track) : -1;
  const trackLabel =
    audio.track && audio.tracks.length > 1
      ? audioTrackLabel(audio.track, Math.max(0, trackIndex), (n) => t('playerEngine.audioTrackNumber', { n }))
      : null;
  const audioOption = useMemo(
    () => ({
      trackLabel,
      delayLabel: formatAudioDelay(audio.delayMs),
      audioOnly: audio.audioOnly,
      setAudioOnly: audio.setAudioOnly,
      open: openAudio,
    }),
    [audio.audioOnly, audio.delayMs, audio.setAudioOnly, openAudio, trackLabel],
  );

  const option = useMemo<PlayerEngineOption>(
    () => ({
      stream: stream.option,
      headsetKeys: { open: openHeadsetKeys },
      audio: audioOption,
      sleep: { valueLabel: sleepLabel, open: openSleep },
      limit: { valueLabel: limitLabel, open: openLimit },
      kidLock: { start: startKidLock },
      effects: effectsOption,
    }),
    [audioOption, effectsOption, limitLabel, openHeadsetKeys, openLimit, openSleep, sleepLabel, startKidLock, stream.option],
  );

  const sheets = useMemo<PlayerEngineSheets>(
    () => ({
      streamQuality: stream.sheet,
      headsetKeys: { visible: openSheet === 'headsetKeys', close: closeEngineSheet },
      audio: { visible: openSheet === 'audio', close: closeEngineSheet, engine: audio, effectsInfo: effectsEngine.info },
      sleepTimer: { visible: openSheet === 'sleepTimer', close: closeEngineSheet },
      dailyLimit: { visible: openSheet === 'dailyLimit', close: closeEngineSheet },
      limitReached: { visible: sleepLimits.limitSheetVisible, close: sleepLimits.closeLimitSheet },
    }),
    [audio, effectsEngine.info, openSheet, sleepLimits.closeLimitSheet, sleepLimits.limitSheetVisible, stream.sheet],
  );

  return { option, sheets, keys, audioOnly: audio.audioOnly, kidLock: sleepLimits.kidLock };
}
