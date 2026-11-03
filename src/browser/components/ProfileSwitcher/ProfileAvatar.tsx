import { memo } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { PROFILE_COLOR_HEX, profileInitials, type ProfileColor } from '@/browser/profiles/profile-registry';
import { useTheme } from '@/hooks/use-theme';

/** B20: a profile's initials on its colour (guest mode: a person outline). Decorative: rows carry the name. */
export const ProfileAvatar = memo(function ProfileAvatar({
  name,
  color,
  guest = false,
  size = 36,
}: {
  name: string;
  color: ProfileColor;
  guest?: boolean;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: guest ? theme.colors.textSecondary : PROFILE_COLOR_HEX[color],
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {guest ? (
        <Icon name="account-outline" size={Math.round(size * 0.6)} color="inverse" />
      ) : (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{ color: '#FFFFFF', fontWeight: '700', fontSize: Math.round(size * 0.4) }}>
          {profileInitials(name)}
        </Text>
      )}
    </View>
  );
});
