import { memo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import {
  acceptClipboardBanner,
  dismissClipboardBanner,
  useClipboardBannerStore,
} from '@/browser/services/clipboard-link-monitor';

/** "Download from copied link?" — shown only by the Clipboard Monitor (off by default). Renders nothing otherwise. */
export const ClipboardLinkBanner = memo(function ClipboardLinkBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const host = useClipboardBannerStore((state) => state.host);
  const url = useClipboardBannerStore((state) => state.url);

  if (!url) {
    return null;
  }
  return (
    <Box
      testID="clipboard-link-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      gap={8}
      style={{
        position: 'absolute',
        start: 12,
        end: 12,
        top: insets.top + 8,
        zIndex: 60,
        padding: 12,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}>
      <Text variant="bodySmall">{t('linkIntake.clipboardTitle')}</Text>
      {host ? (
        <Text variant="caption" color="textSecondary" numberOfLines={1}>
          {host}
        </Text>
      ) : null}
      <Box row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button
          title={t('common.dismiss')}
          variant="ghost"
          size="small"
          onPress={dismissClipboardBanner}
          testID="clipboard-link-banner-dismiss"
        />
        <Button
          title={t('linkIntake.clipboardOpen')}
          variant="primary"
          size="small"
          onPress={acceptClipboardBanner}
          testID="clipboard-link-banner-open"
        />
      </Box>
    </Box>
  );
});
