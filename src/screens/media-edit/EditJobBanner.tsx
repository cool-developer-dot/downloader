import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTranslation } from '@/localization';
import { getEditJob, useEditJobStore } from '@/media-edit/edit-job-store';
import { formatUsagePercent } from '@/storage-manager/utils/format-bytes';

export type EditJobBannerProps = {
  /** Only the edit of this item is shown (the app runs one edit at a time). */
  sourceId: string;
  testID?: string;
};

/** The running edit of an item: its progress and Cancel. Nothing when no edit of this item runs. */
export const EditJobBanner = memo(function EditJobBanner({ sourceId, testID = 'edit-job' }: EditJobBannerProps) {
  const { t } = useTranslation();
  const job = useEditJobStore((s) => s.job);
  if ((job.phase !== 'running' && job.phase !== 'cancelling') || job.sourceId !== sourceId) {
    return null;
  }
  const percent = job.phase === 'running' ? formatUsagePercent(job.progress) : null;
  return (
    <Box gap={6} py={8} testID={testID}>
      <Text variant="bodySmall" accessibilityLiveRegion="polite">
        {job.phase === 'cancelling'
          ? t('mediaEdit.cancelling')
          : percent
            ? t('mediaEdit.running', { percent })
            : t('mediaEdit.runningPlain')}
      </Text>
      <Text variant="caption" color="textSecondary">
        {t('mediaEdit.backgroundNote')}
      </Text>
      <Box row rtlRow>
        <Button
          title={t('mediaEdit.cancel')}
          variant="outline"
          size="small"
          onPress={() => getEditJob()?.cancel()}
          disabled={job.phase === 'cancelling'}
          testID={`${testID}-cancel`}
        />
      </Box>
    </Box>
  );
});
