import { didOpenLaunchLink } from '@/browser/services/incoming-link.service';
import { useBrowserStore } from '@/browser/stores';
import { MAX_OPEN_TABS } from '@/browser/tabs/constants';
import { isBrowserHomeUrl } from '@/browser/utils';
import { useSettingsStore } from '@/store/settings';

import { normalizeStartupOption, planStartup, readHomepage } from './startup-settings';

let ran = false;

/**
 * B21 #233 — once per cold start, after the tabs are back and the launch link (if any) was handed over: "Open the
 * start page" / "Open the homepage" put one new tab in front, keeping every other tab. "Continue where you left off"
 * (default) and a link from another app leave everything as it is.
 */
export function applyStartupOption(): void {
  if (ran) return;
  ran = true;
  try {
    const settings = useSettingsStore.getState();
    const homepage = readHomepage(settings.homepageUrl);
    const store = useBrowserStore.getState();
    const active = store.tabs.find((tab) => tab.id === store.activeTabId);
    const plan = planStartup(normalizeStartupOption(settings.startupOption), homepage, {
      activeIsStartPage: active ? isBrowserHomeUrl(active.url) : false,
      activeIsHomepage: Boolean(active && homepage && active.url === homepage),
      tabCount: store.tabs.length,
      maxTabs: MAX_OPEN_TABS,
      openedLaunchLink: didOpenLaunchLink(),
    });
    if (plan.kind === 'newTab') {
      store.createTab(plan.url ? { url: plan.url } : undefined);
    }
  } catch {
    // The tabs simply stay as they were.
  }
}
