import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';
import { acceptClipboardBanner, useClipboardBannerStore } from '@/browser/services/clipboard-link-monitor';

/**
 * Design 1, under "Paste & Go": the Clipboard Monitor's line. With a copied link detected it reads
 * "Clipboard monitor: link detected ›" + "“Download?”" and a tap opens the link exactly as the banner's Open does;
 * otherwise it says whether the monitor is on or off and a tap opens the setting (Download settings → Adding links).
 */
export const ClipboardMonitorLine = memo(function ClipboardMonitorLine({ testID = 'browser-home-clipboard' }: { testID?: string }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const detected = useClipboardBannerStore((state) => state.url != null);
  const monitorOn = useSettingsStore((state) => state.clipboardMonitor === true);

  const handlePress = useCallback(() => {
    if (useClipboardBannerStore.getState().url) {
      acceptClipboardBanner();
      return;
    }
    navigation.push(routePaths.downloadSettings);
  }, []);

  const title = detected ? t('lightHome.clipboardDetected') : monitorOn ? t('lightHome.clipboardOn') : t('lightHome.clipboardOff');

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={detected ? t('lightHome.clipboardDetectedA11y') : `${title}. ${t('lightHome.clipboardSettingA11y')}`}
      accessibilityLiveRegion="polite"
      style={({ pressed }) => ({
        marginTop: 12,
        minHeight: 44,
        justifyContent: 'center',
        borderRadius: 8,
        backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
      })}>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
        <DsText variant="body" style={{ fontSize: 13.2 }}>
          {title}
        </DsText>
        <DsIcon name={rtl.isRtl ? 'chevron-left' : 'chevron-right'} size={14} color="textSecondary" strokeWidth={1.8} />
      </View>
      {detected ? (
        <DsText variant="body" style={{ fontSize: 13.2, marginTop: 4 }}>
          {t('lightHome.clipboardDetectedPrompt')}
        </DsText>
      ) : null}
    </Pressable>
  );
});
