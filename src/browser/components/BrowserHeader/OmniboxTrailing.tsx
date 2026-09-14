import { memo } from 'react';
import { ActivityIndicator } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Icon } from '@/components/base/Icon';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { BROWSER_TOUCH_TARGET } from '@/browser/constants';

export type OmniboxTrailingProps = {
  showClear: boolean;
  isLoading: boolean;
  onClear: () => void;
  testID?: string;
};

/**
 * Trailing omnibox controls: clear while editing, subtle spinner while loading.
 */
export const OmniboxTrailing = memo(function OmniboxTrailing({
  showClear,
  isLoading,
  onClear,
  testID = 'browser-omnibox-trailing',
}: OmniboxTrailingProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (showClear) {
    return (
      <Pressable
        testID={`${testID}-clear`}
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel={t('browser.clearAddressA11y')}
        hitSlop={4}
        style={{
          width: BROWSER_TOUCH_TARGET,
          height: BROWSER_TOUCH_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon name="close-circle" size="sm" color="secondary" />
      </Pressable>
    );
  }

  if (isLoading) {
    return (
      <ActivityIndicator
        testID={`${testID}-spinner`}
        size="small"
        color={theme.colors.primary}
        accessibilityLabel={t('browser.loadingPageA11y')}
        accessibilityLiveRegion="polite"
        style={{ width: BROWSER_TOUCH_TARGET, height: BROWSER_TOUCH_TARGET }}
      />
    );
  }

  return null;
});
