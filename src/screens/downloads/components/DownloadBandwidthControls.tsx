import { memo, useCallback, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { Switch } from '@/components/inputs/Switch';
import { useDownloadBandwidth } from '@/downloads/v2/bandwidth';
import { SPEED_LIMIT_CHOICES, speedLimitLabel, speedLimitShortLabel } from '@/downloads/v2/speed-limit';
import { useTranslation } from '@/localization';

/** Download details (F2): this download's own speed limit and the Priority mark, while it is not finished. */
export const DownloadBandwidthControls = memo(function DownloadBandwidthControls({ downloadId }: { downloadId: string }) {
  const { t } = useTranslation();
  const bandwidth = useDownloadBandwidth(downloadId);
  const [failed, setFailed] = useState(false);

  const labelFor = useCallback(
    (value: number) => {
      const label = speedLimitLabel(value);
      return label.kind === 'off'
        ? t('settings.speedLimitOff')
        : t(label.kind === 'mb' ? 'settings.speedLimitMb' : 'settings.speedLimitKb', { value: label.value });
    },
    [t],
  );
  const options = useMemo(
    () =>
      SPEED_LIMIT_CHOICES.map((choice) => ({
        value: String(choice),
        label: speedLimitShortLabel(choice, t('settings.speedLimitOff')),
        accessibilityLabel: labelFor(choice),
      })),
    [labelFor, t],
  );

  const onLimit = useCallback(
    async (next: string) => setFailed(!(await bandwidth.setSpeedLimit(Number(next)))),
    [bandwidth],
  );
  const onPriority = useCallback(
    async (next: boolean) => setFailed(!(await bandwidth.setPriority(next))),
    [bandwidth],
  );

  if (!bandwidth.available) {
    return null;
  }
  return (
    <Box mt={8} gap={12} testID="download-details-bandwidth">
      <Box gap={4}>
        <Text variant="body">{t('settings.downloadSpeedLimit')}</Text>
        <Text variant="caption" color="textSecondary">
          {t('settings.downloadSpeedLimitHint')}
        </Text>
      </Box>
      <SegmentedControl
        options={options}
        value={String(bandwidth.speedLimit)}
        onChange={(next) => {
          void onLimit(next);
        }}
        accessibilityLabel={`${t('settings.downloadSpeedLimit')}, ${labelFor(bandwidth.speedLimit)}`}
        testID="download-details-speed-limit"
      />
      <Box row style={{ alignItems: 'center', gap: 12 }}>
        <Box flex={1} gap={4}>
          <Text variant="body">{t('settings.downloadPriority')}</Text>
          <Text variant="caption" color="textSecondary">
            {t('settings.downloadPriorityHint')}
          </Text>
        </Box>
        <Switch
          value={bandwidth.priority}
          onValueChange={(next) => {
            void onPriority(next);
          }}
          accessibilityLabel={t('settings.downloadPriority')}
          accessibilityHint={t('settings.downloadPriorityHint')}
          testID="download-details-priority"
        />
      </Box>
      {failed ? (
        <Text variant="caption" color="error">
          {t('settings.downloadBandwidthFailed')}
        </Text>
      ) : null}
    </Box>
  );
});
