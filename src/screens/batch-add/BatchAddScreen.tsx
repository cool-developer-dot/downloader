import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { TextField } from '@/components/inputs/TextField';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { navigation } from '@/navigation';
import { useSettingsTokens } from '@/screens/settings/theme/settings-tokens';

import { useBatchAdd, type BatchRow } from './useBatchAdd';

const OUTCOME_LABEL: Record<string, TranslationKey> = {
  added: 'linkIntake.outcomeAdded',
  duplicate: 'linkIntake.outcomeDuplicate',
  'needs-review': 'linkIntake.outcomeReview',
  refused: 'linkIntake.outcomeRefused',
};

function rowLabel(row: BatchRow, t: (key: TranslationKey) => string): string {
  if (row.status === 'pending') return t('linkIntake.statusWaiting');
  if (row.status === 'running') return t('linkIntake.statusChecking');
  return row.result ? t(OUTCOME_LABEL[row.result.outcome] ?? 'linkIntake.outcomeReview') : '';
}

/** Batch Add (#292): paste several links (or import a .txt file, #293); each one is checked and, if possible, added. */
export const BatchAddScreen = memo(function BatchAddScreen() {
  const theme = useTheme();
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const batch = useBatchAdd();
  const goBack = useCallback(() => navigation.back(), []);

  const reviewRows = batch.rows.filter((row) => row.result?.outcome === 'needs-review');

  return (
    <SafeAreaScreen
      testID="batch-add-screen"
      scrollable
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: settingsTokens.background }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: settingsTokens.spacing.screenX, paddingBottom: 40, gap: 16 }}>
      <ScreenHeader title={t('linkIntake.batchTitle')} showBack onBackPress={goBack} testID="batch-add-header" />

      <Text variant="bodySmall" color="textSecondary">
        {t('linkIntake.batchHint')}
      </Text>
      <TextField
        label={t('linkIntake.batchField')}
        value={batch.text}
        onChangeText={batch.setText}
        multiline
        numberOfLines={6}
        autoCapitalize="none"
        autoCorrect={false}
        disabled={batch.running}
        helperText={t('linkIntake.batchCount', { count: batch.links.length })}
        testID="batch-add-text"
      />
      <Box row gap={8} style={{ flexWrap: 'wrap' }}>
        <Button
          title={t('linkIntake.importFile')}
          variant="outline"
          size="small"
          leftIcon="file-document-outline"
          onPress={() => void batch.importFromFile()}
          disabled={batch.running}
          testID="batch-add-import-file"
        />
        {batch.running ? (
          <Button title={t('linkIntake.stop')} variant="outline" size="small" onPress={batch.stop} testID="batch-add-stop" />
        ) : (
          <Button
            title={t('linkIntake.start')}
            variant="primary"
            size="small"
            onPress={() => void batch.start()}
            disabled={batch.links.length === 0}
            testID="batch-add-start"
          />
        )}
      </Box>
      {batch.fileError ? (
        <Text variant="caption" color="error">
          {batch.fileError === 'too-large' ? t('linkIntake.fileTooLarge') : t('linkIntake.fileUnreadable')}
        </Text>
      ) : null}

      {batch.rows.length > 0 ? (
        <Box gap={8}>
          <Text variant="label" color="textSecondary">
            {t('linkIntake.results')}
          </Text>
          {batch.rows.map((row) => (
            <Box
              key={row.url}
              gap={2}
              pb={8}
              style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}
              accessible
              accessibilityLabel={`${row.url}. ${rowLabel(row, t)}`}>
              <Text variant="bodySmall" numberOfLines={1}>
                {row.result?.title || row.url}
              </Text>
              <Text
                variant="caption"
                color={row.result?.outcome === 'refused' ? 'error' : 'textSecondary'}
                numberOfLines={1}>
                {rowLabel(row, t)}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {reviewRows.length > 0 ? (
        <Box gap={8}>
          <Text variant="label" color="textSecondary">
            {t('linkIntake.needsReview')}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('linkIntake.needsReviewHint')}
          </Text>
          {reviewRows.map((row) => (
            <Box key={`review-${row.url}`} row gap={8} style={{ alignItems: 'center' }}>
              <Box flex={1} style={{ minWidth: 0 }}>
                <Text variant="bodySmall" numberOfLines={1}>
                  {row.url}
                </Text>
              </Box>
              <Button
                title={t('linkIntake.open')}
                variant="outline"
                size="small"
                onPress={() => batch.openInBrowser(row.url)}
                testID={`batch-add-open-${row.url}`}
              />
            </Box>
          ))}
        </Box>
      ) : null}
    </SafeAreaScreen>
  );
});
