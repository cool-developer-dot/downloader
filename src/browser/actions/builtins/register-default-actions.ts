import { browserActionRegistry } from '../registry';
import { copyLinkAction } from './copy-link.action';
import { openExternalAction } from './open-external.action';
import { openInNewTabAction } from './open-in-new-tab.action';
import { shareLinkAction } from './share-link.action';

let defaultsRegistered = false;

/** Idempotent registration of Day-4 long-press actions. */
export function registerDefaultBrowserActions(): void {
  if (defaultsRegistered) {
    return;
  }

  browserActionRegistry.register(copyLinkAction);
  browserActionRegistry.register(shareLinkAction);
  browserActionRegistry.register(openInNewTabAction);
  browserActionRegistry.register(openExternalAction);
  defaultsRegistered = true;
}
