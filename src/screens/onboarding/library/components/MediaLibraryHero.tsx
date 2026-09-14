import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { LibrarySequenceValues } from '../animations';
import { libraryStyles } from '../styles';
import { useTranslation } from '@/localization';

import { LibraryGrid, useLibraryCanvasSize } from './LibraryGrid';
import { SearchInteraction } from './SearchInteraction';

type MediaLibraryHeroProps = {
  sequence: LibrarySequenceValues;
};

/**
 * Premium animated media ecosystem — the Screen 3 hero.
 */
export const MediaLibraryHero = memo(function MediaLibraryHero({
  sequence,
}: MediaLibraryHeroProps) {
  const { t } = useTranslation();
  const { size, searchWidth } = useLibraryCanvasSize();

  return (
    <View
      style={[libraryStyles.canvas, styles.canvas, { width: size, height: size }]}
      accessibilityLabel={t('onboarding.libraryHeroA11y')}
      accessible>
      <LibraryGrid sequence={sequence} size={size} />
      <View
        pointerEvents="none"
        style={[
          styles.searchSlot,
          {
            top: size * 0.5 - 92,
            left: (size - searchWidth) / 2,
            width: searchWidth,
          },
        ]}>
        <SearchInteraction
          opacity={sequence.searchOpacity}
          scale={sequence.searchScale}
          typedLength={sequence.typedLength}
          converge={sequence.converge}
          width={searchWidth}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  canvas: {
    overflow: 'visible',
  },
  searchSlot: {
    position: 'absolute',
    zIndex: 6,
    alignItems: 'center',
  },
});
