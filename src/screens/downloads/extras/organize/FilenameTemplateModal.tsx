import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsChip, DsChipRow, DsText } from '@/design';
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

/** A fixed moment for the preview, so it does not change while the user types (as in Download settings). */
const PREVIEW_DATE = new Date(2026, 0, 31, 18, 30);

export type FilenameTemplateModalProps = {
  visible: boolean;
  onClose: () => void;
};

/** Design 42 → Filename template (H10, #379): the template, its tokens and a live preview; saved on Save. */
export const FilenameTemplateModal = memo(function FilenameTemplateModal({ visible, onClose }: FilenameTemplateModalProps) {
  const { t } = useTranslation();
  const saved = useSettingsStore(selectFilenameTemplate);
  const [draft, setDraft] = useState(saved);

  // Every opening starts from what is saved now.
  useEffect(() => {
    if (visible) {
      setDraft(saved);
    }
  }, [saved, visible]);

  const insertToken = useCallback((token: string) => {
    setDraft((current) => {
      const base = current.trimEnd();
      return `${base}${base ? ' ' : ''}{${token}}`;
    });
  }, []);

  const save = useCallback(() => {
    useSettingsStore.getState().updateSetting('filenameTemplate', normalizeFilenameTemplate(draft));
    onClose();
  }, [draft, onClose]);

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
    <AppModal
      visible={visible}
      onClose={onClose}
      title={t('downloadNaming.template')}
      subtitle={t('downloadNaming.templateHint')}
      testID="organize-template-modal">
      <View style={{ gap: 12 }}>
        <TextField
          label={t('downloadNaming.template')}
          value={draft}
          onChangeText={setDraft}
          maxLength={MAX_TEMPLATE_LENGTH}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('downloadNaming.template')}
          testID="organize-template-field"
        />
        <DsChipRow scroll={false}>
          {FILENAME_TOKENS.map((token) => (
            <DsChip key={token} label={`{${token}}`} onPress={() => insertToken(token)} testID={`organize-template-token-${token}`} />
          ))}
        </DsChipRow>
        <View style={{ gap: 2 }}>
          <DsText variant="rowSub">{t('downloadNaming.preview')}</DsText>
          <DsText variant="bodyStrong" numberOfLines={2} accessibilityLabel={`${t('downloadNaming.preview')}: ${preview}`} testID="organize-template-preview">
            {preview}
          </DsText>
          <DsText variant="rowSub">{t('downloadNaming.newDownloadsOnly')}</DsText>
        </View>
        {!isDefaultFilenameTemplate(draft) ? (
          <DsButton
            label={t('downloadNaming.reset')}
            variant="secondary"
            fullWidth
            onPress={() => setDraft(DEFAULT_FILENAME_TEMPLATE)}
            testID="organize-template-reset"
          />
        ) : null}
        <DsButtonRow>
          <DsButton label={t('common.save')} flex onPress={save} testID="organize-template-save" />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} testID="organize-template-cancel" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
});
