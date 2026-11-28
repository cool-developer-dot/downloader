import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { DsCard, DsText, DsThumb, ds } from '@/design';
import {
  formatContainerLabel,
  formatQualityFileSize,
  formatStreamPresentation,
  resolveDisplayTitle,
  type AnalyzedMediaSelection,
  type DownloadQualityOption,
} from '@/downloads/quality';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { formatDuration } from '@/media-detection/utils';

export type MediaResultCardProps = {
  /** A link to a file that is not a video or audio (a picture, a document…): "File found", nothing being measured. */
  asFile?: boolean;
  selection: AnalyzedMediaSelection;
  selectedOption: DownloadQualityOption | null;
  testID?: string;
};

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

function formatAudioStatus(option: DownloadQualityOption | null, t: Translate): string | null {
  if (!option) {
    return null;
  }
  if (option.hasAudio === true && option.hasVideo === true) {
    return t('mediaResult.audioIncluded');
  }
  if (option.hasAudio === false && option.hasVideo === true) {
    return t('mediaResult.videoOnly');
  }
  if (option.isAudioOnly || option.hasVideo === false) {
    return t('mediaResult.audioOnly');
  }
  return null;
}

function formatSizeLabel(option: DownloadQualityOption | null, t: Translate): string {
  if (!option) {
    return t('mediaResult.calculating');
  }
  const exact = formatQualityFileSize(option.estimatedFileSize ?? option.fileSize);
  if (exact) {
    return exact.replace(/^≈\s*/, '');
  }
  return t('mediaResult.calculating');
}

/** What the analysis found (thumbnail, title, platform) and the chosen option's format, size, duration and audio. */
export const MediaResultCard = memo(function MediaResultCard({
  selection,
  selectedOption,
  asFile = false,
  testID = 'quality-media-result-card',
}: MediaResultCardProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();

  const title = resolveDisplayTitle(selection);
  const thumbnail = selection.thumbnailUrl?.trim() || null;

  const formatLabel =
    (selectedOption && formatStreamPresentation(selectedOption)) ||
    formatContainerLabel(selection.container) ||
    '—';

  const qualityLabel = selectedOption?.label ?? '—';
  const sizeLabel = asFile ? '—' : formatSizeLabel(selectedOption, t);
  const durationLabel = formatDuration(selection.duration) ?? '—';
  const audioLabel = formatAudioStatus(selectedOption, t) ?? '—';

  const platformLabel = useMemo(() => {
    const platform = selection.platform?.trim().toUpperCase() ?? '';
    if (platform.includes('TIKTOK')) {
      return 'TikTok Video';
    }
    if (platform.includes('INSTAGRAM')) {
      return 'Instagram Reel';
    }
    if (platform.includes('FACEBOOK')) {
      return 'Facebook Video';
    }
    return selection.platform?.trim() || null;
  }, [selection.platform]);

  const rows = [
    { label: t('downloads.infoFormat'), value: formatLabel },
    { label: t('downloads.infoQuality'), value: qualityLabel },
    { label: t('downloads.infoFileSize'), value: sizeLabel },
    { label: t('downloads.infoDuration'), value: durationLabel },
    { label: t('mediaResult.audio'), value: audioLabel },
  ];

  return (
    <DsCard testID={testID} style={{ gap: ds.space.stack }}>
      <View
        style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: ds.space.rowGap }}
        accessibilityRole="summary"
        accessibilityLabel={t(asFile ? 'mediaResult.fileFoundA11y' : 'mediaResult.videoFoundA11y', { title })}>
        <DsThumb uri={thumbnail} kind="video" icon={asFile ? 'file-text' : selection.mediaType === 'audio' ? 'music' : 'play'} />
        <View style={{ flex: 1, gap: 1 }}>
          <DsText variant="section">{t(asFile ? 'mediaResult.fileFound' : 'mediaResult.videoFound')}</DsText>
          <DsText variant="rowTitle" numberOfLines={2}>
            {title}
          </DsText>
          {platformLabel ? (
            <DsText variant="rowSub" numberOfLines={1}>
              {platformLabel}
            </DsText>
          ) : null}
        </View>
      </View>
      <View style={{ gap: 0 }}>
        {rows.map((row, index) => (
          <View
            key={row.label}
            style={{
              flexDirection: rtl.rowDirection,
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 8,
              borderTopWidth: index > 0 ? 1 : 0,
              borderTopColor: theme.colors.divider,
            }}>
            <DsText variant="rowSub">{row.label}</DsText>
            <DsText variant="bodyStrong">{row.value}</DsText>
          </View>
        ))}
      </View>
    </DsCard>
  );
});
