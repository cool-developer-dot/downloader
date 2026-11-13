import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { goHomeForTab } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

import { hostOf } from '../blocking-settings';
import { siteBlockReasonFor, useSiteClock } from '../site-blocking.service';

/**
 * B14 #276 / #277 / #278 — "This site is blocked", over the tab's page (the WebView is paused and hidden). Says why:
 * the user's block list, a used-up daily limit (until tomorrow) or focus mode (until its end). When the reason has
 * gone (the list was edited, focus ended) it offers to open the page.
 */
export const SiteBlockedView = memo(function SiteBlockedView({
  url,
  testID = 'browser-site-blocked',
}: {
  url: string | null;
  testID?: string;
}) {
  const { t, language } = useTranslation();
  const reason = siteBlockReasonFor(url, useSiteClock());
  const site = reason?.site ?? hostOf(url) ?? '';
  const time = (ms: number) =>
    new Date(ms).toLocaleTimeString(language === 'ur' ? 'ur-PK' : 'en-GB', { hour: 'numeric', minute: '2-digit' });

  const message = !reason
    ? t('browserBlocking.blockedEnded', { site })
    : reason.kind === 'blocked'
      ? t('browserBlocking.blockedByYou', { site })
      : reason.kind === 'time-limit'
        ? t('browserBlocking.blockedByLimit', { site, minutes: reason.minutes })
        : t('browserBlocking.blockedByFocus', { site, time: time(reason.until) });
  const icon = !reason ? 'check-circle-outline' : reason.kind === 'blocked' ? 'cancel' : reason.kind === 'focus' ? 'target' : 'timer-sand';

  const open = useCallback(() => {
    const controller = tabControllerRegistry.get(useBrowserStore.getState().activeTabId);
    if (controller && url) controller.loadUrl(url);
  }, [url]);

  return (
    <Box
      testID={testID}
      flex={1}
      center
      px={24}
      gap={20}
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 30 }}
      backgroundColor="background"
      accessibilityRole="alert">
      <Icon name={icon} size={48} color={reason ? 'error' : 'success'} />
      <Box center gap={8}>
        <Text variant="title" align="center" accessibilityRole="header">
          {reason ? t('browserBlocking.blockedTitle') : site}
        </Text>
        <Text variant="bodySmall" color="textSecondary" align="center" testID={`${testID}-reason`}>
          {message}
        </Text>
      </Box>
      <Box row gap={12} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        {reason ? (
          <Button
            title={t('browser.goHome')}
            onPress={() => goHomeForTab(useBrowserStore.getState().activeTabId)}
            variant="primary"
            testID={`${testID}-home`}
            accessibilityHint={t('browser.goHomeHint')}
          />
        ) : (
          <Button title={t('browserBlocking.openSite', { site })} onPress={open} variant="primary" testID={`${testID}-open`} />
        )}
        <Button
          title={t('browserBlocking.manage')}
          onPress={() => navigation.push(routePaths.browserSettings)}
          variant="outline"
          testID={`${testID}-manage`}
          accessibilityHint={t('browserBlocking.manageHint')}
        />
      </Box>
    </Box>
  );
});
