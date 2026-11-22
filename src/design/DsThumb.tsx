import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { DsIcon, type DsIconName } from './DsIcon';
import { ds, dsThumbColors } from './tokens';

export type DsThumbProps = {
  /** A picture when there is one; otherwise the design's coloured block with a glyph. */
  uri?: string | null;
  /** `video` (dark green, ▶) for a finished video, `transfer` (slate, ⤓) for one in progress. */
  kind?: 'video' | 'transfer';
  icon?: DsIconName;
  width?: number;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** A picture that fails to load falls back to the coloured block. The 54 × 45 thumbnail of the recent / download rows: the picture, or a two-tone block with a white glyph. */
export const DsThumb = memo(function DsThumb({
  uri,
  kind = 'video',
  icon,
  width = ds.size.thumbWidth,
  height = ds.size.thumbHeight,
  radius = ds.radius.thumb,
  style,
  testID,
}: DsThumbProps) {
  const [failed, setFailed] = useState(false);
  const palette = dsThumbColors[kind];
  const glyph: DsIconName = icon ?? (kind === 'video' ? 'play' : 'download');
  return (
    <View
      testID={testID}
      style={[{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: palette.base, alignItems: 'center', justifyContent: 'center' }, style]}>
      {uri && !failed ? (
        <Image source={{ uri }} style={{ width, height }} contentFit="cover" transition={120} onError={() => setFailed(true)} />
      ) : (
        <>
          {/* A lighter top-left corner stands in for the design's gradient without a gradient library. */}
          <View
            style={{
              position: 'absolute',
              top: -height,
              left: -width * 0.4,
              width: width * 1.6,
              height: height * 1.8,
              borderRadius: width,
              backgroundColor: palette.light,
              opacity: 0.55,
            }}
          />
          <DsIcon name={glyph} size={kind === 'video' ? 18 : 17} color="#FFFFFF" strokeWidth={2.2} />
        </>
      )}
    </View>
  );
});
