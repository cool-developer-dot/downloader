import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import { DsButton, DsChip, DsChipRow, DsIconButton, DsSectionLabel, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { formatFileSize } from '@/media-detection/utils/format';
import { formatTrimTime } from '@/media-edit/edit-plan';
import {
  GIF_DEFAULT_FPS,
  GIF_DEFAULT_LENGTH_MS,
  GIF_DEFAULT_WIDTH,
  GIF_FRAME_RATES,
  GIF_START_STEP_MS,
  gifLengthOptions,
  gifPreview,
  gifWidthOptions,
  type GifChoice,
  type GifSource,
} from '@/media-edit/gif-plan';

import { PlayerSheetFrame } from './PlayerSheetFrame';

export type GifSheetProps = {
  source: GifSource;
  /** Where the part starts when the sheet opens: the moment playing (ms). */
  startMs: number;
  /** The moment playing now (ms). */
  readPositionMs: () => number;
  onCreate: (choice: GifChoice) => void;
  onClose: () => void;
};

/** "2", "1.4": a length in seconds for its chip. */
function seconds(ms: number): string {
  return String(Math.round(ms / 100) / 10);
}

/**
 * P12 Create GIF (#676): where the part starts (from the moment playing, nudged by half seconds), how long it is
 * (up to 15 s), its width (320 / 480 px, never wider than the video) and frame rate (5 / 10 / 15 fps), with the GIF's
 * size and its estimated file size before anything starts. Rendered only while open, so each opening starts afresh.
 */
export const GifSheet = memo(function GifSheet({ source, startMs, readPositionMs, onCreate, onClose }: GifSheetProps) {
  const { t } = useTranslation();
  const lengths = useMemo(() => gifLengthOptions(source.durationMs), [source.durationMs]);
  const widths = useMemo(() => gifWidthOptions(source.width, source.height), [source.height, source.width]);
  const [start, setStart] = useState(startMs);
  const [length, setLength] = useState(() =>
    lengths.includes(GIF_DEFAULT_LENGTH_MS) ? GIF_DEFAULT_LENGTH_MS : (lengths[lengths.length - 1] ?? GIF_DEFAULT_LENGTH_MS),
  );
  const [width, setWidth] = useState(() =>
    widths.some((option) => option.preset === GIF_DEFAULT_WIDTH) ? GIF_DEFAULT_WIDTH : (widths[0]?.preset ?? GIF_DEFAULT_WIDTH),
  );
  const [fps, setFps] = useState(GIF_DEFAULT_FPS);
  const choice: GifChoice = { startMs: start, lengthMs: length, width, fps };
  const preview = gifPreview(source, choice);
  const duration = Math.floor(source.durationMs ?? 0);
  const shownStart = preview?.range.startMs ?? start;
  const latestStart = Math.max(0, duration - length);
  const nudge = (delta: number) => setStart(Math.min(Math.max(0, shownStart + delta), latestStart));

  return (
    <PlayerSheetFrame
      visible
      title={t('videoPlayer.createGif')}
      subtitle={t('videoPlayer.gifSubtitle')}
      onClose={onClose}
      testID="player-gif-sheet">
      {/* A timeline runs left to right in every language (as the trim track does). */}
      <View style={{ flexDirection: 'row', direction: 'ltr', alignItems: 'center', gap: 8 }}>
        <DsIconButton
          icon="minus"
          accessibilityLabel={t('videoPlayer.gifStartEarlier')}
          onPress={() => nudge(-GIF_START_STEP_MS)}
          disabled={shownStart <= 0}
          testID="player-gif-earlier"
        />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <DsText variant="rowTitle" accessibilityLiveRegion="polite" testID="player-gif-start">
            {t('videoPlayer.gifStartsAt', { time: formatTrimTime(shownStart) })}
          </DsText>
        </View>
        <DsIconButton
          icon="plus"
          accessibilityLabel={t('videoPlayer.gifStartLater')}
          onPress={() => nudge(GIF_START_STEP_MS)}
          disabled={shownStart >= latestStart}
          testID="player-gif-later"
        />
      </View>
      <DsButton
        label={t('videoPlayer.gifUseCurrent')}
        variant="secondary"
        icon="clock"
        onPress={() => setStart(readPositionMs())}
        fullWidth
        testID="player-gif-from-now"
      />
      <DsSectionLabel>{t('videoPlayer.gifLength')}</DsSectionLabel>
      <DsChipRow scroll={false} testID="player-gif-lengths">
        {lengths.map((ms) => (
          <DsChip
            key={ms}
            label={t('videoPlayer.gifSeconds', { seconds: seconds(ms) })}
            selected={ms === length}
            onPress={() => setLength(ms)}
            testID={`player-gif-length-${ms}`}
          />
        ))}
      </DsChipRow>
      <DsSectionLabel>{t('videoPlayer.gifWidth')}</DsSectionLabel>
      <DsChipRow scroll={false} testID="player-gif-widths">
        {widths.map((option) => (
          <DsChip
            key={option.preset}
            label={t('videoPlayer.gifPixels', { width: option.size.width })}
            selected={option.preset === width}
            onPress={() => setWidth(option.preset)}
            testID={`player-gif-width-${option.preset}`}
          />
        ))}
      </DsChipRow>
      <DsSectionLabel>{t('videoPlayer.gifFrameRate')}</DsSectionLabel>
      <DsChipRow scroll={false} testID="player-gif-rates">
        {GIF_FRAME_RATES.map((rate) => (
          <DsChip
            key={rate}
            label={t('videoPlayer.gifFps', { fps: rate })}
            selected={rate === fps}
            onPress={() => setFps(rate)}
            testID={`player-gif-fps-${rate}`}
          />
        ))}
      </DsChipRow>
      {preview ? (
        <DsText variant="rowTitle" testID="player-gif-estimate">
          {t('videoPlayer.gifEstimate', {
            width: preview.size.width,
            height: preview.size.height,
            frames: preview.frames,
            size: formatFileSize(preview.estimateBytes) ?? '',
          })}
        </DsText>
      ) : null}
      <DsText variant="rowSub">{t('videoPlayer.gifEstimateNote')}</DsText>
      <DsButton
        label={t('videoPlayer.createGif')}
        icon="images"
        onPress={() => onCreate(choice)}
        disabled={!preview}
        fullWidth
        testID="player-gif-create"
      />
    </PlayerSheetFrame>
  );
});
