import { memo, useCallback, useEffect, useRef, useState } from 'react';
import * as ReactNative from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Switch } from '@/components/inputs/Switch';
import { handleSaveLocationAccessLost } from '@/downloads/v2/ensure-save-location';
import { useSaveLocationStore } from '@/downloads/v2/save-location-store';
import { getTreeExportPort, pickTreeFolder } from '@/downloads/v2/tree-export-port';
import { useTranslation } from '@/localization';

import { SettingsRow, SettingsSection, SettingsStaggerItem } from '../components';

export type SaveLocationSettingsSectionProps = {
  index: number;
  disabled?: boolean;
};

function announce(message: string): void {
  if (ReactNative.Platform.OS === 'android') {
    ReactNative.ToastAndroid.show(message, ReactNative.ToastAndroid.SHORT);
  }
  ReactNative.AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Download Settings → Save location: "Also save a copy to…" (#297, #465) with the folder picker (an SD card folder
 * works too, #395) and the per-type / per-site subfolders (#382-#384). Everything is off by default; downloads are
 * then saved exactly as before. Hidden on builds without the native copy functions.
 */
export const SaveLocationSettingsSection = memo(function SaveLocationSettingsSection({
  index,
  disabled,
}: SaveLocationSettingsSectionProps) {
  const { t } = useTranslation();
  const port = getTreeExportPort();
  const enabled = useSaveLocationStore((s) => s.enabled);
  const treeUri = useSaveLocationStore((s) => s.treeUri);
  const folderName = useSaveLocationStore((s) => s.folderName);
  const byType = useSaveLocationStore((s) => s.byType);
  const bySite = useSaveLocationStore((s) => s.bySite);
  const accessLost = useSaveLocationStore((s) => s.accessLost);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  // A grant revoked while VidoraX was away is noticed when the settings open, not only at the next copy.
  useEffect(() => {
    if (!port || !treeUri) {
      return undefined;
    }
    let live = true;
    port
      .hasFolderAccess(treeUri)
      .then((ok) => {
        if (live && !ok && useSaveLocationStore.getState().treeUri === treeUri) {
          handleSaveLocationAccessLost();
        }
      })
      .catch(() => {
        // Checked again at the next copy.
      });
    return () => {
      live = false;
    };
  }, [port, treeUri]);

  const pick = useCallback(async () => {
    if (!port || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const picked = await pickTreeFolder();
      if (!picked) {
        return;
      }
      if (!(await port.hasFolderAccess(picked).catch(() => false))) {
        announce(t('saveLocation.pickFailed'));
        return;
      }
      const name = await port.getFolderName(picked).catch(() => null);
      const previous = useSaveLocationStore.getState().treeUri;
      useSaveLocationStore.getState().dispatch({ type: 'picked', treeUri: picked, folderName: name, now: Date.now() });
      if (previous && previous !== picked) {
        void port.releaseFolderAccess(previous).catch(() => undefined);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [port, t]);

  const onToggle = useCallback(
    (value: boolean) => {
      if (!value) {
        useSaveLocationStore.getState().dispatch({ type: 'set-enabled', enabled: false, now: Date.now() });
        return;
      }
      if (useSaveLocationStore.getState().treeUri) {
        useSaveLocationStore.getState().dispatch({ type: 'set-enabled', enabled: true, now: Date.now() });
      } else {
        // Turning on starts with the folder: nothing is enabled until one is picked.
        void pick();
      }
    },
    [pick],
  );

  const remove = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    const uri = useSaveLocationStore.getState().treeUri;
    useSaveLocationStore.getState().dispatch({ type: 'remove' });
    if (uri && port) {
      void port.releaseFolderAccess(uri).catch(() => undefined);
    }
  }, [port]);

  if (!port) {
    return null;
  }

  const controlsDisabled = Boolean(disabled) || busy;
  const folderLabel = folderName ?? t('saveLocation.noFolder');

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-save-location"
        title={t('saveLocation.section')}
        description={t('saveLocation.sectionDescription')}
        icon="folder-download-outline">
        <SettingsRow
          title={t('saveLocation.alsoSave')}
          description={t('saveLocation.alsoSaveHint')}
          icon="content-copy"
          trailing={
            <Switch
              value={enabled}
              onValueChange={onToggle}
              disabled={controlsDisabled}
              accessibilityLabel={t('saveLocation.alsoSave')}
              accessibilityHint={t('saveLocation.alsoSaveHint')}
              testID="download-settings-save-location-switch"
            />
          }
          accessibilityHint={t('saveLocation.alsoSaveHint')}
          testID="download-settings-save-location-enabled"
        />
        {accessLost ? (
          <Box py={8} gap={6}>
            <Text variant="bodySmall" color="warning" accessibilityRole="alert">
              {t('saveLocation.accessLost')}
            </Text>
            <Box row rtlRow>
              <Button
                title={t('common.ok')}
                variant="ghost"
                size="small"
                onPress={() => useSaveLocationStore.getState().dispatch({ type: 'dismiss-access-lost' })}
                testID="download-settings-save-location-dismiss"
              />
            </Box>
          </Box>
        ) : null}
        <SettingsRow
          title={t('saveLocation.folder')}
          description={folderLabel}
          icon="folder-outline"
          showDivider={false}
          testID="download-settings-save-location-folder"
        />
        <Box row rtlRow gap={8} pb={8} style={{ flexWrap: 'wrap' }}>
          <Button
            title={treeUri ? t('saveLocation.change') : t('saveLocation.chooseFolder')}
            variant="outline"
            size="small"
            onPress={() => {
              void pick();
            }}
            loading={busy}
            disabled={controlsDisabled}
            accessibilityHint={t('saveLocation.changeA11y')}
            testID="download-settings-save-location-change"
          />
          {treeUri ? (
            <Button
              title={t('saveLocation.remove')}
              variant="ghost"
              size="small"
              onPress={remove}
              disabled={controlsDisabled}
              accessibilityHint={t('saveLocation.removeA11y', { folder: folderLabel })}
              testID="download-settings-save-location-remove"
            />
          ) : null}
        </Box>
        <Text variant="caption" color="textSecondary" style={{ paddingBottom: 8 }}>
          {t('saveLocation.sdCardHint')}
        </Text>
        {enabled ? (
          <>
            <SettingsRow
              title={t('saveLocation.byType')}
              description={t('saveLocation.byTypeHint')}
              icon="folder-multiple-outline"
              trailing={
                <Switch
                  value={byType}
                  onValueChange={(value) => useSaveLocationStore.getState().dispatch({ type: 'set-by-type', value })}
                  disabled={controlsDisabled}
                  accessibilityLabel={t('saveLocation.byType')}
                  accessibilityHint={t('saveLocation.byTypeHint')}
                  testID="download-settings-save-location-by-type"
                />
              }
              accessibilityHint={t('saveLocation.byTypeHint')}
            />
            <SettingsRow
              title={t('saveLocation.bySite')}
              description={t('saveLocation.bySiteHint')}
              icon="web"
              trailing={
                <Switch
                  value={bySite}
                  onValueChange={(value) => useSaveLocationStore.getState().dispatch({ type: 'set-by-site', value })}
                  disabled={controlsDisabled}
                  accessibilityLabel={t('saveLocation.bySite')}
                  accessibilityHint={t('saveLocation.bySiteHint')}
                  testID="download-settings-save-location-by-site"
                />
              }
              showDivider={false}
              accessibilityHint={t('saveLocation.bySiteHint')}
            />
          </>
        ) : null}
        <Text variant="caption" color="textSecondary" style={{ paddingVertical: 8 }}>
          {t('saveLocation.keepNote')}
        </Text>
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
