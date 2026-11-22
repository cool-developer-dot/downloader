import { memo, type PropsWithChildren } from 'react';

import { isSettingVisible } from '@/store/settings/settings-view';
import { selectSettingsView, useSettingsStore } from '@/store/settings';

/** P8 #516/#517: true when a row marked `advanced` shows in the current Settings view. */
export function useSettingVisible(advanced: boolean | undefined): boolean {
  const view = useSettingsStore(selectSettingsView);
  return isSettingVisible(advanced, view);
}

/**
 * Wraps settings content that is only for the Advanced view (a row together with its control, an editor…). Rows and
 * sections can take the `advanced` prop instead.
 */
export const AdvancedSetting = memo(function AdvancedSetting({ children }: PropsWithChildren) {
  return useSettingVisible(true) ? <>{children}</> : null;
});
