import { memo } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

/** B10 #101 — on the History screen while "Save history" is off: says so, and turns it back on. */
export const HistoryOffBanner = memo(function HistoryOffBanner({ testID = 'history-off-banner' }: { testID?: string }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const saveHistory = useSettingsStore((s) => s.saveHistory !== false);
  const update = useSettingsStore((s) => s.updateSetting);

  if (saveHistory) return null;

  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 12,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        flexDirection: rtl.rowDirection,
        alignItems: 'center',
        gap: 12,
      }}>
      <Icon name="history" size={22} color="secondary" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" accessibilityRole="header">
          {t('browserHistory.historyOff')}
        </Text>
        <Text variant="caption" color="textSecondary">
          {t('browserHistory.historyOffBody')}
        </Text>
      </View>
      <Pressable
        testID={`${testID}-turn-on`}
        accessibilityRole="button"
        accessibilityLabel={t('browserHistory.turnOnA11y')}
        onPress={() => update('saveHistory', true)}
        style={{ minHeight: 48, minWidth: 64, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="button" color="primary">
          {t('browserHistory.turnOn')}
        </Text>
      </Pressable>
    </View>
  );
});
