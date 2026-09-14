import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { extractPageHostname, isBrowserHomeUrl } from '@/browser/utils';
import {
  selectCurrentUrl,
  selectIsHome,
  selectPageTitle,
  useBrowserStore,
} from '@/browser/stores';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { navigation, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';
import { useBookmarksStore } from '@/store/bookmarks';
import { normalizeUrl } from '@/storage/utils';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';

import { BrowserLabeledAction } from './BrowserLabeledAction';

export type BrowserBookmarkControlsProps = {
  testID?: string;
};

/**
 * Labeled browser chrome actions:
 * Save / Saved (toggle) · Bookmarks · History
 */
export const BrowserBookmarkControls = memo(function BrowserBookmarkControls({
  testID = 'browser-chrome-actions',
}: BrowserBookmarkControlsProps) {
  const { t } = useTranslation();
  const currentUrl = useBrowserStore(selectCurrentUrl);
  const pageTitle = useBrowserStore(selectPageTitle);
  const isHome = useBrowserStore(selectIsHome);

  const toggleOptimistic = useBookmarksStore((state) => state.toggleOptimistic);
  const resolveBookmarkForUrl = useBookmarksStore(
    (state) => state.resolveBookmarkForUrl,
  );

  const [feedback, setFeedback] = useState<string | null>(null);

  const canBookmark = useMemo(() => {
    if (isHome || isBrowserHomeUrl(currentUrl)) {
      return false;
    }

    try {
      const parsed = new URL(currentUrl);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, [currentUrl, isHome]);

  const urlKey = useMemo(() => {
    if (!canBookmark) {
      return '';
    }
    return normalizeUrl(currentUrl).trim().toLowerCase();
  }, [canBookmark, currentUrl]);

  // Boolean selectors — avoid re-rendering chrome on unrelated bookmark map churn.
  const bookmarked = useBookmarksStore((state) =>
    urlKey ? Boolean(state.urlIndex[urlKey]) : false,
  );
  const pending = useBookmarksStore((state) =>
    urlKey ? Boolean(state.pendingUrls[urlKey]) : false,
  );

  useEffect(() => {
    if (!canBookmark || !currentUrl) {
      return;
    }

    void resolveBookmarkForUrl(currentUrl);
  }, [canBookmark, currentUrl, resolveBookmarkForUrl]);

  useEffect(() => {
    if (!feedback) {
      return;
    }

    const timer = setTimeout(() => setFeedback(null), 2400);
    return () => clearTimeout(timer);
  }, [feedback]);

  const handleToggle = useCallback(() => {
    if (!canBookmark || pending) {
      return;
    }

    const hostname = extractPageHostname(currentUrl);

    void toggleOptimistic({
      url: currentUrl,
      title: pageTitle || hostname || currentUrl,
      hostname,
      faviconUrl: buildFaviconUrl(hostname),
    }).then((result) => {
      if (result.error) {
        setFeedback(result.error);
      }
    });
  }, [canBookmark, currentUrl, pageTitle, pending, toggleOptimistic]);

  const openBookmarks = useCallback(() => {
    navigation.push(routePaths.bookmarks);
  }, []);

  const openHistory = useCallback(() => {
    navigation.push(routePaths.history);
  }, []);

  return (
    <Box
      testID={testID}
      row
      gap={2}
      style={{ alignItems: 'flex-start', paddingTop: 2 }}>
      {canBookmark ? (
        <BrowserLabeledAction
          icon={bookmarked ? 'bookmark' : 'bookmark-outline'}
          label={bookmarked ? t('common.saved') : t('common.save')}
          accessibilityLabel={bookmarked ? t('browser.removeBookmarkA11y') : t('browser.saveBookmarkA11y')}
          onPress={handleToggle}
          disabled={pending}
          loading={pending}
          active={bookmarked}
          testID={`${testID}-save`}
        />
      ) : null}

      <BrowserLabeledAction
        icon="bookmark-box-outline"
        label={t('nav.bookmarks')}
        accessibilityLabel={t('browser.openBookmarksA11y')}
        onPress={openBookmarks}
        testID={`${testID}-bookmarks`}
      />

      <BrowserLabeledAction
        icon="history"
        label={t('nav.history')}
        accessibilityLabel={t('browser.openHistoryA11y')}
        onPress={openHistory}
        testID={`${testID}-history`}
      />

      {feedback ? (
        <Box
          accessibilityLiveRegion="polite"
          accessibilityLabel={feedback}
          style={{
            position: 'absolute',
            width: BROWSER_TOUCH_TARGET,
            height: 1,
            opacity: 0,
          }}
        />
      ) : null}
    </Box>
  );
});
