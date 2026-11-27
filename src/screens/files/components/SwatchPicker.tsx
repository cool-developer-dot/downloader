import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon } from '@/design';
import { SWATCH_IDS, swatchColor, type SwatchId } from '@/files/organize/swatches';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation, type TranslationKey } from '@/localization';

export const SWATCH_LABELS: Record<SwatchId, TranslationKey> = {
  red: 'fileManager.swatchRed',
  orange: 'fileManager.swatchOrange',
  amber: 'fileManager.swatchAmber',
  green: 'fileManager.swatchGreen',
  teal: 'fileManager.swatchTeal',
  blue: 'fileManager.swatchBlue',
  violet: 'fileManager.swatchViolet',
  pink: 'fileManager.swatchPink',
};

export type SwatchPickerProps = {
  value: SwatchId | null;
  onChange: (value: SwatchId | null) => void;
  size?: number;
  testID?: string;
};

/** Files F7: the 8 swatches (and "No colour") for a folder icon or a tag. Each is a radio TalkBack names. */
export const SwatchPicker = memo(function SwatchPicker({ value, onChange, size = 30, testID = 'files-swatches' }: SwatchPickerProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const { t } = useTranslation();
  return (
    <View testID={testID} accessibilityRole="radiogroup" style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', gap: 10 }}>
      <Pressable
        onPress={() => onChange(null)}
        accessibilityRole="radio"
        accessibilityState={{ checked: value === null }}
        accessibilityLabel={t('fileManager.noColor')}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: value === null ? 2 : 1,
          borderColor: value === null ? theme.colors.primary : theme.colors.cardBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <DsIcon name="ban" size={size * 0.5} color="textSecondary" strokeWidth={1.8} />
      </Pressable>
      {SWATCH_IDS.map((id) => (
        <Pressable
          key={id}
          onPress={() => onChange(id)}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === id }}
          accessibilityLabel={t(SWATCH_LABELS[id])}
          testID={`${testID}-${id}`}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: swatchColor(id),
            borderWidth: value === id ? 3 : 0,
            borderColor: theme.colors.textPrimary,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {value === id ? <DsIcon name="check" size={size * 0.5} color="#FFFFFF" strokeWidth={2.4} /> : null}
        </Pressable>
      ))}
    </View>
  );
});
