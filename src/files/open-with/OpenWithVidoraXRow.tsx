import { memo, useCallback } from 'react';
import { Linking } from 'react-native';

import { DsRow } from '@/design';
import { useTranslation } from '@/localization';

/**
 * F16 (#873 Default app, #947 File associations): the File manager settings row "Open videos with VidoraX".
 * VidoraX already offers itself for every video and audio file (the manifest's VIEW filters), but Android lets
 * only the user pick a default app, so this row opens VidoraX's app info, where "Open by default" lives.
 * Drop it into Hamza's File manager settings (F2) — the agreed one-row exception.
 */
export const OpenWithVidoraXRow = memo(function OpenWithVidoraXRow({ testID = 'files-open-with-vidorax' }: { testID?: string }) {
  const { t } = useTranslation();
  const open = useCallback(() => {
    void Linking.openSettings().catch(() => undefined);
  }, []);
  return (
    <DsRow
      icon="circle-play"
      title={t('filesCore.openWithTitle')}
      subtitle={t('filesCore.openWithSub')}
      onPress={open}
      accessibilityHint={t('filesCore.openWithHint')}
      testID={testID}
    />
  );
});
