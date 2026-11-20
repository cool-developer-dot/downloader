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
import { PrivateCheckbox } from '@/screens/private/PrivateCheckbox';
import { useSettingsTokens } from '@/screens/settings/theme/settings-tokens';

import { DOWNLOAD_RULES_ROUTE } from '@/screens/download-rules/route';

import { useBatchAdd, type BatchRow, type PlaylistNotice } from './useBatchAdd';

const OUTCOME_LABEL: Record<string, TranslationKey> = {
  added: 'linkIntake.outcomeAdded',
  duplicate: 'linkIntake.outcomeDuplicate',
  'needs-review': 'linkIntake.outcomeReview',
  refused: 'linkIntake.outcomeRefused',
};

function rowLabel(row: BatchRow, t: (key: TranslationKey) => string): string {
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

/**
 * Batch Add (#292): paste several links (or import a .txt file, #293) — or a numbered pattern (#485) or a playlist
 * (#368) — choose which to add (#369), within the download rules (#505); each one is checked and, if possible, added.
 */
export const BatchAddScreen = memo(function BatchAddScreen() {
  const theme = useTheme();
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const batch = useBatchAdd();
  const goBack = useCallback(() => navigation.back(), []);
  const openRules = useCallback(() => navigation.push(DOWNLOAD_RULES_ROUTE), []);
  const notice = playlistNoticeText(batch.playlistNotice, t);
  const showChoice = !batch.running && batch.rows.length === 0 && batch.candidates.length > 1;

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
      <Text variant="caption" color="textSecondary" testID="batch-add-mirrors-hint">
        {t('downloadSources.batchMirrorsHint')}
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
      <Text variant="caption" color="textSecondary">
        {t('bulkAdd.patternHint')}
      </Text>
      {batch.truncated ? (
        <Text variant="caption" color="warning" testID="batch-add-truncated">
          {t('bulkAdd.truncated', { count: batch.candidates.length + batch.ruleSkipped.length })}
        </Text>
      ) : null}
      {batch.ruleSkipped.length > 0 ? (
        <Text variant="caption" color="textSecondary" testID="batch-add-rule-skips">
          {t('bulkAdd.rulesActive', { count: batch.ruleSkipped.length })}
        </Text>
      ) : null}
      <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
        <Button
          title={t('linkIntake.importFile')}
          variant="outline"
          size="small"
          leftIcon="file-document-outline"
          onPress={() => void batch.importFromFile()}
          disabled={batch.running}
          testID="batch-add-import-file"
        />
        {batch.playlistLinks.length > 0 ? (
          <Button
            title={batch.playlistBusy ? t('bulkAdd.playlistLoading') : t('bulkAdd.openPlaylist')}
            variant="outline"
            size="small"
            leftIcon="playlist-music-outline"
            onPress={() => void batch.loadPlaylists()}
            disabled={batch.running || batch.playlistBusy}
            testID="batch-add-open-playlist"
          />
        ) : null}
        <Button
          title={t('bulkAdd.rules')}
          variant="outline"
          size="small"
          leftIcon="filter-variant"
          onPress={openRules}
          disabled={batch.running}
          testID="batch-add-rules"
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
      {notice ? (
        <Text variant="caption" color={batch.playlistNotice?.kind === 'failed' ? 'error' : 'textSecondary'} testID="batch-add-playlist-notice">
          {notice}
        </Text>
      ) : null}
      {showChoice ? (
        <Box gap={8} testID="batch-add-choice">
          <Box row rtlRow gap={8} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Box flex={1} style={{ minWidth: 0 }}>
              <Text variant="label" color="textSecondary">
                {t('bulkAdd.choose')}
              </Text>
              <Text variant="caption" color="textSecondary">
                {t('bulkAdd.chosenCount', { selected: batch.links.length, total: batch.candidates.length })}
              </Text>
            </Box>
            <Button title={t('bulkAdd.selectAll')} variant="ghost" size="small" onPress={batch.selectAll} testID="batch-add-select-all" />
            <Button title={t('bulkAdd.selectNone')} variant="ghost" size="small" onPress={batch.selectNone} testID="batch-add-select-none" />
          </Box>
          {batch.candidates.map((url) => (
            <PrivateCheckbox
              key={url}
              checked={!batch.unselected.has(url)}
              onToggle={() => batch.toggle(url)}
              label={batch.titles[url] ?? url}
              testID={`batch-add-choice-${url}`}
            />
          ))}
        </Box>
      ) : null}
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
                {row.result?.title || batch.titles[row.url] || row.url}
              </Text>
              <Text
                variant="caption"
                color={row.result?.outcome === 'refused' ? 'error' : 'textSecondary'}
                numberOfLines={1}>
                {row.mirrors.length > 0
                  ? `${rowLabel(row, t)} · ${t('downloadSources.batchMirrorsAdded', { count: row.mirrors.length })}`
                  : rowLabel(row, t)}
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
            <Box key={`review-${row.url}`} row rtlRow gap={8} style={{ alignItems: 'center' }}>
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
