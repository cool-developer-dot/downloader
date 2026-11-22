import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable as RNPressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsButton, DsButtonRow, DsChip, DsChipRow, DsSearchField, DsText, ds } from '@/design';
import {
  applyFilenameTemplate,
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TOKENS,
  isDefaultFilenameTemplate,
  MAX_TEMPLATE_LENGTH,
  normalizeFilenameTemplate,
} from '@/downloads/v2/filename-template';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { selectFilenameTemplate, useSettingsStore } from '@/store/settings';
import { useTourBlocker } from '@/tour/tour-store';

/** A fixed moment for the preview, so it does not change while the user types. */
const PREVIEW_DATE = new Date(2026, 0, 31, 18, 30);

export type FilenameTemplateSheetProps = {
  visible: boolean;
  onClose: () => void;
  testID?: string;
};

/**
 * Add download → "Rename before download": the Filename Template editor (#379) as a sheet. The same setting the
 * Download Settings section edits (`filenameTemplate`), saved as it is typed, with the token chips and the preview.
 */
export const FilenameTemplateSheet = memo(function FilenameTemplateSheet({
  visible,
  onClose,
  testID = 'add-download-template',
}: FilenameTemplateSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const saved = useSettingsStore(selectFilenameTemplate);
  const [draft, setDraft] = useState(saved);

  useTourBlocker(visible);

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

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
        />
        <View
          testID={testID}
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: ds.radius.card,
            borderTopRightRadius: ds.radius.card,
            paddingTop: 8,
            paddingHorizontal: ds.space.screenX,
            paddingBottom: insets.bottom + 12,
            gap: ds.space.stack,
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.switchOff }]} />
          <DsText variant="cardTitle" accessibilityRole="header">
            {t('lightAddDownload.templateTitle')}
          </DsText>
          <DsSearchField
            icon={null}
            value={draft}
            onChangeText={onChangeText}
            maxLength={MAX_TEMPLATE_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={DEFAULT_FILENAME_TEMPLATE}
            accessibilityLabel={t('downloadNaming.template')}
            testID={`${testID}-field`}
          />
          <DsChipRow>
            {FILENAME_TOKENS.map((token) => (
              <DsChip key={token} label={`{${token}}`} onPress={() => insertToken(token)} testID={`${testID}-token-${token}`} />
            ))}
          </DsChipRow>
          <View style={{ gap: 2 }}>
            <DsText variant="rowSub">{t('downloadNaming.preview')}</DsText>
            <DsText variant="bodyStrong" numberOfLines={2} accessibilityLabel={`${t('downloadNaming.preview')}: ${preview}`}>
              {preview}
            </DsText>
            <DsText variant="rowSub">{t('downloadNaming.newDownloadsOnly')}</DsText>
          </View>
          <DsButtonRow>
            {!isDefaultFilenameTemplate(draft) ? (
              <DsButton label={t('downloadNaming.reset')} variant="secondary" flex onPress={reset} testID={`${testID}-reset`} />
            ) : null}
            <DsButton label={t('common.done')} flex onPress={onClose} testID={`${testID}-done`} />
          </DsButtonRow>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
});
