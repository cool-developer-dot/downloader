import { memo, useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid, View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Switch } from '@/components/inputs/Switch';
import { resetTranslateNever } from '@/browser/language/translate-offer.service';
import { clampAlertHours } from '@/browser/page-alerts/page-alerts-core';
import { listWatchedPages, syncPageAlertTask, unwatchPage, usePageAlertsVersion } from '@/browser/page-alerts/page-alerts.service';
import { useTranslation } from '@/localization';
import type { PageWatch } from '@/storage/repositories/annotate.repository';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

const HOURS = [1, 3, 6, 12, 24] as const;

/** B23 — Browser settings: Page alerts (#289: interval, Wi-Fi only, watched pages) and the translate offer (#263). */
export const AnnotateSettingsSection = memo(function AnnotateSettingsSection() {
  const { t, rtl } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const hours = useSettingsStore((s) => clampAlertHours(s.pageAlertHours));
  const wifiOnly = useSettingsStore((s) => s.pageAlertWifiOnly !== false);
  const offerTranslate = useSettingsStore((s) => s.offerTranslate !== false);
  const changes = usePageAlertsVersion();
  const [watches, setWatches] = useState<PageWatch[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listWatchedPages().then((list) => {
      if (!cancelled) setWatches(list);
    });
    return () => {
      cancelled = true;
    };
  }, [changes]);

  return (
    <SettingsSection testID="browser-settings-annotate" title={t('browserAnnotate.alertsSection')} icon="bell-ring-outline">
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}>
        <Text variant="body" style={{ textAlign: rtl.textAlign }}>
          {t('browserAnnotate.alertsEvery')}
        </Text>
        <View style={{ flexDirection: rtl.rowDirection, gap: 6, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
          {HOURS.map((h) => (
            <Choice
              key={h}
              label={t('browserAnnotate.alertsHours', { hours: h })}
              selected={hours === h}
              onPress={() => {
                update('pageAlertHours', h);
                void syncPageAlertTask();
              }}
            />
          ))}
        </View>
      </View>
      <SettingsRow
        title={t('browserAnnotate.alertsWifi')}
        description={t('browserAnnotate.alertsWifiHint')}
        icon="wifi"
        trailing={<Switch value={wifiOnly} onValueChange={(v) => update('pageAlertWifiOnly', v)} accessibilityLabel={t('browserAnnotate.alertsWifi')} />}
      />
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}>
        <Text variant="label" accessibilityRole="header" style={{ textAlign: rtl.textAlign }}>
          {t('browserAnnotate.alertsList')}
        </Text>
        {watches.length === 0 ? (
          <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
            {t('browserAnnotate.alertsNone')}
          </Text>
        ) : (
          watches.map((w) => (
            <View key={w.id} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 48, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
                  {w.title || w.url}
                </Text>
                <Text variant="caption" color={w.status === 'ok' ? 'textSecondary' : 'warning'} numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
                  {w.status === 'cannotWatch'
                    ? t('browserAnnotate.alertsStatusCannot')
                    : w.status === 'failed'
                      ? t('browserAnnotate.alertsStatusFailed')
                      : w.lastChangedAt
                        ? t('browserAnnotate.alertsChanged', { when: w.lastChangedAt.slice(0, 16).replace('T', ' ') })
                        : w.url}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserAnnotate.alertsRemoveA11y', { title: w.title || w.url })}
                onPress={() => void unwatchPage(w.id)}
                style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="delete-outline" size={20} color="error" />
              </Pressable>
            </View>
          ))
        )}
        <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {t('browserAnnotate.alertsNote')}
        </Text>
      </View>
      <SettingsRow
        title={t('browserAnnotate.translateSetting')}
        description={t('browserAnnotate.translateSettingHint')}
        icon="translate"
        trailing={
          <Switch value={offerTranslate} onValueChange={(v) => update('offerTranslate', v)} accessibilityLabel={t('browserAnnotate.translateSetting')} />
        }
      />
      <SettingsRow
        title={t('browserAnnotate.translateReset')}
        icon="restore"
        showDivider={false}
        onPress={() => {
          resetTranslateNever();
          const message = t('browserAnnotate.translateResetDone');
          if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
          AccessibilityInfo.announceForAccessibility(message);
        }}
      />
    </SettingsSection>
  );
});

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      style={{ minHeight: 48, minWidth: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="label" color={selected ? 'primary' : 'textSecondary'}>
        {selected ? `● ${label}` : label}
      </Text>
    </Pressable>
  );
}
