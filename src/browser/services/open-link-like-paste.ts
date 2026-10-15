import { navigation, routePaths } from '@/navigation';

import { classifyIntakeLink } from './link-intake';
import { openPastedLink } from './pasted-link.service';
import { announceYouTubeNotSupported } from './youtube-refusal';

export type OpenLinkOutcome = 'opened' | 'youtube' | 'refused' | 'no-link';

/**
 * Opens `url` exactly as a link shared to VidoraX is opened (the existing pasted-link path: the direct analyzer reads
 * the page, then the active tab loads it) and shows the browser. YouTube is refused with the usual notice; private
 * and local addresses are never opened.
 */
export function openLinkLikePaste(
  url: string | null | undefined,
  options: { navigate?: boolean } = {},
): OpenLinkOutcome {
  const showBrowser = () => {
    if (options.navigate !== false) {
      navigation.navigate(routePaths.browser);
    }
  };
  if (!url) {
    showBrowser();
    return 'no-link';
  }
  const verdict = classifyIntakeLink(url);
  if (verdict === 'youtube') {
    announceYouTubeNotSupported();
    return 'youtube';
  }
  if (verdict !== 'ok') {
    return 'refused';
  }
  openPastedLink(url, { source: 'share' });
  showBrowser();
  return 'opened';
}
