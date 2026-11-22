import { memo, useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { useTranslation } from '@/localization';
import { selectSettingsView, useSettingsStore } from '@/store/settings';
import type { SettingsView } from '@/store/settings/settings-view';

import { useSettingsTokens } from '../theme/settings-tokens';

/**
 * The Download Settings header (P8 #516/#517): which Settings view is on — Simple hides the rows marked `advanced`,
 * Advanced shows everything — and the switch between them.
 */
export const SettingsViewModeSection = memo(function SettingsViewModeSection({ disabled }: { disabled: boolean }) {
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const view = useSettingsStore(selectSettingsView);

  const options = useMemo(
    () => [
      { value: 'simple' as const, label: t('settingsView.simple'), accessibilityLabel: t('settingsView.simpleA11y') },
      { value: 'advanced' as const, label: t('settingsView.advanced'), accessibilityLabel: t('settingsView.advancedA11y') },
    ],
    [t],
  );
  const onChange = useCallback((next: SettingsView) => {
    useSettingsStore.getState().updateSetting('settingsView', next);
  }, []);

  return (
    <View testID="download-settings-view-mode" accessibilityRole="header">
      <Box
        gap={10}
        p={14}
        style={{
          backgroundColor: settingsTokens.card,
          borderRadius: settingsTokens.radius.card,
          borderWidth: 1,
          borderColor: settingsTokens.cardBorder,
        }}>
        <Box row rtlRow gap={10} style={{ alignItems: 'center' }}>
          <Icon name={view === 'simple' ? 'tune-variant' : 'tune-vertical'} size="sm" color="primary" />
          <Text variant="subtitle" style={{ flex: 1, color: settingsTokens.textPrimary }} testID="download-settings-view-mode-title">
            {t(view === 'simple' ? 'settingsView.headerSimple' : 'settingsView.headerAdvanced')}
          </Text>
        </Box>
        <Text variant="caption" style={{ lineHeight: 18, color: settingsTokens.textSecondary }}>
          {t(view === 'simple' ? 'settingsView.simpleHint' : 'settingsView.advancedHint')}
        </Text>
        <SegmentedControl
          options={options}
          value={view}
          onChange={onChange}
          disabled={disabled}
          accessibilityLabel={`${t('settingsView.label')}, ${t(view === 'simple' ? 'settingsView.simple' : 'settingsView.advanced')}`}
          testID="download-settings-view-mode-control"
        />
      </Box>
    </View>
  );
});
