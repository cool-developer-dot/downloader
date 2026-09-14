import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';

import { useTranslation, type TranslationKey } from '@/localization';

import { goHomeForTab, reloadForTab } from '@/browser/services';
import { selectBrowserError, useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';

export type BrowserErrorViewProps = {
  testID?: string;
};

export const BrowserErrorView = memo(function BrowserErrorView({
  testID = 'browser-error-view',
}: BrowserErrorViewProps) {
  const { t } = useTranslation();
  const error = useBrowserStore(selectBrowserError);

  const isSslError = error?.code === 'ssl_error';
  const retryUrl = error?.retryUrl ?? error?.url ?? null;

  const handleRetry = useCallback(() => {
    const targetTabId = useBrowserStore.getState().activeTabId;
    const controller = tabControllerRegistry.get(targetTabId);
    if (!controller) {
      return;
    }
    if (retryUrl) {
      controller.loadUrl(retryUrl);
      return;
    }
    reloadForTab(targetTabId);
  }, [retryUrl]);

  const handleHome = useCallback(() => {
    goHomeForTab(useBrowserStore.getState().activeTabId);
  }, []);

  if (!error) {
    return null;
  }

  const titleKey = `browser.errors.${error.code}.title` as TranslationKey;
  const messageKey = `browser.errors.${error.code}.message` as TranslationKey;
  const safeReason =
    error.safeReason ??
    (error.failure?.safeReason ? error.failure.safeReason : null);

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
      <Box center gap={8}>
        <Text variant="title" align="center" color="error">
          {t(titleKey)}
        </Text>
        <Text variant="bodySmall" color="textSecondary" align="center">
          {t(messageKey)}
        </Text>
        {safeReason ? (
          <Text variant="caption" color="textSecondary" align="center" testID={`${testID}-reason`}>
            {safeReason}
          </Text>
        ) : null}
      </Box>

      <Box row gap={12} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        {isSslError ? (
          <>
            <Button
              title={t('browser.goHome')}
              onPress={handleHome}
              variant="primary"
              testID={`${testID}-home`}
              accessibilityHint={t('browser.sslHomeHint')}
            />
            <Button
              title={t('common.retry')}
              onPress={handleRetry}
              variant="outline"
              testID={`${testID}-retry`}
              accessibilityHint={t('browser.sslRetryHint')}
            />
          </>
        ) : (
          <>
            <Button
              title={t('common.retry')}
              onPress={handleRetry}
              variant="primary"
              testID={`${testID}-retry`}
              accessibilityHint={t('browser.retryHint')}
            />
            <Button
              title={t('browser.goHome')}
              onPress={handleHome}
              variant="outline"
              testID={`${testID}-home`}
              accessibilityHint={t('browser.goHomeHint')}
            />
          </>
        )}
      </Box>
    </Box>
  );
});
