import { memo, useCallback, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { Switch } from '@/components/inputs/Switch';
import { maxLengthLabel } from '@/downloads/v2/live-recording';
import { LIVE_RECORDING_MAX_MINUTES_CHOICES, normalizeLiveRecordingMaxMinutes } from '@/downloads/v2/settings';
import { useTranslation } from '@/localization';
import { selectLiveRecording, selectLiveRecordingMaxMinutes, useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

/**
 * Settings → Download Settings → "Advanced" (F6): "Live recording (beta)", off by default — a live HLS stream then
 * offers Record instead of being refused — and the longest a recording may run. The engine enforces both
 * (ensure-bridge pushes the values), so a recording stops at the limit with the app closed too.
 */
export const DownloadAdvancedSection = memo(function DownloadAdvancedSection({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const liveRecording = useSettingsStore(selectLiveRecording);
  const maxMinutes = normalizeLiveRecordingMaxMinutes(useSettingsStore(selectLiveRecordingMaxMinutes));

  const options = useMemo(
    () =>
      LIVE_RECORDING_MAX_MINUTES_CHOICES.map((minutes) => ({
        value: String(minutes),
        label: maxLengthLabel(minutes, t),
        accessibilityLabel: `${t('settings.liveRecordingMax')}, ${maxLengthLabel(minutes, t)}`,
      })),
    [t],
  );
  const onMaxChange = useCallback((next: string) => {
    useSettingsStore.getState().updateSetting('liveRecordingMaxMinutes', normalizeLiveRecordingMaxMinutes(next));
  }, []);

  return (
    <SettingsSection
      testID="download-settings-advanced"
      title={t('settings.advancedSection')}
      description={t('settings.advancedDescription')}
      icon="tune-variant">
      <SettingsRow
        title={t('settings.liveRecording')}
        description={t('settings.liveRecordingHint')}
        icon="record-rec"
        trailing={
          <Switch
            value={liveRecording}
            onValueChange={(value) => useSettingsStore.getState().updateSetting('liveRecording', value)}
            disabled={disabled}
            accessibilityLabel={t('settings.liveRecording')}
            accessibilityHint={t('settings.liveRecordingHint')}
            testID="download-settings-live-recording-switch"
          />
        }
        showDivider={liveRecording}
        accessibilityHint={t('settings.liveRecordingHint')}
        testID="download-settings-live-recording"
      />
      {liveRecording ? (
        <Box gap={12} py={8} testID="download-settings-live-max">
          <SettingsRow
            title={t('settings.liveRecordingMax')}
            description={t('settings.liveRecordingMaxHint')}
            icon="timer-outline"
            value={maxLengthLabel(maxMinutes, t)}
            showDivider={false}
            accessibilityHint={t('settings.liveRecordingMaxHint')}
            testID="download-settings-live-max-row"
          />
          <SegmentedControl
            options={options}
            value={String(maxMinutes)}
            onChange={onMaxChange}
            disabled={disabled}
            accessibilityLabel={`${t('settings.liveRecordingMax')}, ${maxLengthLabel(maxMinutes, t)}`}
            testID="download-settings-live-max-control"
          />
        </Box>
      ) : null}
    </SettingsSection>
  );
});
