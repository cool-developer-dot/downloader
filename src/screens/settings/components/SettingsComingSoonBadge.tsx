import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import { useSettingsTokens } from '../theme/settings-tokens';

export type SettingsComingSoonBadgeProps = {
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const SettingsComingSoonBadge = memo(function SettingsComingSoonBadge({
  label,
  style,
  testID,
}: SettingsComingSoonBadgeProps) {
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('common.comingSoon');
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        {
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: settingsTokens.radius.badge,
          backgroundColor: settingsTokens.comingSoonBg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <Text
        variant="caption"
        style={{
          color: settingsTokens.comingSoonText,
          letterSpacing: 0.2,
        }}>
        {resolvedLabel}
      </Text>
    </View>
  );
});
