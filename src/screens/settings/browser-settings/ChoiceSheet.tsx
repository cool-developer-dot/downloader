import { memo, type ReactNode } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useTourBlocker } from '@/tour/tour-store';

export type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  /** Drawn before the label (an engine's letter badge). */
  leading?: ReactNode;
};

export type ChoiceSheetProps<T extends string> = {
  visible: boolean;
  title: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  onClose: () => void;
  testID?: string;
};

/**
 * A scrollable single-choice list in a bottom sheet, for browser settings with more choices than a segmented
 * control fits (search engine, language, region…). Rows are ≥ 52 dp; each is a radio for screen readers.
 */
function ChoiceSheetBase<T extends string>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
  testID = 'browser-settings-choice',
}: ChoiceSheetProps<T>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();

  useTourBlocker(visible);

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID={testID}
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            maxHeight: '80%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <Box px={16} pb={8}>
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
          </Box>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }} accessibilityRole="radiogroup">
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <Box key={option.value}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    testID={`${testID}-${option.value}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={
                      selected ? t('browserSettings.selectedA11y', { label: option.label }) : option.label
                    }
                    accessibilityHint={option.description}
                    onPress={() => {
                      onSelect(option.value);
                      onClose();
                    }}
                    style={{
                      minHeight: 52,
                      paddingVertical: 10,
                      flexDirection: rtl.rowDirection,
                      alignItems: 'center',
                      gap: 12,
                    }}>
                    {option.leading}
                    <Box flex={1} style={{ minWidth: 0 }}>
                      <Text variant="body" color={selected ? 'primary' : 'textPrimary'}>
                        {option.label}
                      </Text>
                      {option.description ? (
                        <Text variant="caption" color="textSecondary">
                          {option.description}
                        </Text>
                      ) : null}
                    </Box>
                    {selected ? <Icon name="check" size={22} color="primary" /> : null}
                  </Pressable>
                </Box>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export const ChoiceSheet = memo(ChoiceSheetBase) as typeof ChoiceSheetBase;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
});
