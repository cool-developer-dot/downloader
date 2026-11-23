import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DsButton, DsChip, DsChipRow, DsSectionLabel, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import {
  SECOND_SUBTITLE_POSITIONS,
  SUBTITLE_ANCHORS,
  SUBTITLE_COLORS,
  SUBTITLE_COLOR_HEX,
  SUBTITLE_EDGES,
  SUBTITLE_FONTS,
  SUBTITLE_SIZES,
  stepSubtitleMargin,
  type SecondSubtitlePosition,
  type SubtitleAnchor,
  type SubtitleColor,
  type SubtitleEdge,
  type SubtitleFont,
  type SubtitleSize,
  type SubtitleStyle,
} from '@/player/subtitles/subtitle-style';

import { PlayerSheetFrame } from './PlayerSheetFrame';
import { SubtitleOverlay } from './SubtitleOverlay';

const SIZE_LABELS: Record<SubtitleSize, TranslationKey> = {
  small: 'videoPlayer.subtitleSizeSmall',
  medium: 'videoPlayer.subtitleSizeMedium',
  large: 'videoPlayer.subtitleSizeLarge',
  xlarge: 'videoPlayer.subtitleSizeXlarge',
};
const COLOR_LABELS: Record<SubtitleColor, TranslationKey> = {
  white: 'videoPlayer.subtitleColorWhite',
  yellow: 'videoPlayer.subtitleColorYellow',
  black: 'videoPlayer.subtitleColorBlack',
  red: 'videoPlayer.subtitleColorRed',
  green: 'videoPlayer.subtitleColorGreen',
  cyan: 'videoPlayer.subtitleColorCyan',
};
const FONT_LABELS: Record<SubtitleFont, TranslationKey> = {
  system: 'videoPlayer.subtitleFontSystem',
  inter: 'videoPlayer.subtitleFontInter',
  serif: 'videoPlayer.subtitleFontSerif',
  monospace: 'videoPlayer.subtitleFontMonospace',
  condensed: 'videoPlayer.subtitleFontCondensed',
  nastaliq: 'videoPlayer.subtitleFontNastaliq',
};
const EDGE_LABELS: Record<SubtitleEdge, TranslationKey> = {
  box: 'videoPlayer.subtitleEdgeBox',
  outline: 'videoPlayer.subtitleEdgeOutline',
  shadow: 'videoPlayer.subtitleEdgeShadow',
  none: 'videoPlayer.subtitleEdgeNone',
};
const ANCHOR_LABELS: Record<SubtitleAnchor, TranslationKey> = {
  bottom: 'videoPlayer.subtitlePositionBottom',
  top: 'videoPlayer.subtitlePositionTop',
};
const SECOND_LABELS: Record<SecondSubtitlePosition, TranslationKey> = {
  next: 'videoPlayer.subtitleSecondNext',
  top: 'videoPlayer.subtitleSecondTop',
};

/** The preview's picture: a fixed dark frame, so the colours read the same in all six themes. */
const PREVIEW_HEIGHT = 180;
const PREVIEW_BACKGROUND = '#26262B';

export type SubtitleStyleSheetProps = {
  visible: boolean;
  style: SubtitleStyle;
  /** A second subtitle is chosen for this video: the preview shows two, and the second's place can be chosen. */
  showSecond: boolean;
  onChange: (change: Partial<SubtitleStyle>) => void;
  onReset: () => void;
  onClose: () => void;
};

/**
 * P4 Subtitle style, app-wide, with a live preview: Size (#592), Colour (#593, the design's four swatches first), Font
 * (#594), Background / outline (#595), Position (#596) and, with two subtitles, where the second goes (#599).
 * Every change applies at once (the video behind keeps playing with it).
 */
