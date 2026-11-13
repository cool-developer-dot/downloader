import { memo } from 'react';
import { View } from 'react-native';
import { Icon as PaperIcon } from 'react-native-paper';

import { INCOGNITO_COLORS } from '../incognito-theme';

/** B11 #108: an icon on the incognito surface, in its fixed white (the same in the Light and Dark themes). */
export const IncognitoIcon = memo(function IncognitoIcon({
  name = 'incognito',
  size = 20,
}: {
  name?: string;
  size?: number;
}) {
  return (
    <View importantForAccessibility="no-hide-descendants">
      <PaperIcon source={name} size={size} color={INCOGNITO_COLORS.text} />
    </View>
  );
});
