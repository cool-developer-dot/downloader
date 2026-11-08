import { memo, useMemo, useSyncExternalStore } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { siteKey } from '@/browser/privacy/privacy-settings';
import { selectCurrentUrl, useBrowserStore } from '@/browser/stores';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import {
  normalizeForceDark,
  normalizeTextZoom,
  PAGE_ZOOM_CHOICES,
  parseSiteDisplays,
  resetSiteDisplay,
  serializeSiteDisplays,
  TEXT_ZOOM_MAX,
  TEXT_ZOOM_MIN,
  TEXT_ZOOM_STEP,
  updateSiteDisplay,
  type SiteDisplay,
} from '../page-display-settings';
import { pageDisplayRequests } from '../page-display-requests';
import { PageDisplayGlobalControls, Stepper, SwitchLine } from './PageDisplayControls';

/** Writes one site's change to the settings store (the per-site list). */
export function useSiteDisplayEditor() {
  const raw = useSettingsStore((s) => s.pageDisplaySites);
  const update = useSettingsStore((s) => s.updateSetting);
  const sites = useMemo(() => parseSiteDisplays(raw), [raw]);
  return {
    sites,
    change(site: string, change: Partial<Record<keyof SiteDisplay, unknown>>) {
      update('pageDisplaySites', serializeSiteDisplays(updateSiteDisplay(sites, site, change)));
    },
    reset(site: string) {
      update('pageDisplaySites', serializeSiteDisplays(resetSiteDisplay(sites, site)));
    },
    resetAll() {
      update('pageDisplaySites', serializeSiteDisplays({}));
    },
  };
}

/** B16 — this site's own text size, zoom and force-dark exception (the Aa panel's top part). */
const SiteControls = memo(function SiteControls({ site }: { site: string }) {
  const { t } = useTranslation();
  const editor = useSiteDisplayEditor();
  const own = editor.sites[site];
  const globalZoom = normalizeTextZoom(useSettingsStore((s) => s.pageTextZoom));
  const forceDark = normalizeForceDark(useSettingsStore((s) => s.pageForceDark));
  const textZoom = own?.textZoom ?? globalZoom;
  const pageZoom = own?.zoom ?? 0;
  const zoomAt = PAGE_ZOOM_CHOICES.indexOf(pageZoom as (typeof PAGE_ZOOM_CHOICES)[number]);

  return (
    <View style={{ gap: 12 }}>
      <Text variant="label" color="textSecondary">
        {t('browserPageDisplay.thisSite', { site })}
      </Text>
      <Stepper
        title={t('browserPageDisplay.textSize')}
        value={`${textZoom}%`}
        valueA11y={t('browserPageDisplay.percentA11y', { value: textZoom })}
        canDecrease={textZoom > TEXT_ZOOM_MIN}
        canIncrease={textZoom < TEXT_ZOOM_MAX}
        onStep={(direction) => editor.change(site, { textZoom: normalizeTextZoom(textZoom + direction * TEXT_ZOOM_STEP) })}
        testID="page-display-site-text"
      />
      <Stepper
        title={t('browserPageDisplay.pageZoom')}
        value={pageZoom ? `${pageZoom}%` : t('browserPageDisplay.zoomDefault')}
        valueA11y={pageZoom ? t('browserPageDisplay.percentA11y', { value: pageZoom }) : t('browserPageDisplay.zoomDefault')}
        canDecrease={zoomAt > 0}
        canIncrease={zoomAt < PAGE_ZOOM_CHOICES.length - 1}
        onStep={(direction) => {
          const next = PAGE_ZOOM_CHOICES[Math.min(PAGE_ZOOM_CHOICES.length - 1, Math.max(0, zoomAt + direction))];
          editor.change(site, { zoom: next || undefined });
        }}
        testID="page-display-site-zoom"
      />
      <Text variant="caption" color="textSecondary">
        {t('browserPageDisplay.pageZoomHint')}
      </Text>
      {forceDark !== 'off' ? (
        <SwitchLine
          title={t('browserPageDisplay.notOnThisSite')}
          hint={t('browserPageDisplay.notOnThisSiteHint')}
          value={own?.noForceDark === true}
          onChange={(value) => editor.change(site, { noForceDark: value ? true : undefined })}
          testID="page-display-site-no-dark"
        />
      ) : null}
      <Button
        title={t('browserPageDisplay.resetSite')}
        variant="outline"
        disabled={!own}
        onPress={() => editor.reset(site)}
        testID="page-display-site-reset"
      />
    </View>
  );
});

/** B16 — the browser menu's "Page display" (Aa) panel: this site's settings, then those for every site. */
export const PageDisplayHost = memo(function PageDisplayHost() {
  const visible = useSyncExternalStore(pageDisplayRequests.subscribe, pageDisplayRequests.isOpen, pageDisplayRequests.isOpen);
  if (!visible) return null;
  return <PageDisplaySheet />;
});

const PageDisplaySheet = memo(function PageDisplaySheet() {
  const { t } = useTranslation();
  const url = useBrowserStore(selectCurrentUrl);
  const site = siteKey(url);
  return (
    <SheetFrame visible title={t('browserPageDisplay.title')} onClose={() => pageDisplayRequests.close()} testID="page-display-sheet">
      <View style={{ gap: 24 }}>
        {site ? (
          <SiteControls site={site} />
        ) : (
          <Text variant="bodySmall" color="textSecondary">
            {t('browserPageDisplay.noSite')}
          </Text>
        )}
        <Text variant="label" color="textSecondary">
          {t('browserPageDisplay.allSites')}
        </Text>
        <PageDisplayGlobalControls testID="page-display" />
      </View>
    </SheetFrame>
  );
});
