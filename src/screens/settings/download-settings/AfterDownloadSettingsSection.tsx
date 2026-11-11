import { memo } from 'react';

import { Icon } from '@/components/base/Icon';
import type { IconName } from '@/components/base/Icon';
import { AFTER_DOWNLOAD_ACTIONS, type AfterDownloadAction } from '@/downloads/v2/after-download';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { selectAfterDownloadAction, selectSaveToGallery, useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection, SettingsStaggerItem } from '../components';

export type AfterDownloadSettingsSectionProps = {
  index: number;
  disabled?: boolean;
};

const OPTIONS: Record<AfterDownloadAction, { title: TranslationKey; hint: TranslationKey; icon: IconName }> = {
  none: { title: 'afterDownload.none', hint: 'afterDownload.noneHint', icon: 'minus-circle-outline' },
  details: { title: 'afterDownload.details', hint: 'afterDownload.detailsHint', icon: 'information-outline' },
  play: { title: 'afterDownload.play', hint: 'afterDownload.playHint', icon: 'play-circle-outline' },
  gallery: { title: 'afterDownload.gallery', hint: 'afterDownload.galleryHint', icon: 'image-multiple-outline' },
};

/** Download Settings → After a download finishes (#156, #361). "Do nothing" is the default. */
export const AfterDownloadSettingsSection = memo(function AfterDownloadSettingsSection({
  index,
  disabled,
}: AfterDownloadSettingsSectionProps) {
  const { t } = useTranslation();
  const selected = useSettingsStore(selectAfterDownloadAction);
  const autoSave = useSettingsStore(selectSaveToGallery);

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-after-download"
        title={t('afterDownload.section')}
        description={t('afterDownload.sectionDescription')}
        icon="check-circle-outline">
        {AFTER_DOWNLOAD_ACTIONS.map((action, position) => {
          const option = OPTIONS[action];
          const isSelected = selected === action;
          // The existing Save to Gallery setting already exports every download: say so instead of exporting twice.
          const description =
            action === 'gallery' && autoSave ? t('afterDownload.galleryAlreadyOn') : t(option.hint);
          return (
            <SettingsRow
              key={action}
              title={t(option.title)}
              description={description}
              icon={option.icon}
              onPress={
                disabled
                  ? undefined
                  : () => useSettingsStore.getState().updateSetting('afterDownloadAction', action)
              }
              trailing={isSelected ? <Icon name="check" size="sm" color="primary" /> : undefined}
              showDivider={position < AFTER_DOWNLOAD_ACTIONS.length - 1}
              accessibilityHint={
                isSelected ? `${t('common.selected')}. ${description}` : description
              }
              testID={`download-settings-after-download-${action}`}
            />
          );
        })}
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
