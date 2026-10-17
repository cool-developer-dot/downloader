import { memo, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { DUPLICATE_ACTIONS, type DuplicateAction } from '@/downloads/v2/duplicate-action';
import { useDuplicateActionStore } from '@/downloads/v2/duplicate-action-store';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';

import { SettingsRow } from '../components';

const LABEL_KEYS: Record<DuplicateAction, TranslationKey> = {
  skip: 'duplicates.skip',
  ask: 'duplicates.ask',
  keep_both: 'duplicates.keepBoth',
  replace: 'duplicates.replace',
};

const HINT_KEYS: Record<DuplicateAction, TranslationKey> = {
  skip: 'duplicates.skipHint',
  ask: 'duplicates.askHint',
  keep_both: 'duplicates.keepBothHint',
  replace: 'duplicates.replaceSettingHint',
};

export type DuplicateActionSettingProps = {
  disabled?: boolean;
};

/** Download Settings → "When a video is already downloaded" (#386): Skip (default, as before), Ask, Keep both, Replace. */
export const DuplicateActionSetting = memo(function DuplicateActionSetting({ disabled }: DuplicateActionSettingProps) {
  const { t } = useTranslation();
  const action = useDuplicateActionStore((s) => s.action);
  const options = useMemo(
    () => DUPLICATE_ACTIONS.map((value) => ({ value, label: t(LABEL_KEYS[value]) })),
    [t],
  );

  return (
    <Box gap={8} py={8} testID="download-settings-duplicate-action">
      <SettingsRow
        title={t('duplicates.settingTitle')}
        description={t('duplicates.settingDescription')}
        icon="content-duplicate"
        showDivider={false}
        accessibilityHint={t('duplicates.settingDescription')}
        testID="download-settings-duplicate-action-row"
      />
      <SegmentedControl<DuplicateAction>
        options={options}
        value={action}
        onChange={(value) => useDuplicateActionStore.getState().setAction(value)}
        disabled={disabled}
        accessibilityLabel={t('duplicates.settingTitle')}
        testID="download-settings-duplicate-action-control"
      />
      <Text variant="caption" color="textSecondary">
        {t(HINT_KEYS[action])}
      </Text>
    </Box>
  );
});
