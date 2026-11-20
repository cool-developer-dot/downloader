import { memo, useCallback, useEffect, useState } from 'react';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { cancelFolderImport, canImportFromFolder, folderImportProgress, importVideosFromFolder } from '@/downloads/cloud/cloud-port';
import { useTranslation } from '@/localization';

import { SettingsRow, SettingsSection, SettingsStaggerItem } from '../components';

const PROGRESS_POLL_MS = 1_000;

/**
 * Download Settings → Cloud and other phones: #507 Cloud folder import (a cloud app's folder or a phone folder), and
 * where auto upload (#513) lives. Everything goes through the phone's own cloud apps; VidoraX has no server.
 */
export const CloudSettingsSection = memo(function CloudSettingsSection({ index, disabled }: { index: number; disabled?: boolean }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ReturnType<typeof folderImportProgress>>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setProgress(folderImportProgress()), PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  const runImport = useCallback(async () => {
    setMessage(null);
    setProgress(null);
    setRunning(true);
    const result = await importVideosFromFolder();
    setRunning(false);
    if (result.status === 'cancelled') return;
    if (result.status === 'failed') {
      setMessage(t('cloud.importFailed'));
    } else if (result.found === 0) {
      setMessage(t('cloud.importNone'));
    } else {
      setMessage(t('cloud.importDone', { imported: result.imported, duplicates: result.duplicates, failed: result.failed }));
    }
  }, [t]);

  if (!canImportFromFolder()) return null;
  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection testID="download-settings-cloud" title={t('cloud.section')} description={t('cloud.sectionDescription')} icon="cloud-sync-outline">
        <SettingsRow
          title={t('cloud.importFolder')}
          description={t('cloud.importFolderHint')}
          icon="folder-download-outline"
          onPress={!running && !disabled ? () => void runImport() : undefined}
          showDivider={false}
          testID="download-settings-cloud-import"
        />
        {running ? (
          <>
            <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite" style={{ paddingVertical: 4 }}>
              {t('cloud.importing', { done: progress?.done ?? 0, found: progress?.found ?? 0 })}
            </Text>
            <Button title={t('cloud.importStop')} variant="ghost" size="small" leftIcon="stop" onPress={cancelFolderImport} testID="download-settings-cloud-import-stop" />
          </>
        ) : null}
        {message ? (
          <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite" style={{ paddingVertical: 4 }}>
            {message}
          </Text>
        ) : null}
        <Text variant="caption" color="textSecondary" style={{ paddingVertical: 8 }}>
          {t('cloud.driveNote')} {t('cloud.autoUploadHint')}
        </Text>
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
