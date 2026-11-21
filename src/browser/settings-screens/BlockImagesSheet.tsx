import { memo, useMemo, useState } from 'react';

import { AUTOPLAY_POLICIES, normalizeAutoplay, type AutoplayPolicy } from '@/browser/blocking/blocking-settings';
import { AUTOPLAY_LABELS } from '@/browser/blocking/components/SiteBlockingControls';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { DsRow, DsRowGroup } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';
import { useSettingsStore } from '@/store/settings';

const AUTOPLAY_HINTS: Record<AutoplayPolicy, TranslationKey> = {
  allow: 'browserBlocking.autoplayAllowHint',
  sound: 'browserBlocking.autoplaySoundHint',
  all: 'browserBlocking.autoplayAllHint',
};

/**
 * Design 9 → "Block images / autoplay": B18's Block images and Images on Wi-Fi only switches with B14's autoplay
 * choice. The per-site lists stay in the Data saver and Blocking sheets.
 */
export const BlockImagesSheet = memo(function BlockImagesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const blockImages = useSettingsStore((s) => s.blockImages === true);
  const imagesWifiOnly = useSettingsStore((s) => s.imagesWifiOnly === true);
  const autoplay = normalizeAutoplay(useSettingsStore((s) => s.autoplay));
  const dataSaver = useSettingsStore((s) => s.dataSaver === true);
  const [picker, setPicker] = useState(false);

  const autoplayOptions = useMemo(
    (): ChoiceOption<AutoplayPolicy>[] =>
      AUTOPLAY_POLICIES.map((value) => ({ value, label: t(AUTOPLAY_LABELS[value]), description: t(AUTOPLAY_HINTS[value]) })),
    [t],
  );
  const autoplayLabel = t(AUTOPLAY_LABELS[autoplay]);

  return (
    <SheetFrame visible={visible} title={t('lightBrowserSettings.blockImages')} onClose={onClose} testID="browser-settings-block-images-sheet">
      <DsRowGroup>
        <DsRow
          icon="image"
          title={t('browserDataSaver.blockImages')}
          subtitle={t('browserDataSaver.blockImagesHint')}
          toggle={{ value: blockImages, onValueChange: (next) => update('blockImages', next) }}
          testID="browser-settings-block-images"
        />
        <DsRow
          icon="wifi"
          title={t('browserDataSaver.imagesWifi')}
          subtitle={t('browserDataSaver.imagesWifiHint')}
          toggle={{ value: imagesWifiOnly, onValueChange: (next) => update('imagesWifiOnly', next) }}
          testID="browser-settings-images-wifi"
        />
        <DsRow
          icon="play"
          title={t('browserBlocking.autoplay')}
          subtitle={dataSaver ? t('browserBlocking.autoplaySaverNote') : t(AUTOPLAY_HINTS[autoplay])}
          value={autoplayLabel}
          trailing="chevron"
          onPress={() => setPicker(true)}
          accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserBlocking.autoplay'), value: autoplayLabel })}
          testID="browser-settings-autoplay"
        />
      </DsRowGroup>
      <ChoiceSheet
        visible={picker}
        title={t('browserBlocking.autoplay')}
        options={autoplayOptions}
        value={autoplay}
        onSelect={(next) => update('autoplay', next)}
        onClose={() => setPicker(false)}
        testID="browser-settings-autoplay-sheet"
      />
    </SheetFrame>
  );
});
