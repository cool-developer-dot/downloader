import { memo, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { Switch } from '@/components/inputs/Switch';
import { useSubtitleSettingsStore } from '@/downloads/v2/subtitle-store';
import { SUBTITLE_MODES, type SubtitleMode } from '@/downloads/v2/subtitles';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';

import { SettingsRow } from '../components';

const MODE_KEYS: Record<SubtitleMode, TranslationKey> = {
  all: 'subtitles.modeAll',
  app_language: 'subtitles.modeAppLanguage',
  first: 'subtitles.modeFirst',
};

export type SubtitleSettingsProps = {
  disabled?: boolean;
};

/** Download Settings → "Download subtitles when available" (H19): off by default; which tracks when on. */
export const SubtitleSettings = memo(function SubtitleSettings({ disabled }: SubtitleSettingsProps) {
  const { t } = useTranslation();
  const enabled = useSubtitleSettingsStore((s) => s.enabled);
  const mode = useSubtitleSettingsStore((s) => s.mode);
  const options = useMemo(() => SUBTITLE_MODES.map((value) => ({ value, label: t(MODE_KEYS[value]) })), [t]);

  return (
    <Box gap={8} testID="download-settings-subtitles">
      <SettingsRow
        title={t('subtitles.settingTitle')}
        description={t('subtitles.settingHint')}
        icon="subtitles-outline"
        trailing={
          <Switch
            value={enabled}
            onValueChange={(value) => useSubtitleSettingsStore.getState().setEnabled(value)}
            disabled={disabled}
            accessibilityLabel={t('subtitles.settingTitle')}
            accessibilityHint={t('subtitles.settingHint')}
            testID="download-settings-subtitles-switch"
          />
        }
        showDivider={!enabled}
        accessibilityHint={t('subtitles.settingHint')}
        testID="download-settings-subtitles-row"
      />
      {enabled ? (
        <Box pb={8}>
          <SegmentedControl<SubtitleMode>
            options={options}
            value={mode}
            onChange={(value) => useSubtitleSettingsStore.getState().setMode(value)}
            disabled={disabled}
            accessibilityLabel={t('subtitles.modeTitle')}
            testID="download-settings-subtitles-mode"
          />
        </Box>
      ) : null}
    </Box>
  );
});
