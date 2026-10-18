import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { IconButton } from '@/components/buttons/IconButton';
import { Chip } from '@/components/common/Chip';
import { Switch } from '@/components/inputs/Switch';
import {
  ALL_DAYS,
  formatMinuteOfDay,
  normalizeDownloadHours,
  stepMinuteOfDay,
  toggleDay,
  weekdayName,
  type DownloadHours,
} from '@/downloads/v2/conditions';
import { useTranslation } from '@/localization';
import {
  selectDownloadHours,
  selectNotOnRoaming,
  selectOnlyWhileCharging,
  selectPauseOnLowBattery,
  useSettingsStore,
} from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

/** "From 01:00 [−] [+]": one end of the download hours. */
const TimeStepper = memo(function TimeStepper({
  label,
  minute,
  disabled,
  onChange,
  testID,
}: {
  label: string;
  minute: number;
  disabled: boolean;
  onChange: (minute: number) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const time = formatMinuteOfDay(minute);
  return (
    <Box row rtlRow gap={12} style={{ alignItems: 'center' }} testID={testID}>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <IconButton
        icon="minus"
        variant="outline"
        size="small"
        disabled={disabled}
        onPress={() => onChange(stepMinuteOfDay(minute, -1))}
        accessibilityLabel={`${label} ${time}, ${t('settings.downloadHoursEarlier')}`}
        testID={`${testID}-earlier`}
      />
      <Text variant="subtitle" style={{ minWidth: 64, textAlign: 'center' }} testID={`${testID}-value`}>
        {time}
      </Text>
      <IconButton
        icon="plus"
        variant="outline"
        size="small"
        disabled={disabled}
        onPress={() => onChange(stepMinuteOfDay(minute, 1))}
        accessibilityLabel={`${label} ${time}, ${t('settings.downloadHoursLater')}`}
        testID={`${testID}-later`}
      />
    </Box>
  );
});

/**
 * Settings → Download Settings → "Schedule & conditions" (F3): the daily download hours with weekdays, Not on roaming,
 * Pause when battery is low and Only while charging. The engine enforces them (ensure-bridge pushes the values);
 * Android decides the exact wake-up time, hence the "a few minutes late" note.
 */
export const DownloadConditionsSection = memo(function DownloadConditionsSection({ disabled }: { disabled: boolean }) {
  const { t, language } = useTranslation();
  const hours = normalizeDownloadHours(useSettingsStore(selectDownloadHours));
  const notOnRoaming = useSettingsStore(selectNotOnRoaming);
  const pauseOnLowBattery = useSettingsStore(selectPauseOnLowBattery);
  const onlyWhileCharging = useSettingsStore(selectOnlyWhileCharging);

  const setHours = useCallback((patch: Partial<DownloadHours>) => {
    const current = normalizeDownloadHours(useSettingsStore.getState().downloadHours);
    useSettingsStore.getState().updateSetting('downloadHours', normalizeDownloadHours({ ...current, ...patch }));
  }, []);

  return (
    <SettingsSection
      testID="download-settings-conditions"
      title={t('settings.conditionsSection')}
      description={t('settings.conditionsDescription')}
      icon="calendar-clock">
      <SettingsRow
        title={t('settings.downloadHours')}
        description={t('settings.downloadHoursHint')}
        icon="clock-outline"
        trailing={
          <Switch
            value={hours.enabled}
            onValueChange={(value) => setHours({ enabled: value })}
            disabled={disabled}
            accessibilityLabel={t('settings.downloadHours')}
            accessibilityHint={t('settings.downloadHoursHint')}
            testID="download-settings-hours-switch"
          />
        }
        showDivider={!hours.enabled}
        accessibilityHint={t('settings.downloadHoursHint')}
        testID="download-settings-hours"
      />
      {hours.enabled ? (
        <Box gap={12} pb={14} testID="download-settings-hours-editor">
          <TimeStepper
            label={t('settings.downloadHoursFrom')}
            minute={hours.startMinute}
            disabled={disabled}
            onChange={(startMinute) => setHours({ startMinute })}
            testID="download-settings-hours-start"
          />
          <TimeStepper
            label={t('settings.downloadHoursUntil')}
            minute={hours.endMinute}
            disabled={disabled}
            onChange={(endMinute) => setHours({ endMinute })}
            testID="download-settings-hours-end"
          />
          <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }} testID="download-settings-hours-days">
            {ALL_DAYS.map((day) => (
              <Chip
                key={day}
                label={weekdayName(day, language)}
                selected={hours.days.includes(day)}
                disabled={disabled}
                onPress={() => setHours({ days: toggleDay(hours.days, day) })}
                testID={`download-settings-hours-day-${day}`}
              />
            ))}
          </Box>
          <Text variant="caption" color="textSecondary">
            {hours.startMinute === hours.endMinute
              ? t('settings.downloadHoursAllDay')
              : t('settings.downloadHoursSummary', {
                  start: formatMinuteOfDay(hours.startMinute),
                  end: formatMinuteOfDay(hours.endMinute),
                })}
          </Text>
          <Text variant="caption" color="textSecondary">
            {t('settings.conditionsLateNote')}
          </Text>
        </Box>
      ) : null}
      <SettingsRow
        title={t('settings.notOnRoaming')}
        description={t('settings.notOnRoamingHint')}
        icon="earth-off"
        trailing={
          <Switch
            value={notOnRoaming}
            onValueChange={(value) => useSettingsStore.getState().updateSetting('notOnRoaming', value)}
            disabled={disabled}
            accessibilityLabel={t('settings.notOnRoaming')}
            accessibilityHint={t('settings.notOnRoamingHint')}
            testID="download-settings-not-on-roaming-switch"
          />
        }
        accessibilityHint={t('settings.notOnRoamingHint')}
        testID="download-settings-not-on-roaming"
      />
      <SettingsRow
        title={t('settings.pauseOnLowBattery')}
        description={t('settings.pauseOnLowBatteryHint')}
        icon="battery-alert-variant-outline"
        trailing={
          <Switch
            value={pauseOnLowBattery}
            onValueChange={(value) => useSettingsStore.getState().updateSetting('pauseOnLowBattery', value)}
            disabled={disabled}
            accessibilityLabel={t('settings.pauseOnLowBattery')}
            accessibilityHint={t('settings.pauseOnLowBatteryHint')}
            testID="download-settings-low-battery-switch"
          />
        }
        accessibilityHint={t('settings.pauseOnLowBatteryHint')}
        testID="download-settings-low-battery"
      />
      <SettingsRow
        title={t('settings.onlyWhileCharging')}
        description={t('settings.onlyWhileChargingHint')}
        icon="battery-charging-outline"
        trailing={
          <Switch
            value={onlyWhileCharging}
            onValueChange={(value) => useSettingsStore.getState().updateSetting('onlyWhileCharging', value)}
            disabled={disabled}
            accessibilityLabel={t('settings.onlyWhileCharging')}
            accessibilityHint={t('settings.onlyWhileChargingHint')}
            testID="download-settings-only-charging-switch"
          />
        }
        showDivider={false}
        accessibilityHint={t('settings.onlyWhileChargingHint')}
        testID="download-settings-only-charging"
      />
    </SettingsSection>
  );
});
