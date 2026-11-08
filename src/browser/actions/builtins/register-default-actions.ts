import { browserActionRegistry } from '../registry';
import { copyLinkAction } from './copy-link.action';
import { openExternalAction } from './open-external.action';
import { openInBackgroundAction } from './open-in-background.action';
import { openInNewTabAction } from './open-in-new-tab.action';
import { shareLinkAction } from './share-link.action';
import { addToReadingListAction } from './add-to-reading-list.action';

let defaultsRegistered = false;

/** Idempotent registration of Day-4 long-press actions. */
export function registerDefaultBrowserActions(): void {
  if (defaultsRegistered) {
    return;
  }

  browserActionRegistry.register(copyLinkAction);
  browserActionRegistry.register(shareLinkAction);
  browserActionRegistry.register(openInNewTabAction);
  browserActionRegistry.register(openInBackgroundAction);
  browserActionRegistry.register(openExternalAction);
  // B9 #89
  browserActionRegistry.register(addToReadingListAction);
  defaultsRegistered = true;
}
