/**
 * P19 Audio effects & EQ on the Player screen: keeps the player's sound shaping (mono, balance, night mode,
 * normalization, volume boost) and Android's equalizer / bass boost / virtualizer in step with the settings. Called by
 * `usePlayerEngine`.
 */

import type { VideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';

import type { AudioEffectsInfo } from '@modules/vidorax-media';

import { mapGainsToDevice, useAudioEffects } from './audio-effects';
import { applyAudioEffects, applySoundShaping, readAudioEffectsInfo } from './native-player';

export type EffectsEngine = {
  /** The phone's equalizer and effects; null until known (or without the native module). */
  info: AudioEffectsInfo | null;
};

export function useEffectsEngine(input: { player: VideoPlayer; isReady: boolean }): EffectsEngine {
  const { player, isReady } = input;
  const settings = useAudioEffects();
  const [info, setInfo] = useState<{ player: VideoPlayer; info: AudioEffectsInfo | null } | null>(null);
  const deviceInfo = info?.player === player ? info.info : null;

  // The phone's equalizer bands, once per player (its audio session).
  useEffect(() => {
    if (!isReady) {
      return;
    }
    let cancelled = false;
    void readAudioEffectsInfo(player).then((result) => {
      if (!cancelled) {
        setInfo({ player, info: result });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isReady, player]);

  // #548 / #555–#558
  useEffect(() => {
    if (!isReady) {
      return;
    }
    applySoundShaping(player, {
      mono: settings.mono,
      balance: settings.balance / 100,
      nightMode: settings.nightMode,
      normalize: settings.normalize,
      boostPercent: settings.volumeBoost,
    });
  }, [isReady, player, settings.balance, settings.mono, settings.nightMode, settings.normalize, settings.volumeBoost]);

  // #549–#552: the design's five gains on the phone's own bands.
  const bands = deviceInfo?.bands ?? [];
  const bandLevelsMb = mapGainsToDevice(settings.gains, bands);
  const levelsKey = bandLevelsMb.join(',');
  useEffect(() => {
    if (!isReady) {
      return;
    }
    applyAudioEffects(player, {
      eqEnabled: settings.eqEnabled && levelsKey !== '',
      bandLevelsMb: levelsKey ? levelsKey.split(',').map(Number) : [],
      bassStrength: settings.bassBoost * 10,
      virtualizerStrength: settings.virtualizer * 10,
    });
  }, [isReady, levelsKey, player, settings.bassBoost, settings.eqEnabled, settings.virtualizer]);
  // They stay on while the video carries on in the mini player; the session releases them with its player
  // (`releasePlayerEngine`).

  return { info: deviceInfo };
}
