import { isIncognitoInFront } from '@/browser/incognito/incognito-state';
import { toWebPageUrl } from '@/downloads/v2/link-actions';
import { isRemoteControlAvailable, sendToComputer } from '@/remote/remote-control';

import type { BrowserLongPressAction } from '../types';

/**
 * P6 #511: "Send to computer" on a long-pressed link — it appears under "Sent from phone" in the Web UI. Not in
 * incognito, whose links leave no trace on the phone.
 */
export const sendToComputerAction: BrowserLongPressAction = {
  id: 'send_to_computer',
  labelKey: 'remoteControl.sendToComputer',
  icon: 'monitor-arrow-down',
  order: 45,
  enabled: true,
  isAvailable: (context) => isRemoteControlAvailable() && !isIncognitoInFront() && toWebPageUrl(context.url) != null,
  execute(context) {
    const url = toWebPageUrl(context.url);
    if (!url) return;
    void sendToComputer({ url, title: context.linkText?.trim() || context.title?.trim() || url });
  },
};
