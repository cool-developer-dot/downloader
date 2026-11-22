import { memo, useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { DsCard, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { useDownloadProgressDetails } from '../hooks/useDownloadProgressDetails';
import { DownloadSpeedGraph } from './DownloadSpeedGraph';

function DetailsRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  const theme = useTheme();
  const { rtl } = useTranslation();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: rtl.rowDirection,
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
      }}
      accessibilityLabel={`${label}: ${value}`}>
      <DsText variant="rowSub">{label}</DsText>
      <View style={{ flex: 1, minWidth: 0 }}>
        <DsText variant="rowValue" color="textPrimary" numberOfLines={1} align={rtl.isRtl ? 'left' : 'right'}>
          {value}
        </DsText>
      </View>
    </View>
  );
}

/**
 * Download Details: Remaining Size (#308), Average Speed (#312), Elapsed Time (#314), Segment Progress (#315) and
 * Speed Graph (#316) of a queued, running or paused v2 download. Each row is left out while its value is unknown.
 */
export const DownloadProgressDetailsRows = memo(function DownloadProgressDetailsRows({ id }: { id: string }) {
  const { t } = useTranslation();
  const details = useDownloadProgressDetails(id);

  return (
    <>
      {details.remaining ? (
        <DetailsRow
          label={t('downloadProgress.remaining')}
          value={details.remaining}
          testID="download-details-remaining"
        />
      ) : null}
      {details.averageSpeed ? (
        <DetailsRow
          label={t('downloadProgress.averageSpeed')}
          value={details.averageSpeed}
          testID="download-details-average-speed"
        />
      ) : null}
      {details.elapsed ? (
        <DetailsRow
          label={t('downloadProgress.elapsed')}
          value={details.elapsed}
          testID="download-details-elapsed"
        />
      ) : null}
      {details.segments ? (
        <DetailsRow
          label={t('downloadProgress.segments')}
          value={t('downloadProgress.segmentsValue', {
            done: details.segments.done,
            total: details.segments.total,
          })}
          testID="download-details-segments"
        />
      ) : null}
      {details.graph ? (
        <View style={{ paddingVertical: 10, gap: 6 }}>
          <DsText variant="rowSub">{t('downloadProgress.speedGraph')}</DsText>
          <DownloadSpeedGraph
            points={details.graph.points}
            maxBps={details.graph.maxBps}
            accessibilityLabel={t('downloadProgress.speedGraphA11y')}
            testID="download-details-speed-graph"
          />
        </View>
      ) : null}
    </>
  );
});

/** The design's segment card is 64 dp tall with 7 dp of padding: a full bar is 50 dp. */
const BAR_MAX_HEIGHT = 50;
const BAR_MIN_HEIGHT = 3;

export type DownloadSegmentBarsProps = {
  /** One entry per connection / part, each 0 … 1. */
  fractions: readonly number[];
  testID?: string;
};

/**
 * Design 12's SEGMENTS card: one red bar per part, bottom-aligned, its height the part's done fraction, fading
 * downward. The engine reports no per-connection progress today, so the screen passes one bar for the whole download.
 */
export const DownloadSegmentBars = memo(function DownloadSegmentBars({ fractions, testID = 'download-details-segment-bars' }: DownloadSegmentBarsProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <DsCard testID={testID} style={{ padding: 7 }}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('lightDetails.segmentsA11y')}
        accessibilityValue={{
          min: 0,
          max: 100,
          now: Math.round((fractions.reduce((sum, value) => sum + value, 0) / Math.max(1, fractions.length)) * 100),
        }}
        style={{ flexDirection: rtl.rowDirection, alignItems: 'flex-end', gap: ds.space.chip, height: BAR_MAX_HEIGHT }}>
        {fractions.map((fraction, index) => {
          const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
          const height = Math.max(BAR_MIN_HEIGHT, Math.round(clamped * BAR_MAX_HEIGHT));
          const id = `${gradientId}-${index}`;
          return (
            <View
              // Bars are positional: the engine reports parts in order.
              key={index}
              style={{ flex: 1, height }}
              accessibilityLabel={t('lightDetails.segmentA11y', { index: index + 1, percent: Math.round(clamped * 100) })}>
              <Svg width="100%" height={height}>
                <Defs>
                  <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={theme.colors.primary} stopOpacity={1} />
                    <Stop offset="1" stopColor={theme.colors.primary} stopOpacity={0.28} />
                  </LinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height={height} rx={ds.radius.progress} fill={`url(#${id})`} />
              </Svg>
            </View>
          );
        })}
      </View>
    </DsCard>
  );
});
