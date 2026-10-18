import { memo, useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { IconButton } from '@/components/buttons/IconButton';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { formatMinuteOfDay, formatWhen, startAtFrom, stepMinuteOfDay } from '@/downloads/v2/conditions';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

/** The default start time offered: 02:00 (a quiet hour for most networks). */
const DEFAULT_START_MINUTE = 2 * 60;

/**
 * Download details → "Start at…" (F3): when an unfinished download may start — today or tomorrow at a quarter-hour.
 * The engine keeps the time (it survives restarts and reboots); Android decides the exact moment, so the start can be
 * a few minutes late.
 */
export const DownloadStartAtControl = memo(function DownloadStartAtControl({
  downloadId,
  startAt,
}: {
  downloadId: string;
  /** The download's current start time (epoch ms), from its record. */
  startAt: number | null;
}) {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const engine = getV2Engine();
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState<'today' | 'tomorrow'>('tomorrow');
  const [minute, setMinute] = useState(DEFAULT_START_MINUTE);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const apply = useCallback(
    async (next: number | null) => {
      if (!engine?.setDownloadStartAt) {
        return;
      }
      setBusy(true);
      try {
        await engine.setDownloadStartAt(downloadId, next);
        setFailed(false);
        setEditing(false);
      } catch {
        setFailed(true);
      } finally {
        setBusy(false);
      }
    },
    [downloadId, engine],
  );

  if (typeof engine?.setDownloadStartAt !== 'function') {
    return null;
  }

  const now = Date.now();
  const current = startAt != null && startAt > now ? formatWhen(startAt, now, language) : null;

  return (
    <Box mt={8} gap={10} testID="download-details-start-at">
      <Box row rtlRow style={{ alignItems: 'center', justifyContent: 'space-between' }} gap={12}>
        <Box flex={1} gap={4}>
          <Text variant="body">{t('downloads.startAtTitle')}</Text>
          <Text variant="caption" color="textSecondary">
            {current ? t('downloads.startAtSet', { time: current }) : t('downloads.startAtNow')}
          </Text>
        </Box>
        {!editing ? (
          <Button
            title={current ? t('downloads.startAtChange') : t('downloads.startAtChoose')}
            variant="outline"
            size="small"
            onPress={() => setEditing(true)}
            testID="download-details-start-at-edit"
          />
        ) : null}
      </Box>

      {editing ? (
        <Box
          gap={10}
          p={12}
          borderRadius="md"
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border }}>
          <SegmentedControl
            options={[
              { value: 'today', label: t('downloads.startAtToday') },
              { value: 'tomorrow', label: t('downloads.startAtTomorrow') },
            ]}
            value={day}
            onChange={(next) => setDay(next === 'today' ? 'today' : 'tomorrow')}
            accessibilityLabel={t('downloads.startAtDay')}
            testID="download-details-start-at-day"
          />
          <Box row style={{ alignItems: 'center', justifyContent: 'center' }} gap={16}>
            <IconButton
              icon="minus"
              variant="outline"
              size="small"
              onPress={() => setMinute((m) => stepMinuteOfDay(m, -1))}
              accessibilityLabel={t('downloads.startAtEarlier')}
              testID="download-details-start-at-earlier"
            />
            <Text variant="title" style={{ minWidth: 72, textAlign: 'center' }} testID="download-details-start-at-time">
              {formatMinuteOfDay(minute)}
            </Text>
            <IconButton
              icon="plus"
              variant="outline"
              size="small"
              onPress={() => setMinute((m) => stepMinuteOfDay(m, 1))}
              accessibilityLabel={t('downloads.startAtLater')}
              testID="download-details-start-at-later"
            />
          </Box>
          <Text variant="caption" color="textSecondary">
            {t('downloads.startAtLateNote')}
          </Text>
          <Box row rtlRow gap={8}>
            <Box flex={1}>
              <Button
                title={t('downloads.startAtSave')}
                size="small"
                loading={busy}
                onPress={() => {
                  void apply(startAtFrom(day, minute, Date.now()));
                }}
                fullWidth
                testID="download-details-start-at-save"
              />
            </Box>
            <Box flex={1}>
              <Button
                title={current ? t('downloads.startAtClear') : t('common.cancel')}
                variant="ghost"
                size="small"
                disabled={busy}
                onPress={() => {
                  if (current) {
                    void apply(null);
                  } else {
                    setEditing(false);
                  }
                }}
                fullWidth
                testID="download-details-start-at-clear"
              />
            </Box>
          </Box>
        </Box>
      ) : null}

      {failed ? (
        <Text variant="caption" color="error">
          {t('downloads.startAtFailed')}
        </Text>
      ) : null}
    </Box>
  );
});
