import { memo, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { fileSafetyWarning, normalizeFileSafety, type FileSafetyWarning } from '@/downloads/safety/file-safety';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

export type DownloadSafetySectionProps = { id: string; fileName?: string | null };

/**
 * Download Details → Malware Warning (P8 #461): shown only when the finished file's first bytes do not match its
 * name (a program or an archive called `.mp4`) or its name is a double extension. Checked on the device.
 */
export const DownloadSafetySection = memo(function DownloadSafetySection({ id, fileName }: DownloadSafetySectionProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const completed = useDownloadsStore((s) => s.engineRowsById[id]?.status === 'COMPLETED');
  const [warning, setWarning] = useState<FileSafetyWarning | null>(null);

  useEffect(() => {
    if (!completed || !isVidoraMediaAvailable()) {
      return undefined;
    }
    const media = getVidoraMedia();
    if (!media.checkLibraryFileSafety) {
      return undefined;
    }
    let live = true;
    media
      .checkLibraryFileSafety(id)
      .then((check) => {
        if (live) setWarning(fileSafetyWarning(normalizeFileSafety(check), 'open'));
      })
      .catch(() => {
        if (live) setWarning(null);
      });
    return () => {
      live = false;
    };
  }, [completed, id]);

  if (!warning) {
    return null;
  }
  const message = t(warning.messageKey, {
    fileName: fileName || t('dangerousFile.unnamed'),
    kind: warning.kindKey ? t(warning.kindKey) : '',
  });
  return (
    <Box
      row
      rtlRow
      gap={10}
      p={14}
      borderRadius="md"
      accessibilityRole="alert"
      accessibilityLabel={`${t(warning.titleKey)}. ${message}`}
      testID="download-details-malware-warning"
      style={{
        alignItems: 'flex-start',
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: theme.colors.error,
      }}>
      <Icon name="shield-alert-outline" size={22} color="error" />
      <Box flex={1} gap={4} importantForAccessibility="no-hide-descendants">
        <Text variant="label" color="error">
          {t(warning.titleKey)}
        </Text>
        <Text variant="caption" color="textSecondary">
          {message}
        </Text>
      </Box>
    </Box>
  );
});
