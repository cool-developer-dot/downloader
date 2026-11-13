import { memo } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { IconButton } from '@/components/buttons/IconButton';
import { Divider } from '@/components/common/Divider';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import {
  addToolbarButton,
  DEFAULT_TOOLBAR_BUTTONS_VALUE,
  MAX_TOOLBAR_BUTTONS,
  moveToolbarButton,
  parseToolbarButtons,
  removeToolbarButton,
  serializeToolbarButtons,
  TOOLBAR_BUTTON_IDS,
  type ToolbarButtonId,
} from '../toolbar-buttons';
import { SheetFrame } from './SheetFrame';

export const TOOLBAR_BUTTON_META: Record<ToolbarButtonId, { icon: IconName; name: TranslationKey }> = {
  back: { icon: 'arrow-left', name: 'browserStartup.nameBack' },
  forward: { icon: 'arrow-right', name: 'browserStartup.nameForward' },
  home: { icon: 'home', name: 'browserStartup.nameHome' },
  newTab: { icon: 'tab-plus', name: 'browserStartup.buttonNewTab' },
  reload: { icon: 'refresh', name: 'browserStartup.buttonReload' },
  share: { icon: 'share-variant', name: 'browserStartup.buttonShare' },
  bookmarks: { icon: 'bookmark-outline', name: 'browserStartup.buttonBookmarks' },
  history: { icon: 'history', name: 'browserStartup.buttonHistory' },
  downloads: { icon: 'download', name: 'browserStartup.buttonDownloads' },
  searchSite: { icon: 'magnify', name: 'browserStartup.buttonSearchSite' },
};

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * B21 #238 — Customize toolbar: the buttons on the toolbar in order (move earlier / later, remove), the buttons that
 * can be added, Tabs and Menu shown as locked (they live in the address bar), and Reset to default. Changes apply at
 * once; buttons with arrows rather than dragging, so they work with TalkBack and in RTL.
 */
export const ToolbarCustomizeSheet = memo(function ToolbarCustomizeSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t, rtl } = useTranslation();
  const stored = useSettingsStore((s) => s.toolbarButtons);
  const update = useSettingsStore((s) => s.updateSetting);
  const shown = parseToolbarButtons(stored);
  const available = TOOLBAR_BUTTON_IDS.filter((id) => !shown.includes(id));
  const full = shown.length >= MAX_TOOLBAR_BUTTONS;

  const save = (next: ToolbarButtonId[]) => update('toolbarButtons', serializeToolbarButtons(next));
  const name = (id: ToolbarButtonId) => t(TOOLBAR_BUTTON_META[id].name);

  const row = (icon: IconName, label: string, trailing: React.ReactNode, testID?: string) => (
    <View
      testID={testID}
      style={{ minHeight: 52, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12, paddingVertical: 2 }}>
      <Icon name={icon} size={22} color="secondary" />
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>{trailing}</View>
    </View>
  );

  return (
    <SheetFrame
      visible={visible}
      title={t('browserStartup.toolbar')}
      onClose={onClose}
      testID="browser-settings-toolbar-sheet"
      footer={
        <Button
          title={t('browserStartup.toolbarReset')}
          variant="outline"
          leftIcon="restore"
          onPress={() => {
            update('toolbarButtons', DEFAULT_TOOLBAR_BUTTONS_VALUE);
            notify(t('browserStartup.toolbarResetDone'));
          }}
          testID="browser-settings-toolbar-reset"
        />
      }>
      <Text variant="label" color="textSecondary" style={{ marginBottom: 4 }}>
        {t('browserStartup.toolbarShown')}
      </Text>
      {shown.map((id, index) => (
        <Box key={id}>
          {index > 0 ? <Divider /> : null}
          {row(
            TOOLBAR_BUTTON_META[id].icon,
            name(id),
            <>
              <IconButton
                icon="arrow-up"
                variant="ghost"
                size="large"
                accessibilityLabel={t('browserStartup.toolbarMoveUp', { name: name(id) })}
                disabled={index === 0}
                onPress={() => save(moveToolbarButton(shown, id, -1))}
                testID={`toolbar-sheet-up-${id}`}
              />
              <IconButton
                icon="arrow-down"
                variant="ghost"
                size="large"
                accessibilityLabel={t('browserStartup.toolbarMoveDown', { name: name(id) })}
                disabled={index === shown.length - 1}
                onPress={() => save(moveToolbarButton(shown, id, 1))}
                testID={`toolbar-sheet-down-${id}`}
              />
              <IconButton
                icon="minus-circle-outline"
                variant="ghost"
                size="large"
                accessibilityLabel={t('browserStartup.toolbarRemove', { name: name(id) })}
                onPress={() => {
                  if (shown.length <= 1) {
                    notify(t('browserStartup.toolbarLastButton'));
                    return;
                  }
                  save(removeToolbarButton(shown, id));
                }}
                testID={`toolbar-sheet-remove-${id}`}
              />
            </>,
            `toolbar-sheet-shown-${id}`,
          )}
        </Box>
      ))}

      <Text variant="label" color="textSecondary" style={{ marginTop: 16, marginBottom: 4 }}>
        {t('browserStartup.toolbarLocked')}
      </Text>
      {row('tab', t('browserStartup.nameTabs'), <Icon name="lock-outline" size={20} color="secondary" />)}
      <Divider />
      {row('dots-vertical', t('browserStartup.nameMenu'), <Icon name="lock-outline" size={20} color="secondary" />)}

      {available.length > 0 ? (
        <>
          <Text variant="label" color="textSecondary" style={{ marginTop: 16, marginBottom: 4 }}>
            {t('browserStartup.toolbarAvailable')}
          </Text>
          {full ? (
            <Text variant="caption" color="textSecondary" style={{ marginBottom: 4 }}>
              {t('browserStartup.toolbarFull', { count: MAX_TOOLBAR_BUTTONS })}
            </Text>
          ) : null}
          {available.map((id, index) => (
            <Box key={id}>
              {index > 0 ? <Divider /> : null}
              {row(
                TOOLBAR_BUTTON_META[id].icon,
                name(id),
                <IconButton
                  icon="plus-circle-outline"
                  variant="ghost"
                size="large"
                  accessibilityLabel={t('browserStartup.toolbarAdd', { name: name(id) })}
                  disabled={full}
                  onPress={() => save(addToolbarButton(shown, id))}
                  testID={`toolbar-sheet-add-${id}`}
                />,
                `toolbar-sheet-available-${id}`,
              )}
            </Box>
          ))}
        </>
      ) : null}
    </SheetFrame>
  );
});
