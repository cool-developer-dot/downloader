import { registerDefaultBrowserActions } from './builtins/register-default-actions';

export { browserActionRegistry } from './registry';
export { registerDefaultBrowserActions } from './builtins/register-default-actions';
export type {
  BrowserActionContext,
  BrowserActionId,
  BrowserLinkLongPressPayload,
  BrowserLongPressAction,
} from './types';

// Ensure defaults exist as soon as the actions module is imported.
registerDefaultBrowserActions();
