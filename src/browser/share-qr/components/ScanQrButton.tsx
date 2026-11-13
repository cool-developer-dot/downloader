import { memo } from 'react';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';

import { scanQrCode } from '../share-qr.service';

/**
 * B22 #30 — "Scan QR code": an icon in the empty address bar (`compact`) and a labelled button on the start page.
 */
export const ScanQrButton = memo(function ScanQrButton({
  compact = false,
  visible = true,
  testID = 'browser-scan-qr',
}: {
  compact?: boolean;
  visible?: boolean;
  testID?: string;
}) {
  const { t, rtl } = useTranslation();
  if (!visible) return null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('browserShare.scanA11y')}
      onPress={() => void scanQrCode()}
      style={{
        minHeight: 48,
        minWidth: 48,
        flexDirection: rtl.rowDirection,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        ...(compact ? {} : { alignSelf: 'flex-start', paddingHorizontal: 4 }),
      }}>
      <Icon name="qrcode-scan" size={compact ? 'sm' : 22} color="secondary" />
      {compact ? null : (
        <Text variant="label" color="textSecondary">
          {t('browserShare.scan')}
        </Text>
      )}
    </Pressable>
  );
});
