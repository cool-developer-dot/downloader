import { useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';

import {
  browserActionRegistry,
  type BrowserActionContext,
  type BrowserLinkLongPressPayload,
} from '@/browser/actions';
import { openLinkInNewTab } from '@/browser/actions/open-link-in-new-tab';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { useTranslation } from '@/localization';

function isActionableLink(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:')
  );
}

export type BrowserLongPressController = {
  visible: boolean;
  title: string;
  subtitle: string;
  actions: ActionSheetItem[];
  present: (payload: BrowserLinkLongPressPayload) => void;
  dismiss: () => void;
};

/**
 * Owns long-press action sheet state. Presentation-only consumers bind to this.
 */
export function useBrowserLongPressActions(): BrowserLongPressController {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<BrowserLinkLongPressPayload | null>(null);

  const dismiss = useCallback(() => {
    setPayload(null);
  }, []);

  const present = useCallback((next: BrowserLinkLongPressPayload) => {
    if (!isActionableLink(next.href)) {
      return;
    }
    setPayload(next);
    AccessibilityInfo.announceForAccessibility(t('browser.linkActions.announce'));
  }, [t]);

  const context: BrowserActionContext | null = useMemo(() => {
    if (!payload) {
      return null;
    }
    return {
      url: payload.href,
      linkText: payload.text,
      pageUrl: payload.pageUrl,
      title: payload.text,
      openInNewTab: (url: string) => {
        openLinkInNewTab(url, {
          createTab: (options) => useBrowserStore.getState().createTab(options),
          onLimitReached: announceTabsLimitReached,
        });
      },
    };
  }, [payload]);

  const actions: ActionSheetItem[] = useMemo(() => {
    if (!context) {
      return [];
    }

    return browserActionRegistry.resolve(context).map((action) => {
      const enabled = action.enabled !== false;
      return {
        id: action.id,
        label: t(action.labelKey),
        icon: action.icon,
        destructive: action.destructive,
        onPress: enabled
          ? () => {
              void action.execute(context);
            }
          : undefined,
      };
    });
  }, [context, t]);

  return {
    visible: payload != null,
    title: t('browser.linkActions.title'),
    subtitle: payload?.href ?? '',
    actions,
    present,
    dismiss,
  };
}
