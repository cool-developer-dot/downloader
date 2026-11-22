import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { DsButton, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { SUBTITLE_OFFSET_STEP_MS, formatSubtitleOffset } from '@/player/subtitles/cues';
import { SUBTITLE_ENCODINGS, type ResolvedEncoding, type SubtitleEncoding } from '@/player/subtitles/subtitle-encoding';
import { subtitleEncodingLabel } from '@/player/subtitles/subtitle-labels';
import type { SubtitleSource } from '@/player/subtitles/subtitle-record';
import type { SubtitleOption } from '@/player/subtitles/use-player-subtitles';

import { PlayerSheetFrame } from './PlayerSheetFrame';

export type SubtitleTrackSheetProps = {
  visible: boolean;
  title: string;
  options: readonly SubtitleOption[];
  /** The key of what shows ('off' for none). */
  selectedKey: string;
  onSelect: (source: SubtitleSource) => void;
  onClose: () => void;
  /** P4's second track: tracks inside the video can't be shown as a second one. */
  filesOnly?: boolean;
  /** Keys left out (P4: the first subtitle is not offered as the second). */
  exclude?: readonly string[];
  subtitle?: string;
  testID?: string;
};

/** #598 Multiple Tracks and #602 Subtitle Off: Off, the tracks inside the video, then the subtitle files. */
export const SubtitleTrackSheet = memo(function SubtitleTrackSheet({
  visible,
  title,
  options,
  selectedKey,
  onSelect,
  onClose,
  filesOnly = false,
  exclude,
  subtitle,
  testID = 'player-subtitle-track-sheet',
}: SubtitleTrackSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: 'subtitle-track-off',
        label: t('videoPlayer.subtitleOffValue'),
        selected: selectedKey === 'off',
        onPress: () => onSelect({ kind: 'off' }),
      },
      ...options
        .filter((option) => (!filesOnly || option.kind === 'file') && !exclude?.includes(option.key))
        .map((option) => ({
          id: `subtitle-track-${option.key}`,
          label: option.label,
          selected: option.key === selectedKey,
          onPress: () => onSelect(option.source),
        })),
    ],
    [exclude, filesOnly, onSelect, options, selectedKey, t],
  );
  return (
    <ActionSheetModal visible={visible} title={title} subtitle={subtitle} actions={actions} onClose={onClose} testID={testID} />
  );
});

export type SubtitleEncodingSheetProps = {
  visible: boolean;
  selected: SubtitleEncoding;
  /** What automatic detection chose for this file. */
  detected: ResolvedEncoding | null;
  onSelect: (encoding: SubtitleEncoding) => void;
  onClose: () => void;
};

/** #601 Subtitle Encoding: Automatic, or one chosen by hand. */
export const SubtitleEncodingSheet = memo(function SubtitleEncodingSheet({
  visible,
  selected,
  detected,
  onSelect,
  onClose,
}: SubtitleEncodingSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(
    () =>
      SUBTITLE_ENCODINGS.map((encoding) => ({
        id: `subtitle-encoding-${encoding}`,
        label: subtitleEncodingLabel(t, encoding, detected),
        selected: encoding === selected,
        onPress: () => onSelect(encoding),
      })),
    [detected, onSelect, selected, t],
  );
  return (
    <ActionSheetModal
      visible={visible}
      title={t('videoPlayer.subtitleEncoding')}
      subtitle={t('videoPlayer.subtitleEncodingHint')}
      actions={actions}
      onClose={onClose}
      testID="player-subtitle-encoding-sheet"
    />
  );
});

export type SubtitleSyncSheetProps = {
  visible: boolean;
  offsetMs: number;
  onStep: (steps: number) => void;
  onReset: () => void;
  onClose: () => void;
};

const STEP_TEXT = `${(SUBTITLE_OFFSET_STEP_MS / 1000).toFixed(1)} s`;

/** #597 Subtitle Sync: earlier / later in 100 ms steps (and 1 s steps), and Reset. The video keeps playing. */
export const SubtitleSyncSheet = memo(function SubtitleSyncSheet({ visible, offsetMs, onStep, onReset, onClose }: SubtitleSyncSheetProps) {
  const { t } = useTranslation();
  const value = formatSubtitleOffset(offsetMs);
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('videoPlayer.subtitleSyncTitle')}
      subtitle={t('videoPlayer.subtitleSyncHint')}
      onClose={onClose}
      testID="player-subtitle-sync-sheet">
      <DsText
        variant="hero"
        align="center"
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('videoPlayer.subtitleSyncValue', { offset: value })}
        testID="player-subtitle-sync-value">
        {value}
      </DsText>
      {/* Earlier on the left and later on the right in every language: it is a time line. */}
      <View style={[styles.row, { direction: 'ltr' }]}>
        <DsButton
          label={`${String.fromCharCode(0x2212)}1 s`}
          variant="secondary"
          flex
          accessibilityLabel={t('videoPlayer.subtitleSyncEarlier', { step: '1 s' })}
          onPress={() => onStep(-10)}
          testID="player-subtitle-sync-minus-1s"
        />
        <DsButton
          label={`${String.fromCharCode(0x2212)}${STEP_TEXT}`}
          variant="secondary"
          flex
          accessibilityLabel={t('videoPlayer.subtitleSyncEarlier', { step: STEP_TEXT })}
          onPress={() => onStep(-1)}
          testID="player-subtitle-sync-minus"
        />
        <DsButton
          label={`+${STEP_TEXT}`}
          variant="secondary"
          flex
          accessibilityLabel={t('videoPlayer.subtitleSyncLater', { step: STEP_TEXT })}
          onPress={() => onStep(1)}
          testID="player-subtitle-sync-plus"
        />
        <DsButton
          label="+1 s"
          variant="secondary"
          flex
          accessibilityLabel={t('videoPlayer.subtitleSyncLater', { step: '1 s' })}
          onPress={() => onStep(10)}
          testID="player-subtitle-sync-plus-1s"
        />
      </View>
      <DsButton
        label={t('videoPlayer.subtitleSyncReset')}
        variant="primary"
        fullWidth
        disabled={offsetMs === 0}
        onPress={onReset}
        testID="player-subtitle-sync-reset"
      />
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
});
