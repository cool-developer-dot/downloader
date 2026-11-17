import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { DsCard, DsChip, DsChipRow, DsIconButton, DsRow, DsRowGroup, DsSectionLabel, DsText } from '@/design';
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
import { selectDownloadHours, useSettingsStore } from '@/store/settings';

import { LightSheet } from './LightSheet';

/** "From 01:00 [−] [+]" in the design kit's parts. */
const TimeStepper = memo(function TimeStepper({
  label,
  minute,
  onChange,
  testID,
}: {
  label: string;
  minute: number;
  onChange: (minute: number) => void;
  testID: string;
}) {
  const { t, rtl } = useTranslation();
  const time = formatMinuteOfDay(minute);
  return (
    <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8, minHeight: 48 }} testID={testID}>
      <DsText variant="rowTitle" style={{ flex: 1 }}>
        {label}
      </DsText>
      <DsIconButton
        icon="minus"
        variant="plain"
        onPress={() => onChange(stepMinuteOfDay(minute, -1))}
        accessibilityLabel={`${label} ${time}, ${t('lightQueues.hoursEarlier')}`}
        testID={`${testID}-earlier`}
      />
      <DsText variant="rowTitle" align="center" style={{ minWidth: 56 }} testID={`${testID}-value`}>
        {time}
      </DsText>
      <DsIconButton
        icon="plus"
        variant="plain"
        onPress={() => onChange(stepMinuteOfDay(minute, 1))}
        accessibilityLabel={`${label} ${time}, ${t('lightQueues.hoursLater')}`}
        testID={`${testID}-later`}
      />
    </View>
  );
});

export type DownloadHoursSheetProps = {
  visible: boolean;
  onClose: () => void;
  testID?: string;
};

/**
 * The download-hours editor (F3) as a design sheet: on/off, the start and stop time, the weekdays. The settings store
 * keeps the value; the engine enforces it (ensure-bridge). Opened by "Night queue", "Scheduled download" and
 * "Weekly schedule" on Queues & schedule, and by "Hours & rules" on Download settings.
 */
export const DownloadHoursSheet = memo(function DownloadHoursSheet({ visible, onClose, testID = 'download-hours-sheet' }: DownloadHoursSheetProps) {
  const { t, language } = useTranslation();
  const hours = normalizeDownloadHours(useSettingsStore(selectDownloadHours));

  const setHours = useCallback((patch: Partial<DownloadHours>) => {
    const current = normalizeDownloadHours(useSettingsStore.getState().downloadHours);
    useSettingsStore.getState().updateSetting('downloadHours', normalizeDownloadHours({ ...current, ...patch }));
  }, []);

  return (
    <LightSheet visible={visible} title={t('lightQueues.hoursTitle')} subtitle={t('settings.downloadHoursHint')} onClose={onClose} testID={testID}>
      <DsRowGroup>
        <DsRow
          icon="clock"
          title={t('lightQueues.hoursEnabled')}
          toggle={{ value: hours.enabled, onValueChange: (value) => setHours({ enabled: value }) }}
          testID={`${testID}-enabled`}
        />
      </DsRowGroup>
      <DsSectionLabel>{t('lightQueues.startStopTime')}</DsSectionLabel>
      <DsCard>
        <TimeStepper
          label={t('settings.downloadHoursFrom')}
          minute={hours.startMinute}
          onChange={(startMinute) => setHours({ startMinute })}
          testID={`${testID}-start`}
        />
        <TimeStepper
          label={t('settings.downloadHoursUntil')}
          minute={hours.endMinute}
          onChange={(endMinute) => setHours({ endMinute })}
          testID={`${testID}-end`}
        />
        <DsText variant="rowSub" style={{ marginTop: 6 }}>
          {hours.startMinute === hours.endMinute
            ? t('settings.downloadHoursAllDay')
            : t('settings.downloadHoursSummary', {
                start: formatMinuteOfDay(hours.startMinute),
                end: formatMinuteOfDay(hours.endMinute),
              })}
        </DsText>
      </DsCard>
      <DsSectionLabel>{t('lightQueues.hoursDays')}</DsSectionLabel>
      <DsChipRow scroll={false} testID={`${testID}-days`}>
        {ALL_DAYS.map((day) => (
          <DsChip
            key={day}
            label={weekdayName(day, language)}
            selected={hours.days.includes(day)}
            onPress={() => setHours({ days: toggleDay(hours.days, day) })}
            testID={`${testID}-day-${day}`}
          />
        ))}
      </DsChipRow>
      <DsText variant="rowSub">{t('settings.conditionsLateNote')}</DsText>
    </LightSheet>
  );
});
