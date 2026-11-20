import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { useTranslation } from '@/localization';
import { isRemoteControlAvailable, sendToComputer } from '@/remote/remote-control';
import { useDownloadsStore } from '@/store/downloads';

import { useDownloadLinkActions, useDownloadLinkTarget } from '../hooks/useDownloadLinkActions';

export type DownloadDetailsLinkActionsProps = {
  id: string;
  disabled?: boolean;
};

/**
 * Download Details: Re-download and Copy link, below the existing actions. Renders nothing unless the row is a
 * finished, failed or cancelled v2 download with a source page.
 */
export const DownloadDetailsLinkActions = memo(function DownloadDetailsLinkActions({
  id,
  disabled,
}: DownloadDetailsLinkActionsProps) {
  const { t } = useTranslation();
  const target = useDownloadLinkTarget(id);
  const { redownload, copyLink } = useDownloadLinkActions();
  const title = useDownloadsStore((state) => state.itemsById[id]?.title);

  const handleRedownload = useCallback(() => {
    if (target) {
      redownload(target);
    }
  }, [redownload, target]);

  const handleCopy = useCallback(() => {
    if (target) {
      void copyLink(target);
    }
  }, [copyLink, target]);

  const handleSend = useCallback(() => {
    if (target) {
      void sendToComputer({ url: target.copyUrl, title: title || target.copyUrl, downloadId: id });
    }
  }, [id, target, title]);

  if (!target) {
    return null;
  }

  return (
    <Box row rtlRow gap={10} style={{ flexWrap: 'wrap' }}>
      {target.pageUrl ? (
        <Box flex={1} style={{ minWidth: 120 }}>
          <Button
            title={t('downloadLinks.redownload')}
            variant="outline"
            onPress={handleRedownload}
            disabled={disabled}
            fullWidth
            accessibilityHint={t('downloadLinks.redownloadHint')}
            testID="download-details-redownload"
          />
        </Box>
      ) : null}
      <Box flex={1} style={{ minWidth: 120 }}>
        <Button
          title={t('downloadLinks.copyLink')}
          variant="outline"
          onPress={handleCopy}
          disabled={disabled}
          fullWidth
          accessibilityHint={t('downloadLinks.copyLinkHint')}
          testID="download-details-copy-link"
        />
      </Box>
      {isRemoteControlAvailable() ? (
        <Box flex={1} style={{ minWidth: 120 }}>
          <Button
            title={t('remoteControl.sendToComputer')}
            variant="outline"
            onPress={handleSend}
            disabled={disabled}
            fullWidth
            accessibilityHint={t('remoteControl.sendToComputerHint')}
            testID="download-details-send-to-computer"
          />
        </Box>
      ) : null}
    </Box>
  );
});
