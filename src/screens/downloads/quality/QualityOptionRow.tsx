import { memo } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import {
  buildQualityAccessibilityLabel,
  buildQualityMetaLine,
  buildQualitySecondaryLine,
  type DownloadQualityOption,
} from '@/downloads/quality';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { primaryAlphas, withAlpha } from '@/theme';

export type QualityOptionRowProps = {
  option: DownloadQualityOption;
  selected: boolean;
  onSelect: (id: string) => void;
  /** True while create/submit is in progress — disables interaction. */
  interactionDisabled?: boolean;
  testID?: string;
};

export const QualityOptionRow = memo(function QualityOptionRow({
  option,
  selected,
  onSelect,
  interactionDisabled = false,
  testID,
}: QualityOptionRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const primary = primaryAlphas(theme.colors.primary);
  const meta = buildQualityMetaLine(option);
  const secondary = buildQualitySecondaryLine(option);
  const unsupported = !option.downloadable;
  const disabled = unsupported || interactionDisabled;

  const borderColor = selected
    ? theme.colors.primary
    : theme.colors.border;
  const backgroundColor = selected ? primary.strong : theme.colors.surface;

  return (
    <Pressable
      testID={testID}
      onPress={() => onSelect(option.id)}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={buildQualityAccessibilityLabel(option, selected)}
      style={{
        minHeight: 56,
        borderRadius: theme.radius.md,
        borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        borderColor,
        backgroundColor,
        paddingHorizontal: theme.spacing[16],
        paddingVertical: 14,
        opacity: disabled ? 0.78 : 1,
      }}>
      <Box row style={{ alignItems: 'center', justifyContent: 'space-between' }} gap={12}>
        <Box flex={1} gap={4}>
          <Box row style={{ alignItems: 'center', flexWrap: 'wrap' }} gap={8}>
            <Text variant="subtitle" style={{ flexShrink: 1 }}>
              {option.label}
            </Text>
            {unsupported ? (
              <Box
                px={8}
                py={2}
                borderRadius="full"
                style={{ backgroundColor: withAlpha(theme.colors.warning, 0.16) }}>
                <Text variant="caption" color="warning">
                  {t('downloads.unsupportedBadge')}
                </Text>
              </Box>
            ) : null}
          </Box>

          {meta ? (
            <Text variant="bodySmall" color="textSecondary" style={{ flexShrink: 1 }}>
              {meta}
            </Text>
          ) : null}

          {secondary ? (
            <Text variant="caption" color="textSecondary" style={{ flexShrink: 1 }}>
              {secondary}
            </Text>
          ) : null}
        </Box>

        <Box
          center
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: selected
              ? theme.colors.primary
              : disabled
                ? theme.colors.textDisabled
                : theme.colors.border,
            backgroundColor: selected ? theme.colors.primary : 'transparent',
          }}
          accessibilityElementsHidden
          importantForAccessibility="no">
          {selected ? <Icon name="check" size={14} color="inverse" /> : null}
        </Box>
      </Box>
    </Pressable>
  );
});
