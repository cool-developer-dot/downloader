import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { PDF_CHOICES, type PdfChoice } from '@/browser/capture/capture-core';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsSection } from '../components';

const LABELS: Record<PdfChoice, TranslationKey> = {
  ask: 'browserCapture.pdfSettingAsk',
  viewer: 'browserCapture.pdfSettingViewer',
  download: 'browserCapture.pdfSettingDownload',
  external: 'browserCapture.pdfSettingExternal',
};

/** B17 #265 — Browser settings → Capture and PDF: what a PDF link does (the remembered choice; Ask by default). */
export const CaptureSettingsSection = memo(function CaptureSettingsSection() {
  const { t, rtl } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const choice = useSettingsStore((s) => s.pdfOpenChoice ?? 'ask');
  return (
    <SettingsSection testID="browser-settings-capture" title={t('browserCapture.section')} icon="file-pdf-box">
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}>
        <Text variant="body" style={{ textAlign: rtl.textAlign }}>
          {t('browserCapture.pdfSetting')}
        </Text>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('browserCapture.pdfSetting')} style={{ gap: 2 }}>
          {PDF_CHOICES.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ checked: choice === c, selected: choice === c }}
              onPress={() => update('pdfOpenChoice', c)}
              testID={`browser-settings-pdf-${c}`}
              style={{ minHeight: 48, justifyContent: 'center' }}>
              <Text variant="body" color={choice === c ? 'primary' : undefined} style={{ textAlign: rtl.textAlign }}>
                {choice === c ? `● ${t(LABELS[c])}` : t(LABELS[c])}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SettingsSection>
  );
});
