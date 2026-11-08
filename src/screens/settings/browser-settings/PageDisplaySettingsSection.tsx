import { memo, useState } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { PageDisplayGlobalControls, Stepper } from '@/browser/page-display/components/PageDisplayControls';
import { useSiteDisplayEditor } from '@/browser/page-display/components/PageDisplaySheet';
import {
  normalizeTextZoom,
  TEXT_ZOOM_MAX,
  TEXT_ZOOM_MIN,
  TEXT_ZOOM_STEP,
  type SiteDisplay,
} from '@/browser/page-display/page-display-settings';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

/** B16 — Browser settings → Page display: the defaults for every site, and the sites with their own settings. */
export const PageDisplaySettingsSection = memo(function PageDisplaySettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const textZoom = normalizeTextZoom(useSettingsStore((s) => s.pageTextZoom));
  const editor = useSiteDisplayEditor();
  const siteCount = Object.keys(editor.sites).length;
  const [sitesOpen, setSitesOpen] = useState(false);

  return (
    <SettingsSection
      testID="browser-settings-page-display"
      title={t('browserPageDisplay.title')}
      description={t('browserPageDisplay.sectionDescription')}
      icon="format-size">
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 20 }}>
        <View style={{ gap: 8 }}>
          <Stepper
            title={t('browserPageDisplay.textSize')}
            value={`${textZoom}%`}
            valueA11y={t('browserPageDisplay.percentA11y', { value: textZoom })}
            canDecrease={textZoom > TEXT_ZOOM_MIN}
            canIncrease={textZoom < TEXT_ZOOM_MAX}
            onStep={(direction) => update('pageTextZoom', normalizeTextZoom(textZoom + direction * TEXT_ZOOM_STEP))}
            testID="browser-settings-page-text-size"
          />
          {/* Live preview: the sample at the chosen size (pages scale their text the same way). */}
          <Text
            variant="body"
            accessibilityLabel={t('browserPageDisplay.previewA11y')}
            style={{ fontSize: Math.round(16 * (textZoom / 100)), lineHeight: Math.round(24 * (textZoom / 100)) }}
            testID="browser-settings-page-text-preview">
            {t('browserPageDisplay.preview')}
          </Text>
        </View>
        <PageDisplayGlobalControls testID="browser-settings-page" />
      </View>
      <SettingsRow
        title={t('browserPageDisplay.sites')}
        description={t('browserPageDisplay.sitesHint')}
        icon="web"
        value={String(siteCount)}
        onPress={() => setSitesOpen(true)}
        showDivider={false}
        testID="browser-settings-page-sites"
      />
      <SitesSheet visible={sitesOpen} onClose={() => setSitesOpen(false)} />
    </SettingsSection>
  );
});

function summary(site: SiteDisplay, t: ReturnType<typeof useTranslation>['t']): string {
  const parts: string[] = [];
  if (site.textZoom != null) parts.push(t('browserPageDisplay.summaryText', { value: site.textZoom }));
  if (site.zoom != null) parts.push(t('browserPageDisplay.summaryZoom', { value: site.zoom }));
  if (site.noForceDark) parts.push(t('browserPageDisplay.summaryNoDark'));
  return parts.join(' · ');
}

const SitesSheet = memo(function SitesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, rtl } = useTranslation();
  const editor = useSiteDisplayEditor();
  const entries = Object.entries(editor.sites);
  return (
    <SheetFrame
      visible={visible}
      title={t('browserPageDisplay.sites')}
      onClose={onClose}
      testID="browser-settings-page-sites-sheet"
      footer={
        entries.length ? (
          <Button title={t('browserPageDisplay.resetAll')} variant="outline" onPress={() => editor.resetAll()} testID="page-display-reset-all" />
        ) : undefined
      }>
      {entries.length === 0 ? (
        <Text variant="bodySmall" color="textSecondary">
          {t('browserPageDisplay.sitesEmpty')}
        </Text>
      ) : (
        <View>
          {entries.map(([site, own]) => (
            <View key={site} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 6 }}>
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1} style={{ writingDirection: 'ltr' }}>
                  {site}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {summary(own, t)}
                </Text>
              </View>
              <Button
                title={t('browserPageDisplay.reset')}
                variant="outline"
                onPress={() => editor.reset(site)}
                accessibilityLabel={t('browserPageDisplay.resetSiteA11y', { site })}
                testID={`page-display-reset-${site}`}
              />
            </View>
          ))}
        </View>
      )}
    </SheetFrame>
  );
});
