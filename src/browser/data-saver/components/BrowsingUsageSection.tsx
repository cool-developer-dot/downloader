import { memo, useEffect, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { formatDownloadFileSize } from '@/screens/downloads/utils/download-format';
import { SettingsRow, SettingsSection } from '@/screens/settings/components';

import {
  browsingTrafficSupported,
  refreshBrowsingTraffic,
  resetBrowsingTraffic,
  useBrowsingSummary,
} from '../browsing-traffic.service';

function bytesLabel(bytes: number): string {
  return formatDownloadFileSize(String(Math.max(0, Math.round(bytes)))) ?? '0 B';
}

function Figure({ label, value, testID }: { label: string; value: string; testID: string }) {
  const theme = useTheme();
  return (
    <Box
      row
      py={10}
      testID={testID}
      accessibilityLabel={`${label}: ${value}`}
      style={{ justifyContent: 'space-between', gap: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
      <Text variant="bodySmall" color="textSecondary">
        {label}
      </Text>
      <Text variant="bodySmall" color="textPrimary">
        {value}
      </Text>
    </Box>
  );
}

/** B18 #185 — Data usage → Browsing: today, this month, Reset (downloads not included). */
export const BrowsingUsageSection = memo(function BrowsingUsageSection() {
  const { t } = useTranslation();
  const summary = useBrowsingSummary();
  const [confirm, setConfirm] = useState(false);
  const [supported] = useState(browsingTrafficSupported);

  useEffect(() => {
    refreshBrowsingTraffic();
  }, []);

  return (
    <SettingsSection testID="data-usage-browsing" title={t('browserDataSaver.browsingSection')} description={t('browserDataSaver.browsingDescription')} icon="web">
      {supported ? (
        <>
          <Figure label={t('dataUsage.today')} value={bytesLabel(summary.todayBytes)} testID="data-usage-browsing-today" />
          <Figure label={t('dataUsage.thisMonth')} value={bytesLabel(summary.monthBytes)} testID="data-usage-browsing-month" />
        </>
      ) : (
        <Text variant="bodySmall" color="textSecondary" style={{ paddingVertical: 8 }}>
          {t('browserDataSaver.browsingUnsupported')}
        </Text>
      )}
      <SettingsRow
        title={t('browserDataSaver.browsingReset')}
        icon="restore"
        destructive
        onPress={() => setConfirm(true)}
        showDivider={false}
        testID="data-usage-browsing-reset"
      />
      <ConfirmModal
        visible={confirm}
        variant="warning"
        title={t('browserDataSaver.browsingResetTitle')}
        message={t('browserDataSaver.browsingResetMessage')}
        confirmLabel={t('browserDataSaver.browsingReset')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setConfirm(false);
          resetBrowsingTraffic();
        }}
        onCancel={() => setConfirm(false)}
        testID="data-usage-browsing-reset-confirm"
      />
    </SettingsSection>
  );
});
