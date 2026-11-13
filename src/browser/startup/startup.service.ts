import { didOpenLaunchLink } from '@/browser/services/incoming-link.service';
import { useBrowserStore } from '@/browser/stores';
import { MAX_OPEN_TABS } from '@/browser/tabs/constants';
import { isBrowserHomeUrl } from '@/browser/utils';
import { useSettingsStore } from '@/store/settings';

import { normalizeStartupOption, planStartup, readHomepage } from './startup-settings';

let ran = false;
let openedTab = false;

/**
 * True once this cold start's startup option put a tab in front (or found the tab in front already showing it): the
 * session restore (`useBrowserSessionContinuity`) then leaves it alone instead of loading the last page into it.
 */
export function startupOpenedTab(): boolean {
  return openedTab;
}

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
    const option = normalizeStartupOption(settings.startupOption);
    const startup = {
      activeIsStartPage: active ? isBrowserHomeUrl(active.url) : false,
      activeIsHomepage: Boolean(active && homepage && active.url === homepage),
      tabCount: store.tabs.length,
      maxTabs: MAX_OPEN_TABS,
      openedLaunchLink: didOpenLaunchLink(),
    };
    const plan = planStartup(option, homepage, startup);
    if (plan.kind === 'newTab') {
      openedTab = store.createTab(plan.url ? { url: plan.url } : undefined).status === 'CREATED';
    } else if (option !== 'continue' && !startup.openedLaunchLink) {
      // The tab in front already shows what the option asks for: keep it so (no session restore into it).
      openedTab = option === 'homepage' && homepage ? startup.activeIsHomepage : startup.activeIsStartPage;
    }
  } catch {
    // The tabs simply stay as they were.
  }
}
