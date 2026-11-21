import { memo, useCallback } from 'react';
import { TextInput, View } from 'react-native';

import { DsButton, DsButtonRow, DsCard, DsCheckTile, DsRow, DsRowGroup, DsSectionLabel, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { navigation } from '@/navigation';
import { DOWNLOAD_RULES_ROUTE } from '@/screens/download-rules/route';
import { nativeFontFamilies } from '@/theme/typography';

import type { BatchRow, PlaylistNotice, useBatchAdd } from './useBatchAdd';

const OUTCOME_LABEL: Record<string, TranslationKey> = {
  added: 'linkIntake.outcomeAdded',
  duplicate: 'linkIntake.outcomeDuplicate',
  'needs-review': 'linkIntake.outcomeReview',
  refused: 'linkIntake.outcomeRefused',
};

export function batchRowLabel(row: BatchRow, t: (key: TranslationKey) => string): string {
  if (row.status === 'pending') return t('linkIntake.statusWaiting');
  if (row.status === 'running') return t('linkIntake.statusChecking');
  if (row.result?.detail === 'SIZE_RULE') return t('bulkAdd.skippedBySize');
  return row.result ? t(OUTCOME_LABEL[row.result.outcome] ?? 'linkIntake.outcomeReview') : '';
}

function playlistNoticeText(notice: PlaylistNotice, t: (key: TranslationKey, values?: Record<string, number>) => string): string | null {
  if (!notice) return null;
  if (notice.kind === 'loaded') return t('bulkAdd.playlistLoaded', { count: notice.count });
  if (notice.kind === 'stream') return t('bulkAdd.playlistStream');
  if (notice.kind === 'none') return t('bulkAdd.playlistNone');
  return t('bulkAdd.playlistFailed');
}

/** The result line: the outcome, plus how many mirrors (#347) were saved with it. */
function batchRowSubtitle(row: BatchRow, t: (key: TranslationKey, values?: Record<string, number>) => string): string {
  const label = batchRowLabel(row, t);
  return row.mirrors.length > 0 ? `${label} · ${t('downloadSources.batchMirrorsAdded', { count: row.mirrors.length })}` : label;
}

export type BatchAddBodyProps = {
  batch: ReturnType<typeof useBatchAdd>;
  testID?: string;
};

/**
 * Batch Add (#292 / #293) as design-kit blocks: the links field (numbered patterns #485 and `link | mirror` lines
 * #347), Import from file · Check and add (or Stop), Open playlist (#368) and Download rules (#505), the choice of
 * which links to add (#369), the result rows and the "needs review" rows. Shown on its own screen
 * (`/downloads/batch-add`) and under the Batch chip of Add download (design 11); both drive the same `useBatchAdd`.
 */
export const BatchAddBody = memo(function BatchAddBody({ batch, testID = 'batch-add' }: BatchAddBodyProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const reviewRows = batch.rows.filter((row) => row.result?.outcome === 'needs-review');
  const notice = playlistNoticeText(batch.playlistNotice, t);
  const showChoice = !batch.running && batch.rows.length === 0 && batch.candidates.length > 1;
  const openRules = useCallback(() => navigation.push(DOWNLOAD_RULES_ROUTE), []);

  return (
    <>
      <DsText variant="body">{t('linkIntake.batchHint')}</DsText>
      <DsText variant="rowSub" testID={`${testID}-mirrors-hint`}>
        {t('downloadSources.batchMirrorsHint')}
      </DsText>
      <DsText variant="rowSub">{t('bulkAdd.patternHint')}</DsText>
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
      {batch.truncated ? (
        <DsText variant="body" color="primary" testID={`${testID}-truncated`}>
          {t('bulkAdd.truncated', { count: batch.candidates.length + batch.ruleSkipped.length })}
        </DsText>
      ) : null}
      {batch.ruleSkipped.length > 0 ? (
        <DsText variant="rowSub" testID={`${testID}-rule-skips`}>
          {t('bulkAdd.rulesActive', { count: batch.ruleSkipped.length })}
        </DsText>
      ) : null}
      <DsRowGroup>
        {batch.playlistLinks.length > 0 ? (
          <DsRow
            icon="list"
            title={batch.playlistBusy ? t('bulkAdd.playlistLoading') : t('bulkAdd.openPlaylist')}
            onPress={() => void batch.loadPlaylists()}
            disabled={batch.running || batch.playlistBusy}
            testID={`${testID}-open-playlist`}
          />
        ) : null}
        <DsRow icon="sliders-horizontal" title={t('bulkAdd.rules')} onPress={openRules} disabled={batch.running} testID={`${testID}-rules`} />
      </DsRowGroup>
      {notice ? (
        <DsText
          variant="rowSub"
          color={batch.playlistNotice?.kind === 'failed' ? 'primary' : undefined}
          accessibilityLiveRegion="polite"
          testID={`${testID}-playlist-notice`}>
          {notice}
        </DsText>
      ) : null}
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
      {showChoice ? (
        <View style={{ gap: ds.space.stack }} testID={`${testID}-choice`}>
          <DsSectionLabel>{t('bulkAdd.choose')}</DsSectionLabel>
          <DsText variant="rowSub">{t('bulkAdd.chosenCount', { selected: batch.links.length, total: batch.candidates.length })}</DsText>
          <DsButtonRow>
            <DsButton label={t('bulkAdd.selectAll')} variant="secondary" flex onPress={batch.selectAll} testID={`${testID}-select-all`} />
            <DsButton label={t('bulkAdd.selectNone')} variant="secondary" flex onPress={batch.selectNone} testID={`${testID}-select-none`} />
          </DsButtonRow>
          <DsRowGroup>
            {batch.candidates.map((url) => {
              const checked = !batch.unselected.has(url);
              return (
                <DsRow
                  key={url}
                  leading={<DsCheckTile checked={checked} />}
                  title={batch.titles[url] ?? url}
                  subtitle={batch.titles[url] ? url : undefined}
                  trailing="none"
                  onPress={() => batch.toggle(url)}
                  accessibilityLabel={batch.titles[url] ?? url}
                  accessibilityHint={checked ? t('lightPlaylist.unselectHint') : t('lightPlaylist.selectHint')}
                  testID={`${testID}-choice-${url}`}
                />
              );
            })}
          </DsRowGroup>
        </View>
      ) : null}
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
                title={row.result?.title || batch.titles[row.url] || row.url}
                subtitle={batchRowSubtitle(row, t)}
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
