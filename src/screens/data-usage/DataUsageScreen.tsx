import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { TextField } from '@/components/inputs/TextField';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTheme } from '@/hooks/use-theme';
import { normalizeLimitMb } from '@/downloads/v2/data-usage';
import { resetDataUsageCounters, useDataUsageStore } from '@/downloads/v2/data-usage-store';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { SettingsRow, SettingsSection } from '@/screens/settings/components';
import { useSettingsTokens } from '@/screens/settings/theme/settings-tokens';
import { formatDownloadFileSize } from '@/screens/downloads/utils/download-format';
import { selectDataLimitDailyMb, selectDataLimitMonthlyMb, useSettingsStore } from '@/store/settings';

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

function LimitField({
  label,
  value,
  onCommit,
  testID,
}: {
  label: string;
  value: number;
  onCommit: (mb: number) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value > 0 ? String(value) : '');
  return (
    <TextField
      label={label}
      value={draft}
      onChangeText={(text) => setDraft(text.replace(/[^0-9]/g, '').slice(0, 8))}
      onEndEditing={() => onCommit(normalizeLimitMb(draft))}
      onSubmitEditing={() => onCommit(normalizeLimitMb(draft))}
      keyboardType="number-pad"
      placeholder={t('dataUsage.limitOff')}
      helperText={t('dataUsage.limitHint')}
      testID={testID}
    />
  );
}

/** Data usage: Daily (#416), Monthly (#417), Total Count (#418) and the optional Data Limit Alert (#422). */
export const DataUsageScreen = memo(function DataUsageScreen() {
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const summary = useDataUsageStore((state) => state.summary);
  const dailyMb = useSettingsStore(selectDataLimitDailyMb);
  const monthlyMb = useSettingsStore(selectDataLimitMonthlyMb);
  const [confirmReset, setConfirmReset] = useState(false);
  const goBack = useCallback(() => navigation.back(), []);

  return (
    <SafeAreaScreen
      testID="data-usage-screen"
      scrollable
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: settingsTokens.background }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: settingsTokens.spacing.screenX,
        paddingBottom: 40,
        gap: settingsTokens.spacing.sectionGap,
      }}>
      <ScreenHeader title={t('dataUsage.title')} showBack onBackPress={goBack} testID="data-usage-header" />

      <SettingsSection
        testID="data-usage-figures"
        title={t('dataUsage.downloadedSection')}
        description={t('dataUsage.downloadedDescription')}
        icon="chart-bar">
        <Figure label={t('dataUsage.today')} value={bytesLabel(summary.todayBytes)} testID="data-usage-today" />
        <Figure label={t('dataUsage.thisMonth')} value={bytesLabel(summary.monthBytes)} testID="data-usage-month" />
        <Figure label={t('dataUsage.last30Days')} value={bytesLabel(summary.last30DaysBytes)} testID="data-usage-30" />
        <Figure label={t('dataUsage.total')} value={bytesLabel(summary.totalBytes)} testID="data-usage-total" />
        <Figure
          label={t('dataUsage.completed')}
          value={String(summary.completedCount)}
          testID="data-usage-completed"
        />
      </SettingsSection>

      <SettingsSection
        testID="data-usage-limits"
        title={t('dataUsage.limitsSection')}
        description={t('dataUsage.limitsDescription')}
        icon="bell-alert-outline">
        <Box gap={12} py={8}>
          <LimitField
            label={t('dataUsage.dailyLimit')}
            value={dailyMb}
            onCommit={(mb) => useSettingsStore.getState().updateSetting('dataLimitDailyMb', mb)}
            testID="data-usage-daily-limit"
          />
          <LimitField
            label={t('dataUsage.monthlyLimit')}
            value={monthlyMb}
            onCommit={(mb) => useSettingsStore.getState().updateSetting('dataLimitMonthlyMb', mb)}
            testID="data-usage-monthly-limit"
          />
        </Box>
      </SettingsSection>

      <SettingsSection testID="data-usage-reset" title={t('dataUsage.resetSection')} icon="restore">
        <SettingsRow
          title={t('dataUsage.reset')}
          description={t('dataUsage.resetHint')}
          icon="counter"
          destructive
          onPress={() => setConfirmReset(true)}
          showDivider={false}
          testID="data-usage-reset-row"
        />
      </SettingsSection>

      <ConfirmModal
        visible={confirmReset}
        variant="warning"
        title={t('dataUsage.resetConfirmTitle')}
        message={t('dataUsage.resetConfirmMessage')}
        confirmLabel={t('dataUsage.reset')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setConfirmReset(false);
          resetDataUsageCounters();
        }}
        onCancel={() => setConfirmReset(false)}
        testID="data-usage-reset-confirm"
      />
    </SafeAreaScreen>
  );
});
