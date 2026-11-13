import { memo, useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Platform, Pressable as RNPressable, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Divider } from '@/components/common/Divider';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { useTourBlocker } from '@/tour/tour-store';

import { BROWSING_DATA_RANGES, type BrowsingDataRange } from '../browsing-data-range';
import { clearBrowsingData, clearsSiteData } from '../browsing-data.service';

export const RANGE_LABELS: Record<BrowsingDataRange, TranslationKey> = {
  hour: 'browserHistory.rangeHour',
  day: 'browserHistory.rangeDay',
  week: 'browserHistory.rangeWeek',
  fourWeeks: 'browserHistory.rangeFourWeeks',
  all: 'browserHistory.rangeAll',
};

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * B10 #98 — Clear browsing data: a time range (last hour by default, as in other browsers), what will be cleared, and
 * Clear. Used from Browser settings → History and from the History screen.
 */
export const ClearBrowsingDataSheet = memo(function ClearBrowsingDataSheet({
  visible,
  onClose,
  onCleared,
  testID = 'clear-browsing-data',
}: {
  visible: boolean;
  onClose: () => void;
  onCleared?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();
  const [range, setRange] = useState<BrowsingDataRange>('hour');
  const [busy, setBusy] = useState(false);

  useTourBlocker(visible);

  useEffect(() => {
    if (visible) setRange('hour');
  }, [visible]);

  const handleClear = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await clearBrowsingData(range);
      notify(t('browserHistory.cleared'));
      onCleared?.();
      onClose();
    } catch {
      notify(t('browserHistory.clearFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, onClose, onCleared, range, t]);

  if (!visible) return null;

  const items: TranslationKey[] = [
    'browserHistory.itemHistory',
    'browserHistory.itemSearches',
    'browserHistory.itemClosedTabs',
    'browserHistory.itemPreviews',
  ];
  const siteData = clearsSiteData();
  if (siteData) items.push('browserHistory.itemSiteData');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={busy ? () => undefined : onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={busy ? undefined : onClose}
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
            maxHeight: '90%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <Box px={16} pb={4}>
            <Text variant="title" accessibilityRole="header">
              {t('browserHistory.clearData')}
            </Text>
          </Box>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Text variant="label" color="textSecondary" style={{ marginTop: 8, marginBottom: 4 }}>
              {t('browserHistory.rangeTitle')}
            </Text>
            <View accessibilityRole="radiogroup">
              {BROWSING_DATA_RANGES.map((value, index) => {
                const selected = value === range;
                const label = t(RANGE_LABELS[value]);
                return (
                  <Box key={value}>
                    {index > 0 ? <Divider /> : null}
                    <Pressable
                      testID={`${testID}-${value}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: busy }}
                      accessibilityLabel={selected ? t('browserSettings.selectedA11y', { label }) : label}
                      onPress={busy ? undefined : () => setRange(value)}
                      style={{ minHeight: 48, paddingVertical: 8, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
                      <Icon name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={22} color={selected ? 'primary' : 'secondary'} />
                      <Text variant="body" style={{ flex: 1 }} color={selected ? 'primary' : 'textPrimary'}>
                        {label}
                      </Text>
                    </Pressable>
                  </Box>
                );
              })}
            </View>
            <Text variant="label" color="textSecondary" style={{ marginTop: 16, marginBottom: 4 }}>
              {t('browserHistory.clearsTitle')}
            </Text>
            {items.map((key) => (
              <View
                key={key}
                style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                <Icon name="check" size={18} color="secondary" />
                <Text variant="body" style={{ flex: 1 }}>
                  {t(key)}
                </Text>
              </View>
            ))}
            {!siteData ? (
              <Text variant="caption" color="textSecondary" style={{ marginTop: 8 }}>
                {t('browserHistory.siteDataKept')}
              </Text>
            ) : null}
            <Text variant="caption" color="textSecondary" style={{ marginTop: 4 }}>
              {t('browserHistory.profileNote')}
            </Text>
          </ScrollView>
          <View style={{ flexDirection: rtl.rowDirection, gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
            <Button
              title={t('common.cancel')}
              variant="outline"
              onPress={onClose}
              disabled={busy}
              style={{ flex: 1 }}
              testID={`${testID}-cancel`}
            />
            <Button
              title={t('browserHistory.clearAction')}
              variant="destructive"
              loading={busy}
              disabled={busy}
              onPress={() => void handleClear()}
              accessibilityLabel={t('browserHistory.clearActionA11y', { range: t(RANGE_LABELS[range]) })}
              style={{ flex: 1 }}
              testID={`${testID}-confirm`}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
});
