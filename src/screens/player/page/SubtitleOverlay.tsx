import { memo, useMemo } from 'react';
import { Text as RNText, StyleSheet, View, type TextStyle } from 'react-native';

import { NASTALIQ_FONT_FAMILY, useNastaliqFont } from '@/browser/fonts/urdu-font';
import { planSubtitleBlocks, subtitleLines, type SubtitleTrackSlot } from '@/player/subtitles/subtitle-layout';
import {
  SUBTITLE_COLOR_HEX,
  SUBTITLE_SIZE_SCALE,
  subtitleEdgeColor,
  subtitleFontFamily,
  subtitleLineHeight,
  type SubtitleStyle,
} from '@/player/subtitles/subtitle-style';
import { nativeFontFamilies } from '@/theme/typography';

/** Text size for a picture area: about 5.5 % of its height, between 12 and 30 dp, times the chosen size (#592). */
export function subtitleFontSize(areaHeight: number, style?: Pick<SubtitleStyle, 'size'>): number {
  const base = Math.min(30, Math.max(12, areaHeight * 0.055));
  return Math.round(base * (style ? SUBTITLE_SIZE_SCALE[style.size] : 1));
}

export type SubtitleTrackTextProps = {
  /** The cues showing (a cue may hold several lines). */
  cues: readonly string[];
  style: SubtitleStyle;
  fontSize: number;
  testID?: string;
};

/**
 * One subtitle's text in the user's style (P4): colour (#593), font (#594; Nastaliq for Urdu / Arabic lines),
 * background box, outline or shadow (#595). Each line has its own direction (#600): a right-to-left line is laid out
 * right to left and aligned right; a left-to-right one is centred.
 */
export const SubtitleTrackText = memo(function SubtitleTrackText({ cues, style, fontSize, testID }: SubtitleTrackTextProps) {
  const nastaliqReady = useNastaliqFont(style.font === 'nastaliq');
  const lines = useMemo(() => cues.flatMap(subtitleLines), [cues]);
  if (lines.length === 0) {
    return null;
  }
  const color = SUBTITLE_COLOR_HEX[style.color];
  const edge: TextStyle =
    style.edge === 'outline'
      ? {
          textShadowColor: subtitleEdgeColor(style.color, 1),
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: Math.max(2, fontSize * 0.14),
        }
      : style.edge === 'shadow'
        ? {
            textShadowColor: subtitleEdgeColor(style.color, 0.9),
            textShadowOffset: { width: 1.5, height: 1.5 },
            textShadowRadius: 3,
          }
        : {};
  return (
    <View
      style={[styles.track, style.edge === 'box' ? { backgroundColor: subtitleEdgeColor(style.color, 0.6) } : null]}
      testID={testID}>
      {lines.map((line, index) => {
        const family = subtitleFontFamily(style.font, line.direction, {
          inter: nativeFontFamilies.body,
          nastaliq: NASTALIQ_FONT_FAMILY,
          nastaliqReady,
        });
        const nastaliq = family === NASTALIQ_FONT_FAMILY;
        return (
          <RNText
            key={`${index}:${line.text}`}
            style={[
              edge,
              {
                color,
                fontSize,
                lineHeight: subtitleLineHeight(fontSize, nastaliq),
                textAlign: line.direction === 'rtl' ? 'right' : 'center',
                fontFamily: family ?? undefined,
              },
            ]}>
            {line.text}
          </RNText>
        );
      })}
    </View>
  );
});

export type SubtitleOverlayProps = {
  /** The first subtitle's cues showing now (a subtitle file VidoraX draws). */
  primaryCues: readonly string[];
  /** P4 #599: the second subtitle's cues showing now. */
  secondaryCues: readonly string[];
  /** A subtitle file is the first subtitle (VidoraX draws it). */
  primaryFile: boolean;
  /** A track inside the video is the first subtitle (the player draws it, at the bottom). */
  primaryNative: boolean;
  /** A second subtitle is chosen. */
  secondaryOn: boolean;
  style: SubtitleStyle;
  /** Height of the picture area, in dp. */
  areaHeight: number;
  /** Room kept free at the bottom / top while the controls there show (the card's timeline, the top bar). */
  insetBottom: number;
  insetTop: number;
};

/**
 * Subtitle files over the picture (outside the mirror / fit frame: never flipped or cropped), placed by the style's
 * edge and distance (#596) and, with two, by the dual layout (#599). It never takes a touch.
 */
export const SubtitleOverlay = memo(function SubtitleOverlay({
  primaryCues,
  secondaryCues,
  primaryFile,
  primaryNative,
  secondaryOn,
  style,
  areaHeight,
  insetBottom,
  insetTop,
}: SubtitleOverlayProps) {
  const blocks = planSubtitleBlocks({ primary: primaryFile, primaryNative, secondary: secondaryOn, style });
  if (blocks.length === 0 || (primaryCues.length === 0 && secondaryCues.length === 0)) {
    return null;
  }
  const fontSize = subtitleFontSize(areaHeight, style);
  const cuesOf = (slot: SubtitleTrackSlot) => (slot === 'primary' ? primaryCues : secondaryCues);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" testID="player-subtitles">
      {blocks.map((block) => {
        const distance = Math.round((areaHeight * block.marginPercent) / 100) + 6;
        return (
          <View
            key={block.anchor}
            style={[styles.block, block.anchor === 'bottom' ? { bottom: distance + insetBottom } : { top: distance + insetTop }]}>
            {block.tracks.map((slot) => (
              <SubtitleTrackText
                key={slot}
                cues={cuesOf(slot)}
                style={style}
                fontSize={fontSize}
                testID={`player-subtitles-${slot}`}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  block: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: '5%',
    gap: 4,
    zIndex: 4,
  },
  track: {
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
