import { memo, useCallback } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { setBlockScreenCapture, useBlockScreenCapture } from '@/privacy/screen-capture-preference';

import { SettingsRow } from './SettingsRow';

export type BlockScreenCaptureRowProps = {
  disabled?: boolean;
  testID?: string;
};

/**
 * P11 #689 Settings → Privacy → "Block screenshots in Private" (off by default). Applies inside Private only: its
 * screens and its player of a private video. The rest of the app, and other videos, are never affected.
 */
export const BlockScreenCaptureRow = memo(function BlockScreenCaptureRow({
  disabled = false,
  testID = 'settings-privacy-block-capture',
}: BlockScreenCaptureRowProps) {
  const { t } = useTranslation();
  const on = useBlockScreenCapture();
  const onValueChange = useCallback(
    (next: boolean) => {
      if (!disabled) {
        setBlockScreenCapture(next);
      }
    },
    [disabled],
  );

  return (
    <SettingsRow
      title={t('privacyBackup.blockCapture')}
      description={t('privacyBackup.blockCaptureHint')}
      icon="cellphone-lock"
      trailing={
        <Switch
          value={on}
          onValueChange={onValueChange}
          disabled={disabled}
          accessibilityLabel={t('privacyBackup.blockCapture')}
          accessibilityHint={t('privacyBackup.blockCaptureHint')}
          testID="settings-block-capture-switch"
        />
      }
      testID={testID}
    />
  );
});
