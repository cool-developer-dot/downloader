import { memo, useState } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useBrowserStore } from '@/browser/stores';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

/** Hosts whose notice the user closed, until the app closes. */
const dismissedHosts = new Set<string>();

function insecureHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

/**
 * B12 #126 Insecure site warning: on a page opened over plain http, a notice at the top of the page that what the
 * user types there can be seen by others; closed per site for the rest of the app run. (A page whose certificate
 * fails never opens: the browser shows its "connection isn't secure" page instead.)
 */
export const InsecurePageBar = memo(function InsecurePageBar({ visible }: { visible: boolean }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const enabled = useSettingsStore((s) => s.insecurePageWarning !== false);
  const url = useBrowserStore((s) => s.currentUrl);
  const hasError = useBrowserStore((s) => s.error != null);
  // Read in render (not just a version counter): React Compiler memoizes what render doesn't read, and the module Set
  // alone would keep the bar until the next navigation.
  const [closedHost, setClosedHost] = useState<string | null>(null);
  const host = insecureHost(url);

  if (!visible || !enabled || !host || hasError || host === closedHost || dismissedHosts.has(host)) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 8, left: 12, right: 12, zIndex: 25 }}
      testID="browser-insecure-bar">
      <Box
        row
        rtlRow
        center
        gap={10}
        accessibilityRole="alert"
        style={{
          paddingStart: 12,
          paddingEnd: 4,
          paddingVertical: 4,
          borderRadius: theme.radius.lg,
          backgroundColor: theme.colors.card,
          borderWidth: 1,
          borderColor: theme.colors.warning,
        }}>
        <Icon name="lock-open-variant" size={20} color="warning" />
        <Text variant="caption" style={{ flex: 1, textAlign: rtl.textAlign }}>
          {t('browserPrivacy.insecureBar')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('browserPrivacy.insecureBarDismiss')}
          onPress={() => {
            dismissedHosts.add(host);
            setClosedHost(host);
          }}
          testID="browser-insecure-bar-dismiss"
          style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color="secondary" />
        </Pressable>
      </Box>
    </View>
  );
});
