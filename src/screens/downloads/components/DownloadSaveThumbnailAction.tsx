import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { useTranslation } from '@/localization';

import { useCanSaveThumbnail, useSaveThumbnail } from '../hooks/useSaveThumbnail';

/** Download Details: "Save thumbnail" for a finished v2 video that has one. Renders nothing otherwise. */
export const DownloadSaveThumbnailAction = memo(function DownloadSaveThumbnailAction({ id }: { id: string }) {
  const { t } = useTranslation();
  const visible = useCanSaveThumbnail(id);
  const save = useSaveThumbnail();
  const [saving, setSaving] = useState(false);

  const onPress = useCallback(() => {
    setSaving(true);
    void save(id).finally(() => setSaving(false));
  }, [id, save]);

  if (!visible) {
    return null;
  }
  return (
    <Box>
      <Button
        title={t('thumbnailSave.action')}
        variant="outline"
        leftIcon="image-outline"
        onPress={onPress}
        loading={saving}
        disabled={saving}
        fullWidth
        accessibilityHint={t('thumbnailSave.actionHint')}
        testID="download-details-save-thumbnail"
      />
    </Box>
  );
});
