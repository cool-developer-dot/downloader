import { memo } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

/** B9 — Browser settings → Bookmarks: the bookmarks bar switch (#81, off by default) and the way to the bookmarks. */
export const BookmarksSettingsSection = memo(function BookmarksSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const bar = useSettingsStore((s) => s.bookmarksBar === true);
  return (
    <SettingsSection testID="browser-settings-bookmarks" title={t('browserBookmarks.title')} icon="bookmark-outline">
      <SettingsRow
        title={t('browserBookmarks.bookmarksBarSetting')}
        description={t('browserBookmarks.bookmarksBarHint')}
        icon="bookmark-box-multiple-outline"
        trailing={
          <Switch
            value={bar}
            onValueChange={(next) => update('bookmarksBar', next)}
            accessibilityLabel={t('browserBookmarks.bookmarksBarSetting')}
            accessibilityHint={t('browserBookmarks.bookmarksBarHint')}
            testID="browser-settings-bookmarks-bar"
          />
        }
      />
      <SettingsRow
        title={t('browserBookmarks.title')}
        icon="bookmark-multiple-outline"
        onPress={() => navigation.push(routePaths.bookmarks)}
        showDivider={false}
        testID="browser-settings-open-bookmarks"
      />
    </SettingsSection>
  );
});
