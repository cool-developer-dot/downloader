import { memo, useMemo } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { getEnabledLanguages } from '@/constants/languages';
import { resolveLanguage, useTranslation } from '@/localization';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type GeneralSectionProps = {
  languageLabel: string;
  languageCode: string;
  sheetVisible: boolean;
  onOpenSheet: () => void;
  onCloseSheet: () => void;
  onSelectLanguage: (code: string) => void;
  disabled?: boolean;
  testID?: string;
};

export const GeneralSection = memo(function GeneralSection({
  languageLabel,
  languageCode,
  sheetVisible,
  onOpenSheet,
  onCloseSheet,
  onSelectLanguage,
  disabled = false,
  testID = 'settings-general',
}: GeneralSectionProps) {
  const { t } = useTranslation();
  const selectedCode = resolveLanguage(languageCode);

  const actions = useMemo<ActionSheetItem[]>(
    () =>
      getEnabledLanguages().map((language) => {
        const nameKey =
          language.code === 'ur' ? 'settings.languageNameUr' : 'settings.languageNameEn';
        return {
          id: language.code,
          label: `${t(nameKey)} · ${language.nativeLabel}`,
          icon: 'translate' as const,
          selected: language.code === selectedCode,
          onPress: () => onSelectLanguage(language.code),
        };
      }),
    [onSelectLanguage, selectedCode, t],
  );

  return (
    <>
      <SettingsSection
        testID={testID}
        title={t('settings.generalSection')}
        description={t('settings.generalDescription')}
        icon="tune-variant">
        <SettingsRow
          title={t('settings.language')}
          description={t('settings.languageHint')}
          icon="translate"
          value={languageLabel}
          onPress={disabled ? undefined : onOpenSheet}
          showDivider={false}
          accessibilityHint={t('settings.languageOpenHint')}
          testID={`${testID}-language`}
        />
      </SettingsSection>

      <ActionSheetModal
        visible={sheetVisible}
        onClose={onCloseSheet}
        title={t('settings.languageSheetTitle')}
        subtitle={t('settings.languageSheetSubtitle')}
        actions={actions}
        testID={`${testID}-language-sheet`}
      />
    </>
  );
});
