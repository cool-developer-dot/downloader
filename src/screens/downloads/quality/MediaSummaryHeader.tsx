import { memo } from 'react';
import { View } from 'react-native';

import { DsCard, DsText, DsThumb, ds } from '@/design';
import {
  buildMediaInfoLine,
  resolveDisplayHost,
  resolveDisplayTitle,
  type AnalyzedMediaSelection,
} from '@/downloads/quality';
import { useTranslation } from '@/localization';

export type MediaSummaryHeaderProps = {
  selection: AnalyzedMediaSelection;
  testID?: string;
};

/** A compact "thumbnail · title · host · info" card for an analysed link. */
export const MediaSummaryHeader = memo(function MediaSummaryHeader({
  selection,
  testID = 'quality-media-summary',
}: MediaSummaryHeaderProps) {
  const { t, rtl } = useTranslation();
  const title = resolveDisplayTitle(selection);
  const host = resolveDisplayHost(selection);
  const info = buildMediaInfoLine(selection);
  const thumbnail = selection.thumbnailUrl?.trim() || null;

  return (
    <DsCard testID={testID}>
      <View
        style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: ds.space.rowGap }}
        accessibilityRole="text"
        accessibilityLabel={[title, host, info].filter(Boolean).join('. ')}>
        <View accessibilityRole="image" accessibilityLabel={thumbnail ? t('mediaResult.thumbnailA11y') : t('mediaResult.placeholderA11y')}>
          <DsThumb uri={thumbnail} kind="video" icon={selection.mediaType === 'audio' ? 'music' : 'play'} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <DsText variant="rowTitle" numberOfLines={2}>
            {title}
          </DsText>
          {host ? (
            <DsText variant="rowSub" numberOfLines={1}>
              {host}
            </DsText>
          ) : null}
          {info ? (
            <DsText variant="rowSub" numberOfLines={1}>
              {info}
            </DsText>
          ) : null}
        </View>
      </View>
    </DsCard>
  );
});
