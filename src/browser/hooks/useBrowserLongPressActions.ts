import { useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';

import {
  browserActionRegistry,
  type BrowserActionContext,
  type BrowserLinkLongPressPayload,
} from '@/browser/actions';

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
  const [payload, setPayload] = useState<BrowserLinkLongPressPayload | null>(null);

  const dismiss = useCallback(() => {
    setPayload(null);
  }, []);

  const present = useCallback((next: BrowserLinkLongPressPayload) => {
    if (!isActionableLink(next.href)) {
      return;
    }
    setPayload(next);
    AccessibilityInfo.announceForAccessibility('Link actions available');
  }, []);

  const context: BrowserActionContext | null = useMemo(() => {
    if (!payload) {
      return null;
    }
    return {
      url: payload.href,
      linkText: payload.text,
      pageUrl: payload.pageUrl,
      title: payload.text,
      openInNewTab: (_url: string) => {
        // Tabs phase will wire this callback via registry re-registration.
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
        label: enabled ? action.label : `${action.label} (Soon)`,
        icon: action.icon,
        destructive: action.destructive,
        onPress: enabled
          ? () => {
              void action.execute(context);
            }
          : undefined,
      };
    });
  }, [context]);

  return {
    visible: payload != null,
    title: 'Link options',
    subtitle: payload?.href ?? '',
    actions,
    present,
    dismiss,
  };
}
