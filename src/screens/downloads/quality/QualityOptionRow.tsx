import { memo } from 'react';
import { View } from 'react-native';

import { DsIcon, DsRow, ds } from '@/design';
import {
  buildQualityAccessibilityLabel,
  formatQualityFileSize,
  formatStreamPresentation,
  type DownloadQualityOption,
} from '@/downloads/quality';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type QualityOptionRowProps = {
  option: DownloadQualityOption;
  selected: boolean;
  onSelect: (id: string) => void;
  /** True while create/submit is in progress — disables interaction. */
  interactionDisabled?: boolean;
  /** Plays this quality online (F17); absent when it cannot be played (split audio + video, refused). */
  onPlay?: (id: string) => void;
  /** The design's "Best" mark on the first (highest) quality. */
  best?: boolean;
  testID?: string;
};

/** "1080p · MP4" for a video, "MP3 · 192 kbps" for audio; the label alone when the rest is unknown. */
export function qualityRowTitle(option: DownloadQualityOption, kbps: (value: number) => string): string {
  if (option.isAudioOnly) {
    const bitrate = option.audioBitrate ?? option.averageBitrate ?? option.bitrate;
    const rate = typeof bitrate === 'number' && Number.isFinite(bitrate) && bitrate > 0 ? kbps(Math.round(bitrate / 1000)) : null;
    return rate ? `${option.label} · ${rate}` : option.label;
  }
  const format = formatStreamPresentation(option);
  return format && format !== option.label ? `${option.label} · ${format}` : option.label;
}

/** "Best · 120 MB", "54 MB", or the size alone; the unsupported badge for a quality that can't be downloaded. */
export function qualityRowSubtitle(
  option: DownloadQualityOption,
  input: { best: boolean; bestLabel: string; unsupportedLabel: string },
): string | undefined {
  if (!option.downloadable) {
    return input.unsupportedLabel;
  }
  const size = formatQualityFileSize(option.estimatedFileSize ?? option.fileSize)?.replace(/^≈\s*/, '') ?? null;
  const parts = [input.best ? input.bestLabel : null, size].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * The design's quality row (design 33): a film (or music) tile, "1080p · MP4" over "Best · 120 MB", a chevron.
 * Tap selects it (the sheet then downloads it); long press plays it online when that is possible (F17). The selected
 * row's tile is drawn in the accent.
 */
export const QualityOptionRow = memo(function QualityOptionRow({
  option,
  selected,
  onSelect,
  interactionDisabled = false,
  onPlay,
  best = false,
  testID,
}: QualityOptionRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const unsupported = !option.downloadable;
  const disabled = unsupported || interactionDisabled;
  const title = qualityRowTitle(option, (value) => t('lightVideoSheet.kbps', { value }));
  const subtitle = qualityRowSubtitle(option, {
    best,
    bestLabel: t('lightVideoSheet.best'),
    unsupportedLabel: t('downloads.unsupportedBadge'),
  });
  const canPlay = Boolean(onPlay) && !unsupported;

  return (
    <DsRow
      testID={testID}
      leading={
        <View
          style={{
            width: ds.size.iconTile,
            height: ds.size.iconTile,
            borderRadius: ds.radius.iconTile,
            backgroundColor: selected ? theme.colors.primary : theme.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <DsIcon
            name={option.isAudioOnly ? 'music' : 'film'}
            size={ds.size.rowIcon}
            color={selected ? 'textOnPrimary' : 'primary'}
            strokeWidth={ds.stroke.row}
          />
        </View>
      }
      title={title}
      subtitle={subtitle}
      onPress={() => onSelect(option.id)}
      onLongPress={canPlay ? () => onPlay?.(option.id) : undefined}
      disabled={disabled}
      trailing="chevron"
      accessibilityLabel={buildQualityAccessibilityLabel(option, selected)}
      accessibilityHint={canPlay ? `${t('lightVideoSheet.rowHint')}. ${t('lightVideoSheet.playRowHint')}` : t('lightVideoSheet.rowHint')}
    />
  );
});
