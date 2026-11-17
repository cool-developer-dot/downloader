import { memo } from 'react';
import { TextInput, View } from 'react-native';

import { DsButton, DsButtonRow, DsCard, DsRow, DsRowGroup, DsSectionLabel, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { nativeFontFamilies } from '@/theme/typography';

import type { BatchRow, useBatchAdd } from './useBatchAdd';

const OUTCOME_LABEL: Record<string, TranslationKey> = {
  added: 'linkIntake.outcomeAdded',
  duplicate: 'linkIntake.outcomeDuplicate',
  'needs-review': 'linkIntake.outcomeReview',
  refused: 'linkIntake.outcomeRefused',
};

export function batchRowLabel(row: BatchRow, t: (key: TranslationKey) => string): string {
  if (row.status === 'pending') return t('linkIntake.statusWaiting');
  if (row.status === 'running') return t('linkIntake.statusChecking');
  return row.result ? t(OUTCOME_LABEL[row.result.outcome] ?? 'linkIntake.outcomeReview') : '';
}

export type BatchAddBodyProps = {
  batch: ReturnType<typeof useBatchAdd>;
  testID?: string;
};

/**
 * Batch Add (#292 / #293) as design-kit blocks: the links field, Import from file · Check and add (or Stop), the
 * result rows and the "needs review" rows. Shown on its own screen (`/downloads/batch-add`) and under the Batch chip
 * of Add download (design 11); both drive the same `useBatchAdd`.
 */
export const BatchAddBody = memo(function BatchAddBody({ batch, testID = 'batch-add' }: BatchAddBodyProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const reviewRows = batch.rows.filter((row) => row.result?.outcome === 'needs-review');

  return (
    <>
      <DsText variant="body">{t('linkIntake.batchHint')}</DsText>
      <DsCard>
        <TextInput
          value={batch.text}
          onChangeText={batch.setText}
          multiline
          numberOfLines={6}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!batch.running}
          placeholder={t('linkIntake.batchField')}
          placeholderTextColor={theme.colors.textSecondary}
          selectionColor={theme.colors.primary}
          accessibilityLabel={t('linkIntake.batchField')}
          testID={`${testID}-text`}
          style={{
            minHeight: 120,
            padding: 0,
            textAlignVertical: 'top',
            fontFamily: nativeFontFamilies.body,
            fontSize: ds.text.rowTitle,
            color: theme.colors.textPrimary,
            textAlign: rtl.textAlign,
            writingDirection: rtl.writingDirection,
          }}
        />
        <DsText variant="rowSub" style={{ marginTop: 8 }}>
          {t('linkIntake.batchCount', { count: batch.links.length })}
        </DsText>
      </DsCard>
      <DsButtonRow>
        <DsButton
          label={t('linkIntake.importFile')}
          variant="secondary"
          icon="file-text"
          flex
          onPress={() => void batch.importFromFile()}
          disabled={batch.running}
          testID={`${testID}-import-file`}
        />
        {batch.running ? (
          <DsButton label={t('linkIntake.stop')} variant="secondary" flex onPress={batch.stop} testID={`${testID}-stop`} />
        ) : (
          <DsButton
            label={t('linkIntake.start')}
            icon="download"
            flex
            onPress={() => void batch.start()}
            disabled={batch.links.length === 0}
            testID={`${testID}-start`}
          />
        )}
      </DsButtonRow>
      {batch.fileError ? (
        <DsText variant="body" color="primary" accessibilityLiveRegion="polite">
          {batch.fileError === 'too-large' ? t('linkIntake.fileTooLarge') : t('linkIntake.fileUnreadable')}
        </DsText>
      ) : null}

      {batch.rows.length > 0 ? (
        <View style={{ gap: ds.space.stack }}>
          <DsSectionLabel>{t('linkIntake.results')}</DsSectionLabel>
          <DsRowGroup>
            {batch.rows.map((row) => (
              <DsRow
                key={row.url}
                icon={row.result?.outcome === 'added' ? 'check' : row.result?.outcome === 'refused' ? 'ban' : 'link'}
                title={row.result?.title || row.url}
                subtitle={batchRowLabel(row, t)}
                trailing="none"
                accessibilityLabel={`${row.url}. ${batchRowLabel(row, t)}`}
              />
            ))}
          </DsRowGroup>
        </View>
      ) : null}

      {reviewRows.length > 0 ? (
        <View style={{ gap: ds.space.stack }}>
          <DsSectionLabel>{t('linkIntake.needsReview')}</DsSectionLabel>
          <DsText variant="body">{t('linkIntake.needsReviewHint')}</DsText>
          <DsRowGroup>
            {reviewRows.map((row) => (
              <DsRow
                key={`review-${row.url}`}
                icon="globe"
                title={row.url}
                subtitle={t('linkIntake.open')}
                onPress={() => batch.openInBrowser(row.url)}
                testID={`${testID}-open-${row.url}`}
              />
            ))}
          </DsRowGroup>
        </View>
      ) : null}
    </>
  );
});
