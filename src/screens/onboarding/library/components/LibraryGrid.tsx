import { memo, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import type { LibrarySequenceValues } from '../animations';
import { LIBRARY_CARDS, LIBRARY_FEATURES, LIBRARY_LAYOUT } from '../constants';

import { DownloadCard } from './DownloadCard';
import { FeatureChip } from './FeatureChip';

type LibraryGridProps = {
  sequence: LibrarySequenceValues;
  size: number;
};

/**
 * Absolute canvas where cards organize from scatter → grid → dashboard.
 */
export const LibraryGrid = memo(function LibraryGrid({ sequence, size }: LibraryGridProps) {
  const center = size / 2;

  return (
    <View style={[styles.grid, { width: size, height: size }]}>
      {LIBRARY_CARDS.map((card, index) => (
        <DownloadCard
          key={card.id}
          card={card}
          anim={sequence.cards[index]}
          organize={sequence.organize}
          converge={sequence.converge}
          filterProgress={sequence.filterProgress}
          playProgress={sequence.playProgress}
          playingOpacity={sequence.playingOpacity}
          playPulse={sequence.playPulse}
          waveform={sequence.waveform}
          center={center}
        />
      ))}

      {LIBRARY_FEATURES.map((feature, index) => (
        <FeatureChip
          key={feature.id}
          feature={feature}
          anim={sequence.chips[index]}
          converge={sequence.converge}
          center={center}
        />
      ))}
    </View>
  );
});

type UseLibraryCanvasSizeResult = {
  size: number;
  searchWidth: number;
};

export function useLibraryCanvasSize(): UseLibraryCanvasSizeResult {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const size = Math.min(width * 0.88, height * 0.42, LIBRARY_LAYOUT.canvasMax);
    const searchWidth = Math.min(size * 0.78, LIBRARY_LAYOUT.searchMaxWidth);
    return { size, searchWidth };
  }, [height, width]);
}

const styles = StyleSheet.create({
  grid: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
