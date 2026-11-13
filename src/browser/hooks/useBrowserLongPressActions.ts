import { useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';

import {
  browserActionRegistry,
  type BrowserActionContext,
  type BrowserLinkLongPressPayload,
} from '@/browser/actions';
import { canOpenInNewTab, openLinkInNewTab } from '@/browser/actions/open-link-in-new-tab';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { backgroundTabNotice } from '@/browser/tabs/background-tab-notice';
import { useTranslation } from '@/localization';
import { isIncognitoInFront, liveIncognitoProfile } from '@/browser/incognito/incognito-state';
import { downloadImage } from '@/browser/capture/image-download';

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
    if (!isActionableLink(next.href) && !next.imageSrc) {
      return;
    }
    setPayload(next);
    AccessibilityInfo.announceForAccessibility(t('browser.linkActions.announce'));
  }, [t]);

  const context: BrowserActionContext | null = useMemo(() => {
    // B17 #280: an image without a link has no link actions, only "Download image".
    if (!payload || !isActionableLink(payload.href)) {
      return null;
    }
    return {
      url: payload.href,
      linkText: payload.text,
      pageUrl: payload.pageUrl,
      title: payload.text,
      openInNewTab: (url: string) => {
        // B11: a link opened from an incognito tab stays in incognito (its session is live: the tab exists).
        const incognito = isIncognitoInFront() && liveIncognitoProfile() != null;
        openLinkInNewTab(url, {
          createTab: (options) =>
            useBrowserStore.getState().createTab({ ...options, ...(incognito ? { incognito: true } : {}) }),
          onLimitReached: announceTabsLimitReached,
        });
      },
      openInBackground: (url: string, title?: string) => {
        if (!canOpenInNewTab(url)) return;
        const incognito = isIncognitoInFront() && liveIncognitoProfile() != null;
        const outcome = useBrowserStore
          .getState()
          .openTabInBackground(url.trim(), { title, ...(incognito ? { incognito: true } : {}) });
        if (outcome.status === 'LIMIT_REACHED') {
          announceTabsLimitReached();
          return;
        }
        backgroundTabNotice.offer(outcome.tabId);
      },
    };
  }, [payload]);

  const actions: ActionSheetItem[] = useMemo(() => {
    const image: ActionSheetItem[] = payload?.imageSrc
      ? [
          {
            id: 'download_image',
            label: t('browserCapture.downloadImage'),
            icon: 'download',
            onPress: () => {
              void downloadImage(payload.imageSrc!, payload.pageUrl);
            },
          },
        ]
      : [];
    if (!context) {
      return image;
    }

    return [...browserActionRegistry.resolve(context).map((action) => {
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
    }), ...image];
  }, [context, payload, t]);

  return {
    visible: payload != null,
    title: t('browser.linkActions.title'),
    subtitle: payload?.href || payload?.imageSrc || '',
    actions,
    present,
    dismiss,
  };
}
