import { memo, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { Switch } from '@/components/inputs/Switch';
import {
  BUFFER_KB_CHOICES,
  COOLDOWN_SECONDS_CHOICES,
  WRITE_CACHE_KB_CHOICES,
  normalizeBufferKb,
  normalizeCooldownSeconds,
  normalizeLowMemoryMode,
  normalizeWriteCacheKb,
  type LowMemoryMode,
} from '@/downloads/v2/settings';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

type Translate = ReturnType<typeof useTranslation>['t'];

function choiceRow<T extends string>(
  title: string,
  hint: string,
  icon: string,
  value: T,
  label: string,
  options: { value: T; label: string }[],
  onChange: (next: T) => void,
  disabled: boolean,
  testID: string,
) {
  return (
    <Box gap={12} py={8} testID={testID}>
      <SettingsRow title={title} description={hint} icon={icon} value={label} showDivider={false} accessibilityHint={hint} testID={`${testID}-row`} />
      <SegmentedControl
        options={options.map((option) => ({ ...option, accessibilityLabel: `${title}, ${option.label}` }))}
        value={value}
        onChange={(next) => onChange(next as T)}
        disabled={disabled}
        accessibilityLabel={`${title}, ${label}`}
        testID={`${testID}-control`}
      />
    </Box>
  );
}

function kbLabel(kb: number, t: Translate): string {
  return t('downloadTuning.bufferValue', { count: kb });
}

function cacheLabel(kb: number, t: Translate): string {
  return kb === 0 ? t('downloadTuning.writeCacheOff') : t('downloadTuning.writeCacheValue', { count: kb / 1024 });
}

function cooldownLabel(seconds: number, t: Translate): string {
  return seconds === 0 ? t('downloadTuning.cooldownOff') : t('downloadTuning.cooldownValue', { count: seconds });
}

/**
 * Settings → Download Settings → "Performance" (P1): low memory mode (#348), buffer size (#350), disk write cache
 * (#344), cooldown between files (#506) and exit when done (#358). The engine applies them (ensure-bridge pushes the
 * values); low memory mode overrides the buffer, the cache, the connections and the number of downloads at once while
 * it is on, and the chosen values come back when it is off.
 */
export const DownloadPerformanceSection = memo(function DownloadPerformanceSection({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const lowMemory = normalizeLowMemoryMode(useSettingsStore((s) => s.lowMemoryMode));
  const bufferKb = normalizeBufferKb(useSettingsStore((s) => s.bufferKb));
  const writeCacheKb = normalizeWriteCacheKb(useSettingsStore((s) => s.writeCacheKb));
  const cooldownSeconds = normalizeCooldownSeconds(useSettingsStore((s) => s.cooldownSeconds));
  const exitWhenDone = useSettingsStore((s) => s.exitWhenDone);
  const update = useSettingsStore.getState().updateSetting;

  const lowMemoryOptions = useMemo(
    () =>
      (['auto', 'on', 'off'] as const).map((value) => ({
        value,
        label: t(value === 'auto' ? 'downloadTuning.lowMemoryAuto' : value === 'on' ? 'downloadTuning.lowMemoryOn' : 'downloadTuning.lowMemoryOff'),
      })),
    [t],
  );
  const bufferOptions = useMemo(() => BUFFER_KB_CHOICES.map((kb) => ({ value: String(kb), label: kbLabel(kb, t) })), [t]);
  const cacheOptions = useMemo(() => WRITE_CACHE_KB_CHOICES.map((kb) => ({ value: String(kb), label: cacheLabel(kb, t) })), [t]);
  const cooldownOptions = useMemo(
    () => COOLDOWN_SECONDS_CHOICES.map((seconds) => ({ value: String(seconds), label: cooldownLabel(seconds, t) })),
    [t],
  );
  const lowMemoryOn = lowMemory === 'on';

  return (
    <SettingsSection
      testID="download-settings-performance"
      title={t('downloadTuning.section')}
      description={t('downloadTuning.sectionHint')}
      icon="speedometer">
      {choiceRow<LowMemoryMode>(
        t('downloadTuning.lowMemory'),
        t('downloadTuning.lowMemoryHint'),
        'memory',
        lowMemory,
        lowMemoryOptions.find((o) => o.value === lowMemory)?.label ?? '',
        lowMemoryOptions,
        (next) => update('lowMemoryMode', next),
        disabled,
        'download-settings-low-memory',
      )}
      {choiceRow(
        t('downloadTuning.buffer'),
        lowMemoryOn ? `${t('downloadTuning.bufferHint')} ${t('downloadTuning.lowMemoryActive')}` : t('downloadTuning.bufferHint'),
        'tray-arrow-down',
        String(bufferKb),
        kbLabel(bufferKb, t),
        bufferOptions,
        (next) => update('bufferKb', normalizeBufferKb(next)),
        disabled || lowMemoryOn,
        'download-settings-buffer',
      )}
      {choiceRow(
        t('downloadTuning.writeCache'),
        lowMemoryOn ? `${t('downloadTuning.writeCacheHint')} ${t('downloadTuning.lowMemoryActive')}` : t('downloadTuning.writeCacheHint'),
        'harddisk',
        String(writeCacheKb),
        cacheLabel(writeCacheKb, t),
        cacheOptions,
        (next) => update('writeCacheKb', normalizeWriteCacheKb(next)),
        disabled || lowMemoryOn,
        'download-settings-write-cache',
      )}
      {choiceRow(
        t('downloadTuning.cooldown'),
        t('downloadTuning.cooldownHint'),
        'timer-sand',
        String(cooldownSeconds),
        cooldownLabel(cooldownSeconds, t),
        cooldownOptions,
        (next) => update('cooldownSeconds', normalizeCooldownSeconds(next)),
        disabled,
        'download-settings-cooldown',
      )}
      <SettingsRow
        title={t('downloadTuning.exitWhenDone')}
        description={t('downloadTuning.exitWhenDoneHint')}
        icon="exit-run"
        trailing={
          <Switch
            value={exitWhenDone}
            onValueChange={(value) => update('exitWhenDone', value)}
            disabled={disabled}
            accessibilityLabel={t('downloadTuning.exitWhenDone')}
            accessibilityHint={t('downloadTuning.exitWhenDoneHint')}
            testID="download-settings-exit-when-done-switch"
          />
        }
        showDivider={false}
        accessibilityHint={t('downloadTuning.exitWhenDoneHint')}
        testID="download-settings-exit-when-done"
      />
    </SettingsSection>
  );
});
