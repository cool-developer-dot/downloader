import { memo, useCallback, useMemo, useState } from 'react';

import { DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { setWatchHistoryPaused, useWatchHistoryPaused } from '@/playback/history-pause-preference';
import { setResumePlayback, useResumePlayback } from '@/playback/resume-preference';
import {
  setAutoPlayNext,
  setNextEpisodePrompt,
  useAutoPlayNext,
  useNextEpisodePrompt,
} from '@/player/auto-next-preference';
import {
  setHeadsetKeySettings,
  useHeadsetKeySettings,
  VOLUME_KEY_MODES,
  type VolumeKeysMode,
} from '@/player/engine/headset-keys';
import { setGesturesEnabled, useGestureSettings } from '@/player/gesture-settings-preference';
import { setDefaultOrientation, useDefaultOrientation } from '@/player/orientation-default-preference';
import { ORIENTATION_MODES, type OrientationMode } from '@/player/orientation-mode';
import { SEEK_STEP_OPTIONS } from '@/player/seek-step';
import { setSeekStepSeconds, useSeekStepSeconds } from '@/player/seek-step-preference';
import { setFillCutout, setInfoOverlay, useVideoDisplay } from '@/player/video-display-preference';
import { selectBackgroundPlayback, useSettingsStore } from '@/store/settings';

import { ChoiceSheet, type ChoiceOption } from '../browser-settings/ChoiceSheet';

const VOLUME_KEY_LABELS = {
  player: 'playerEngine.keysVolumePlayer',
  seek: 'playerEngine.keysVolumeSeek',
  system: 'playerEngine.keysVolumeSystem',
} as const;

type Sheet = 'orientation' | 'seek' | 'volumeKeys' | null;

/**
 * Design 25 "Player settings" (Settings → Player, and the ⚙ of every Player page): the Player's app-wide settings in
 * the design's sections. Each row is the same setting the Player's own sheets change. The design's Decoder, AV1 / HDR
 * and DVD / Blu-ray rows are features the owner set as Not planned.
 */
export const PlayerSettingsScreen = memo(function PlayerSettingsScreen() {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<Sheet>(null);
  const close = useCallback(() => setSheet(null), []);

  const resume = useResumePlayback();
  const orientation = useDefaultOrientation();
  const seekStep = useSeekStepSeconds();
  const background = useSettingsStore(selectBackgroundPlayback);
  const keys = useHeadsetKeySettings();
  const gestures = useGestureSettings();
  const display = useVideoDisplay(null);
  const historyPaused = useWatchHistoryPaused();
  const autoNext = useAutoPlayNext();
  const nextEpisode = useNextEpisodePrompt();

  const orientationOptions = useMemo(
    (): ChoiceOption<OrientationMode>[] =>
      ORIENTATION_MODES.map((mode) => ({ value: mode, label: t(`player.orientation.${mode}`) })),
    [t],
  );
  const seekOptions = useMemo(
    (): ChoiceOption<string>[] =>
      SEEK_STEP_OPTIONS.map((seconds) => ({
        value: String(seconds),
        label: t('videoPlayer.seekIntervalOption', { seconds }),
      })),
    [t],
  );
  const volumeOptions = useMemo(
    (): ChoiceOption<VolumeKeysMode>[] =>
      VOLUME_KEY_MODES.map((mode) => ({ value: mode, label: t(VOLUME_KEY_LABELS[mode]) })),
    [t],
  );

  return (
    <DsScreen testID="player-settings-screen">
      <DsHeader
        title={t('playerDesign.playerSettings')}
        subtitle={t('playerDesign.settingsSub')}
        onBack={() => navigation.back()}
        action={{
          icon: 'settings',
          accessibilityLabel: t('lightBrowserSettings.openAppSettingsA11y'),
          onPress: () => navigation.navigate(routePaths.settings),
          testID: 'player-settings-app-settings',
        }}
        testID="player-settings-header"
      />

      <DsSectionLabel first>{t('playerDesign.sectionVideo')}</DsSectionLabel>
      <DsRowGroup testID="player-settings-video">
        <DsRow
          icon="play"
          title={t('playerDesign.resumePlayback')}
          toggle={{ value: resume, onValueChange: setResumePlayback, accessibilityHint: t('playerDesign.resumePlaybackSub') }}
          testID="player-settings-resume"
        />
        <DsRow
          icon="monitor"
          title={t('playerDesign.defaultOrientation')}
          subtitle={t(`player.orientation.${orientation}`)}
          onPress={() => setSheet('orientation')}
          testID="player-settings-orientation"
        />
        <DsRow
          icon="fast-forward"
          title={t('videoPlayer.seekInterval')}
          subtitle={t('videoPlayer.seekIntervalOption', { seconds: seekStep })}
          onPress={() => setSheet('seek')}
          testID="player-settings-seek"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('playerDesign.sectionAudio')}</DsSectionLabel>
      <DsRowGroup testID="player-settings-audio">
        <DsRow
          icon="headphones"
          title={t('playerDesign.backgroundPlay')}
          toggle={{
            value: background,
            onValueChange: (on) => useSettingsStore.getState().updateSetting('backgroundPlayback', on),
            accessibilityHint: t('settings.backgroundPlaybackHint'),
          }}
          testID="player-settings-background"
        />
        <DsRow
          icon="headphones"
          title={t('playerEngine.keysUnplug')}
          toggle={{ value: keys.pauseOnUnplug, onValueChange: (on) => setHeadsetKeySettings({ pauseOnUnplug: on }) }}
          testID="player-settings-unplug"
        />
        <DsRow
          icon="sliders-horizontal"
          title={t('playerDesign.rowHeadsetButtons')}
          toggle={{
            value: keys.headsetButtons,
            onValueChange: (on) => setHeadsetKeySettings({ headsetButtons: on }),
            accessibilityHint: t('playerEngine.keysHeadsetSub'),
          }}
          testID="player-settings-headset"
        />
        <DsRow
          icon="keyboard"
          title={t('playerDesign.volumeKeys')}
          subtitle={t(VOLUME_KEY_LABELS[keys.volumeKeys])}
          onPress={() => setSheet('volumeKeys')}
          testID="player-settings-volume-keys"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('playerDesign.sectionDisplay')}</DsSectionLabel>
      <DsRowGroup testID="player-settings-display">
        <DsRow
          icon="hand"
          title={t('videoPlayer.gestureControls')}
          toggle={{ value: gestures.enabled, onValueChange: setGesturesEnabled }}
          testID="player-settings-gestures"
        />
        <DsRow
          icon="smartphone"
          title={t('videoPlayer.notchArea')}
          toggle={{ value: display.fillCutout, onValueChange: setFillCutout }}
          testID="player-settings-notch"
        />
        <DsRow
          icon="info"
          title={t('videoPlayer.infoOverlay')}
          toggle={{ value: display.infoOverlay, onValueChange: setInfoOverlay }}
          testID="player-settings-info"
        />
        <DsRow
          icon="lock"
          title={t('playerEngine.keysLockScreen')}
          toggle={{ value: keys.showOnLockScreen, onValueChange: (on) => setHeadsetKeySettings({ showOnLockScreen: on }) }}
          testID="player-settings-lock-screen"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('playerDesign.sectionPlayback')}</DsSectionLabel>
      <DsRowGroup testID="player-settings-playback">
        <DsRow
          icon="skip-forward"
          title={t('videoPlayer.upNextSubtitle')}
          toggle={{ value: autoNext, onValueChange: setAutoPlayNext }}
          testID="player-settings-auto-next"
        />
        <DsRow
          icon="tv"
          title={t('videoPlayer.nextEpisodePrompt')}
          toggle={{ value: nextEpisode, onValueChange: setNextEpisodePrompt }}
          testID="player-settings-next-episode"
        />
        <DsRow
          icon="eye-off"
          title={t('libraryStats.disableHistory')}
          toggle={{
            value: historyPaused,
            onValueChange: setWatchHistoryPaused,
            accessibilityHint: t('libraryStats.disableHistoryHint'),
          }}
          testID="player-settings-history"
        />
      </DsRowGroup>

      <ChoiceSheet
        visible={sheet === 'orientation'}
        title={t('playerDesign.defaultOrientation')}
        options={orientationOptions}
        value={orientation}
        onSelect={(mode) => {
          setDefaultOrientation(mode);
          close();
        }}
        onClose={close}
        testID="player-settings-orientation-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'seek'}
        title={t('videoPlayer.seekInterval')}
        options={seekOptions}
        value={String(seekStep)}
        onSelect={(value) => {
          setSeekStepSeconds(Number(value));
          close();
        }}
        onClose={close}
        testID="player-settings-seek-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'volumeKeys'}
        title={t('playerDesign.volumeKeys')}
        options={volumeOptions}
        value={keys.volumeKeys}
        onSelect={(mode) => {
          setHeadsetKeySettings({ volumeKeys: mode });
          close();
        }}
        onClose={close}
        testID="player-settings-volume-sheet"
      />
    </DsScreen>
  );
});
