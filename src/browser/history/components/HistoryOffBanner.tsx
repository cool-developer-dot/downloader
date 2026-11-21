import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsCard, DsIcon, DsText, ds } from '@/design';
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
    <DsCard testID={testID} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: ds.space.rowGap }}>
      <View
        style={{
          width: ds.size.iconTile,
          height: ds.size.iconTile,
          borderRadius: ds.radius.iconTile,
          backgroundColor: theme.colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <DsIcon name="history" size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }} accessibilityRole="summary">
        <DsText variant="rowTitle" accessibilityRole="header">
          {t('browserHistory.historyOff')}
        </DsText>
        <DsText variant="rowSub">{t('browserHistory.historyOffBody')}</DsText>
      </View>
      <Pressable
        testID={`${testID}-turn-on`}
        accessibilityRole="button"
        accessibilityLabel={t('browserHistory.turnOnA11y')}
        onPress={() => update('saveHistory', true)}
        style={{ minHeight: 48, minWidth: 64, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
        <DsText variant="bodyStrong" color="primary">
          {t('browserHistory.turnOn')}
        </DsText>
      </Pressable>
    </DsCard>
  );
});