export const SubtitleStyleSheet = memo(function SubtitleStyleSheet({
  visible,
  style,
  showSecond,
  onChange,
  onReset,
  onClose,
}: SubtitleStyleSheetProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  return (
    <PlayerSheetFrame visible={visible} title={t('videoPlayer.subtitleStyleTitle')} onClose={onClose} testID="player-subtitle-style-sheet">
      <View
        style={[styles.preview, { backgroundColor: PREVIEW_BACKGROUND }]}
        accessibilityLabel={t('videoPlayer.subtitlePreview')}
        testID="player-subtitle-style-preview">
        <SubtitleOverlay
          primaryCues={[t('videoPlayer.subtitlePreviewLine')]}
          secondaryCues={showSecond ? [t('videoPlayer.subtitlePreviewSecond')] : []}
          primaryFile
          primaryNative={false}
          secondaryOn={showSecond}
          style={style}
          areaHeight={PREVIEW_HEIGHT}
          insetBottom={0}
          insetTop={0}
        />
      </View>

      <DsSectionLabel first>{t('videoPlayer.subtitleSize')}</DsSectionLabel>
      <DsChipRow testID="player-subtitle-size">
        {SUBTITLE_SIZES.map((size) => (
          <DsChip key={size} label={t(SIZE_LABELS[size])} selected={style.size === size} onPress={() => onChange({ size })} />
        ))}
      </DsChipRow>

      <DsSectionLabel>{t('videoPlayer.subtitleColor')}</DsSectionLabel>
      <View style={[styles.swatches, { flexDirection: rtl.rowDirection }]} accessibilityRole="radiogroup" testID="player-subtitle-color">
        {SUBTITLE_COLORS.map((color) => {
          const selected = style.color === color;
          return (
            <Pressable
              key={color}
              onPress={() => onChange({ color })}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              accessibilityLabel={t(COLOR_LABELS[color])}
              hitSlop={6}
              style={[styles.swatchRing, { borderColor: selected ? theme.colors.primary : 'transparent' }]}
              testID={`player-subtitle-color-${color}`}>
              <View
                style={[
                  styles.swatch,
                  {
                    backgroundColor: SUBTITLE_COLOR_HEX[color],
                    // The design draws white with a grey edge so it shows on a white sheet; every swatch gets the
                    // theme's border, so black shows on the dark themes too.
                    borderColor: theme.colors.border,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      <DsSectionLabel>{t('videoPlayer.subtitleFont')}</DsSectionLabel>
      <DsChipRow testID="player-subtitle-font">
        {SUBTITLE_FONTS.map((font) => (
          <DsChip key={font} label={t(FONT_LABELS[font])} selected={style.font === font} onPress={() => onChange({ font })} />
        ))}
      </DsChipRow>

      <DsSectionLabel>{t('videoPlayer.subtitleEdge')}</DsSectionLabel>
      <DsChipRow testID="player-subtitle-edge">
        {SUBTITLE_EDGES.map((edge) => (
          <DsChip key={edge} label={t(EDGE_LABELS[edge])} selected={style.edge === edge} onPress={() => onChange({ edge })} />
        ))}
      </DsChipRow>

      <DsSectionLabel>{t('videoPlayer.subtitlePosition')}</DsSectionLabel>
      <DsChipRow testID="player-subtitle-anchor">
        {SUBTITLE_ANCHORS.map((anchor) => (
          <DsChip key={anchor} label={t(ANCHOR_LABELS[anchor])} selected={style.anchor === anchor} onPress={() => onChange({ anchor })} />
        ))}
      </DsChipRow>
      <View style={[styles.stepper, { flexDirection: rtl.rowDirection }]}>
        <DsButton
          label={t('videoPlayer.subtitlePositionToward')}
          variant="secondary"
          flex
          disabled={style.marginPercent <= 0}
          onPress={() => onChange({ marginPercent: stepSubtitleMargin(style, -1).marginPercent })}
          testID="player-subtitle-margin-toward"
        />
        <DsButton
          label={t('videoPlayer.subtitlePositionAway')}
          variant="secondary"
          flex
          disabled={style.marginPercent >= 40}
          onPress={() => onChange({ marginPercent: stepSubtitleMargin(style, 1).marginPercent })}
          testID="player-subtitle-margin-away"
        />
      </View>
      <DsText variant="rowSub" align="center" accessibilityLiveRegion="polite" testID="player-subtitle-margin">
        {t('videoPlayer.subtitlePositionMargin', { percent: style.marginPercent })}
      </DsText>

      {showSecond ? (
        <>
          <DsSectionLabel>{t('videoPlayer.subtitleSecondPosition')}</DsSectionLabel>
          <DsChipRow testID="player-subtitle-second-position">
            {SECOND_SUBTITLE_POSITIONS.map((position) => (
              <DsChip
                key={position}
                label={t(SECOND_LABELS[position])}
                selected={style.secondPosition === position}
                onPress={() => onChange({ secondPosition: position })}
              />
            ))}
          </DsChipRow>
        </>
      ) : null}

      <DsText variant="rowSub">{t('videoPlayer.subtitleStyleNote')}</DsText>
      <DsButton label={t('videoPlayer.subtitleStyleReset')} variant="secondary" fullWidth onPress={onReset} testID="player-subtitle-style-reset" />
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  preview: {
    height: PREVIEW_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
  },
  swatches: {
    flexWrap: 'wrap',
    gap: 10,
  },
  swatchRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  stepper: {
    gap: 8,
  },
});
