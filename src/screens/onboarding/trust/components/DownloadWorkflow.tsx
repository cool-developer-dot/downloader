import { memo, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import type { TrustSequenceValues } from '../animations';
import { TRUST_CAPABILITIES, TRUST_LAYOUT } from '../constants';
import { trustStyles } from '../styles';
import { useTranslation } from '@/localization';

import { CapabilityChip } from './CapabilityChip';
import { DownloadCard } from './DownloadCard';
import { OfflineLibrary } from './OfflineLibrary';
import { UrlStage } from './UrlStage';

type DownloadWorkflowProps = {
  sequence: TrustSequenceValues;
};

/**
 * Living download workflow hero — paste → detect → download → offline.
 */
export const DownloadWorkflow = memo(function DownloadWorkflow({
  sequence,
}: DownloadWorkflowProps) {
  const { t } = useTranslation();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const cardWidth = useMemo(() => {
    const horizontalPad = 48;
    const available = windowWidth - horizontalPad;
    return Math.min(available, TRUST_LAYOUT.cardMaxWidth);
  }, [windowWidth]);

  const compact = windowHeight < 700;

  return (
    <View
      style={[trustStyles.workflow, compact && styles.compact]}
      accessibilityLabel={t('onboarding.downloadWorkflowA11y')}
      accessible>
      <UrlStage
        opacity={sequence.urlOpacity}
        scale={sequence.urlScale}
        translateY={sequence.urlTranslateY}
        urlLabelOpacity={sequence.urlLabelOpacity}
        detectedOpacity={sequence.detectedOpacity}
        checkOpacity={sequence.checkOpacity}
        checkScale={sequence.checkScale}
        checkGlow={sequence.checkGlow}
      />

      <View style={styles.stageCanvas}>
        <View style={styles.cardLayer}>
          <DownloadCard
            opacity={sequence.cardOpacity}
            scale={sequence.cardScale}
            breath={sequence.cardBreath}
            translateY={sequence.cardTranslateY}
            progress={sequence.progress}
            progressOpacity={sequence.progressOpacity}
            completedOpacity={sequence.completedOpacity}
            width={cardWidth}
          />
        </View>

        <View style={styles.librarySlot}>
          <OfflineLibrary opacity={sequence.libraryOpacity} glow={sequence.libraryGlow} />
        </View>
      </View>

      <View style={trustStyles.chipsRow}>
        {TRUST_CAPABILITIES.map((capability, index) => (
          <CapabilityChip
            key={capability.id}
            id={capability.id}
            label={capability.label}
            anim={sequence.chips[index]}
          />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  compact: {
    transform: [{ scale: 0.94 }],
  },
  stageCanvas: {
    width: '100%',
    alignItems: 'center',
    minHeight: 176,
  },
  cardLayer: {
    zIndex: 2,
    elevation: 2,
    alignItems: 'center',
    width: '100%',
  },
  librarySlot: {
    width: '100%',
    maxWidth: TRUST_LAYOUT.cardMaxWidth,
    marginTop: -36,
    zIndex: 1,
  },
});
