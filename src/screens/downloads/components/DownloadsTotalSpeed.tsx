import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { ds, DsCard, DsIcon, DsText } from '@/design';
import { GRAPH_BUCKET_MS, type SpeedSample } from '@/downloads/v2/progress-stats';
import { getProgressStats, useProgressStatsRevision } from '@/downloads/v2/progress-stats-store';
import { useRtl, useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

import { useHasRunningDownload, useTotalDownloadSpeed } from '../hooks/useDownloadProgressDetails';
import { formatTransferSpeed } from '../utils/download-format';
import { DownloadSpeedGraph } from './DownloadSpeedGraph';

/** The design's graph: 12 bars, one per second. */
export const TOTAL_SPEED_BARS = 12;
/** The bars' box; the tallest bar fills it (the design's ≈ 60 dp peak plus its rounded cap). */
const GRAPH_HEIGHT = 64;

/**
 * Pure: the running downloads' speeds summed per second over the last `buckets` seconds, oldest first (the newest
 * sample of a second stands for that second, as the per-download graph does). Null until any sample exists.
 */
export function totalSpeedSeries(
  sampleLists: readonly (readonly SpeedSample[])[],
  now: number,
  buckets: number = TOTAL_SPEED_BARS,
): { points: number[]; maxBps: number } | null {
  if (!Number.isFinite(now) || buckets <= 0) {
    return null;
  }
  const points = new Array<number>(buckets).fill(0);
  let any = false;
  for (const samples of sampleLists) {
    const perSecond = new Array<number | null>(buckets).fill(null);
    for (const sample of samples) {
      if (!Number.isFinite(sample.bps) || sample.bps < 0 || sample.at > now) {
        continue;
      }
      const index = buckets - 1 - Math.floor((now - sample.at) / GRAPH_BUCKET_MS);
      if (index >= 0 && index < buckets) {
        perSecond[index] = sample.bps;
      }
    }
    for (let i = 0; i < buckets; i += 1) {
      const value = perSecond[i];
      if (value != null) {
        points[i] += value;
        any = true;
      }
    }
  }
  if (!any) {
    return null;
  }
  const maxBps = Math.max(...points);
  return Number.isFinite(maxBps) && maxBps > 0 ? { points, maxBps } : null;
}

function selectRunningEngineIds(state: ReturnType<typeof useDownloadsStore.getState>): string {
  return Object.entries(state.engineRowsById)
    .filter(([, item]) => item.status === 'DOWNLOADING')
    .map(([id]) => id)
    .join('\n');
}

/** The last 12 seconds of the running downloads' combined speed, re-read at most once a second. */
function useTotalSpeedGraph(): { points: number[]; maxBps: number } | null {
  'use no memo'; // Reads the stats map outside React (re-read on `revision`): compiled, the React Compiler kept the first null and the bars never drew.
  const runningIds = useDownloadsStore(selectRunningEngineIds);
  const revision = useProgressStatsRevision((state) => state.revision);
  return useMemo(() => {
    void revision; // Only a re-read signal: the samples themselves live in the stats map.
    const lists: SpeedSample[][] = [];
    let newestAt: number | null = null;
    for (const id of runningIds ? runningIds.split('\n') : []) {
      const stats = getProgressStats(id);
      if (!stats || stats.samples.length === 0) {
        continue;
      }
      lists.push(stats.samples);
      const last = stats.samples[stats.samples.length - 1]!.at;
      newestAt = newestAt == null ? last : Math.max(newestAt, last);
    }
    return newestAt == null ? null : totalSpeedSeries(lists, newestAt);
  }, [revision, runningIds]);
}

export type DownloadsTotalSpeedProps = {
  /**
   * `line` (default; the queue screen): one grey line "Total speed 14.2 MB/s". `card` (the design's Downloads
   * list): a white card with the label, the figure and the 12-bar graph.
   */
  variant?: 'line' | 'card';
  testID?: string;
};

/**
 * Total Speed Overview (#322): the running v2 downloads' combined speed. Shown while one runs — with "—" until a speed
 * is known, so the list below never jumps a line between progress ticks — and hidden when none runs.
 */
export const DownloadsTotalSpeed = memo(function DownloadsTotalSpeed({
  variant = 'line',
  testID = 'downloads-total-speed',
}: DownloadsTotalSpeedProps) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const speed = useTotalDownloadSpeed();
  const running = useHasRunningDownload();
  const graph = useTotalSpeedGraph();

  if (!speed && !running) {
    return null;
  }

  if (variant === 'line') {
    const label = t('downloadProgress.totalSpeed', { speed: speed ?? '—' });
    return (
      <View
        testID={testID}
        accessibilityRole="text"
        accessibilityLabel={label}
        style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6, paddingHorizontal: 16 }}>
        <DsIcon name="gauge" size={16} color="textSecondary" strokeWidth={1.8} />
        <DsText variant="rowSub" numberOfLines={1}>
          {label}
        </DsText>
      </View>
    );
  }

  const value = speed ?? '—';
  return (
    <DsCard testID={testID} style={{ paddingTop: 15, paddingBottom: 12 }}>
      <View
        accessibilityRole="text"
        accessibilityLabel={t('downloadProgress.totalSpeed', { speed: value })}
        style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
        <DsIcon name="download" size={12} color="textSecondary" strokeWidth={1.9} />
        <DsText variant="rowValue" numberOfLines={1} style={{ flex: 1 }}>
          {t('lightDownloads.totalSpeed')}
        </DsText>
        <DsText variant="rowTitle" numberOfLines={1} style={{ fontSize: ds.text.rowValue, lineHeight: ds.text.rowSubLine }}>
          {value}
        </DsText>
      </View>
      <View style={{ marginTop: 14, height: GRAPH_HEIGHT, justifyContent: 'flex-end' }}>
        {graph ? (
          <DownloadSpeedGraph
            variant="bars"
            points={graph.points}
            maxBps={graph.maxBps}
            height={GRAPH_HEIGHT}
            accessibilityLabel={t('lightDownloads.speedGraphA11y', {
              seconds: TOTAL_SPEED_BARS,
              max: formatTransferSpeed(graph.maxBps) ?? '—',
            })}
            testID={`${testID}-graph`}
          />
        ) : null}
      </View>
    </DsCard>
  );
});
