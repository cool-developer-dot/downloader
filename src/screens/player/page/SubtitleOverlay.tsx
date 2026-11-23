import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsText } from '@/design';

export type SubtitleOverlayProps = {
  /** The cues showing now (a cue may hold several lines). */
  lines: readonly string[];
  /** Height of the picture area, in dp: the text scales with it (smaller on the page's card, larger in full screen). */
  areaHeight: number;
  /** Distance from the area's bottom (lifted over the card's timeline while it shows). */
  bottom: number;
};

/** Text size for a picture area: about 5.5 % of its height, between 12 and 30 dp. */
export function subtitleFontSize(areaHeight: number): number {
  return Math.round(Math.min(30, Math.max(12, areaHeight * 0.055)));
}

/**
 * P3: a subtitle file's text over the picture (outside the mirror / fit frame, so it is never flipped or cropped).
 * White on a dark box at the bottom, centred. It never takes a touch.
 */
export const SubtitleOverlay = memo(function SubtitleOverlay({ lines, areaHeight, bottom }: SubtitleOverlayProps) {
  if (lines.length === 0) {
    return null;
  }
  const fontSize = subtitleFontSize(areaHeight);
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" testID="player-subtitles">
      <View style={styles.box}>
        <DsText
          variant="body"
          color="#FFFFFF"
          align="center"
          style={{ fontSize, lineHeight: Math.round(fontSize * 1.3) }}>
          {lines.join('\n')}
        </DsText>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: '5%',
    zIndex: 4,
  },
  box: {
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
});
