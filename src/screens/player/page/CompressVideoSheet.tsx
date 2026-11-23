import { memo, useMemo } from 'react';

import { DsRow, DsRowGroup, DsText } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { formatFileSize } from '@/media-detection/utils/format';
import {
  compressOptions,
  compressResolutionLabel,
  type CompressPreset,
  type CompressSource,
} from '@/media-edit/compress-plan';

import { PlayerSheetFrame } from './PlayerSheetFrame';

const PRESET_LABELS: Readonly<Record<CompressPreset, TranslationKey>> = {
  high: 'videoPlayer.compressHigh',
  medium: 'videoPlayer.compressMedium',
  small: 'videoPlayer.compressSmall',
};

export type CompressVideoSheetProps = {
  visible: boolean;
  source: CompressSource | null;
  onSelect: (preset: CompressPreset) => void;
  onClose: () => void;
};

/**
 * P10 Compress video (#680): High / Medium / Small, each with the size the copy will have (its resolution and about how
 * many MB) before anything starts. A preset that wouldn't make the video smaller is greyed. Saves a new copy.
 */
export const CompressVideoSheet = memo(function CompressVideoSheet({ visible, source, onSelect, onClose }: CompressVideoSheetProps) {
  const { t } = useTranslation();
  const options = useMemo(() => (source ? compressOptions(source) : []), [source]);
  if (!source) {
    return null;
  }
  const nowSize = formatFileSize(source.sizeBytes) ?? '';
  const nowResolution = compressResolutionLabel(
    typeof source.width === 'number' && typeof source.height === 'number' ? Math.min(source.width, source.height) : null,
  );
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('videoPlayer.compressVideo')}
      subtitle={t('videoPlayer.compressSubtitle')}
      onClose={onClose}
      testID="player-compress-sheet">
      <DsText variant="rowSub" testID="player-compress-now">
        {nowResolution
          ? t('videoPlayer.compressNowWithSize', { size: nowSize, resolution: nowResolution })
          : t('videoPlayer.compressNow', { size: nowSize })}
      </DsText>
      <DsRowGroup>
        {options.map((option) => {
          const size = formatFileSize(option.estimateBytes) ?? '';
          const resolution = compressResolutionLabel(option.shortSide);
          const detail = resolution
            ? t('videoPlayer.compressPresetDetail', { resolution, size })
            : t('videoPlayer.compressPresetSize', { size });
          const available = option.availability === 'ok';
          return (
            <DsRow
              key={option.preset}
              title={t(PRESET_LABELS[option.preset])}
              subtitle={available ? detail : `${detail} · ${t('videoPlayer.compressNoGain')}`}
              disabled={!available}
              onPress={() => onSelect(option.preset)}
              testID={`player-compress-${option.preset}`}
            />
          );
        })}
      </DsRowGroup>
      <DsText variant="rowSub">{t('videoPlayer.compressEstimateNote')}</DsText>
    </PlayerSheetFrame>
  );
});
