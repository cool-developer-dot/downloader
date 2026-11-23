import { memo } from 'react';
import { View } from 'react-native';

import { DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useLibraryStatsStore } from '@/library/library-stats-store';
import { useTranslation } from '@/localization';

import { formatDownloadDate } from '../utils/download-format';

/**
 * P9 #708 Play Count in the video's details (Download details → Info): "Played · 3 times" and when the last counted
 * play was. A play counts after 30 s watched (or the whole of a shorter video), once per viewing.
 */
export const DownloadPlayCountRows = memo(function DownloadPlayCountRows({ id }: { id: string }) {
  const { t } = useTranslation();
  const plays = useLibraryStatsStore((state) => state.playCounts[id]);
  const count = plays?.playCount ?? 0;
  const value =
    count === 0
      ? t('libraryStats.playCountNone')
      : count === 1
        ? t('libraryStats.playCountOnce')
        : t('libraryStats.playCountTimes', { count });
  const last = count > 0 ? formatDownloadDate(plays?.lastPlayedAt ?? null) : null;
  return (
    <>
      <PlayRow label={t('libraryStats.playCountLabel')} value={value} testID="download-details-play-count" />
      {last ? <PlayRow label={t('libraryStats.lastCountedLabel')} value={last} testID="download-details-last-played" /> : null}
    </>
  );
});

/** The Info panel's row look ("Format · MP4"). */
function PlayRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  const theme = useTheme();
  const { rtl } = useTranslation();
  return (
    <View
      style={{
        flexDirection: rtl.rowDirection,
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
      }}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}>
      <DsText variant="rowSub">{label}</DsText>
      <View style={{ flex: 1, minWidth: 0 }}>
        <DsText variant="rowValue" color="textPrimary" numberOfLines={2} align={rtl.isRtl ? 'left' : 'right'}>
          {value}
        </DsText>
      </View>
    </View>
  );
}
