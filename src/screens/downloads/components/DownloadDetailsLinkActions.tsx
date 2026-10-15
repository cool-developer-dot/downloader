import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { useTranslation } from '@/localization';

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

  if (!target) {
    return null;
  }

  return (
    <Box row gap={10} style={{ flexWrap: 'wrap' }}>
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
    </Box>
  );
});
