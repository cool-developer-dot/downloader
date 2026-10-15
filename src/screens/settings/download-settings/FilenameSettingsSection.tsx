import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Chip } from '@/components/common/Chip';
import { TextField } from '@/components/inputs/TextField';
import {
  applyFilenameTemplate,
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TOKENS,
  isDefaultFilenameTemplate,
  MAX_TEMPLATE_LENGTH,
  normalizeFilenameTemplate,
} from '@/downloads/v2/filename-template';
import { useTranslation } from '@/localization';
import { selectFilenameTemplate, useSettingsStore } from '@/store/settings';

import { SettingsSection, SettingsStaggerItem } from '../components';

export type FilenameSettingsSectionProps = {
  index: number;
  disabled?: boolean;
};

/** A fixed moment for the preview, so it does not change while the user types. */
const PREVIEW_DATE = new Date(2026, 0, 31, 18, 30);

/**
 * Download Settings → File naming: Filename Template (#379) with a live preview. Applies to new downloads only; the
 * default `{title}` keeps today's naming exactly.
 */
export const FilenameSettingsSection = memo(function FilenameSettingsSection({
  index,
  disabled,
}: FilenameSettingsSectionProps) {
  const { t } = useTranslation();
  const saved = useSettingsStore(selectFilenameTemplate);
  const [draft, setDraft] = useState(saved);

  // The template can change elsewhere (Reset Settings, a settings import): follow it, but never fight the typing —
  // a draft that saves to the same value (e.g. with a trailing space) is kept.
  useEffect(() => {
    setDraft((current) => (normalizeFilenameTemplate(current) === saved ? current : saved));
  }, [saved]);

  const save = useCallback((value: string) => {
    useSettingsStore.getState().updateSetting('filenameTemplate', normalizeFilenameTemplate(value));
  }, []);

  const onChangeText = useCallback(
    (value: string) => {
      setDraft(value);
      save(value);
    },
    [save],
  );

  const insertToken = useCallback(
    (token: string) => {
      const base = draft.trimEnd();
      const next = `${base}${base ? ' ' : ''}{${token}}`;
      setDraft(next);
      save(next);
    },
    [draft, save],
  );

  const reset = useCallback(() => {
    setDraft(DEFAULT_FILENAME_TEMPLATE);
    save(DEFAULT_FILENAME_TEMPLATE);
  }, [save]);

  const preview = useMemo(
    () =>
      applyFilenameTemplate({
        template: draft,
        title: t('downloadNaming.sampleTitle'),
        pageUrl: 'https://www.example.com/video',
        site: 'web',
        qualityLabel: '720p',
        now: PREVIEW_DATE,
      }),
    [draft, t],
  );

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-file-naming"
        title={t('downloadNaming.section')}
        description={t('downloadNaming.sectionDescription')}
        icon="file-document-edit-outline">
        <Box gap={10} py={8}>
          <TextField
            label={t('downloadNaming.template')}
            value={draft}
            onChangeText={onChangeText}
            maxLength={MAX_TEMPLATE_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            disabled={disabled}
            helperText={t('downloadNaming.templateHint')}
            accessibilityLabel={t('downloadNaming.template')}
            testID="download-settings-filename-template"
          />
          <Box row gap={6} style={{ flexWrap: 'wrap' }}>
            {FILENAME_TOKENS.map((token) => (
              <Chip
                key={token}
                label={`{${token}}`}
                onPress={() => insertToken(token)}
                disabled={disabled}
                testID={`download-settings-filename-token-${token}`}
              />
            ))}
          </Box>
          <Box gap={2}>
            <Text variant="caption" color="textSecondary">
              {t('downloadNaming.preview')}
            </Text>
            <Text
              variant="bodySmall"
              numberOfLines={2}
              accessibilityLabel={`${t('downloadNaming.preview')}: ${preview}`}
              testID="download-settings-filename-preview">
              {preview}
            </Text>
            <Text variant="caption" color="textSecondary">
              {t('downloadNaming.newDownloadsOnly')}
            </Text>
          </Box>
          {!isDefaultFilenameTemplate(draft) ? (
            <Button
              title={t('downloadNaming.reset')}
              variant="outline"
              size="small"
              onPress={reset}
              disabled={disabled}
              testID="download-settings-filename-reset"
            />
          ) : null}
        </Box>
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
