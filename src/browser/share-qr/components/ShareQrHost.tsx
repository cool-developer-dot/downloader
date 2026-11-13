import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTranslation } from '@/localization';

import { qrPath } from '../qr-code';
import {
  canSaveQrToGallery,
  closeQrSheet,
  closeScanResult,
  copyScannedText,
  openScannedUrl,
  saveQrImage,
  searchScannedText,
  shareQrImage,
  useShareQrState,
} from '../share-qr.service';

/** B22 #249 / #30 — the QR code sheet and the scan result sheet, mounted once in BrowserScreen. */
export const ShareQrHost = memo(function ShareQrHost() {
  const { t, rtl } = useTranslation();
  const { qr, scan } = useShareQrState();
  const path = useMemo(() => (qr ? qrPath(qr.rows) : ''), [qr]);
  const canSave = useMemo(() => canSaveQrToGallery(), []);
  const size = qr ? qr.rows.length + 8 : 0;

  return (
    <>
      <SheetFrame
        visible={qr != null}
        title={t('browserShare.qrTitle')}
        onClose={closeQrSheet}
        testID="browser-qr-sheet"
        footer={
          <View style={{ flexDirection: rtl.rowDirection, gap: 12, flexWrap: 'wrap' }}>
            <Button title={t('browserShare.qrShare')} onPress={() => void shareQrImage()} testID="browser-qr-share" />
            {canSave ? (
              <Button
                title={t('browserShare.qrSave')}
                variant="outline"
                onPress={() => void saveQrImage()}
                testID="browser-qr-save"
              />
            ) : null}
          </View>
        }>
        {qr ? (
          <View style={{ alignItems: 'center', gap: 12 }}>
            {/* Always dark on white, whatever the theme, so every scanner reads it. */}
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('browserShare.qrA11y', { url: qr.url })}
              style={{ backgroundColor: '#FFFFFF', padding: 4, borderRadius: 8 }}>
              <Svg width={240} height={240} viewBox={`0 0 ${size} ${size}`}>
                <Rect x={0} y={0} width={size} height={size} fill="#FFFFFF" />
                <Path d={path} fill="#000000" />
              </Svg>
            </View>
            <Text variant="caption" color="textSecondary" numberOfLines={3} style={{ writingDirection: 'ltr' }}>
              {qr.url}
            </Text>
          </View>
        ) : null}
      </SheetFrame>
      <SheetFrame
        visible={scan != null}
        title={
          scan?.kind === 'url' ? t('browserShare.scanOpenTitle', { host: scan.host }) : t('browserShare.scanText')
        }
        onClose={closeScanResult}
        testID="browser-scan-result"
        footer={
          scan ? (
            <View style={{ flexDirection: rtl.rowDirection, gap: 12, flexWrap: 'wrap' }}>
              {scan.kind === 'url' ? (
                <Button title={t('browserShare.scanOpen')} onPress={() => openScannedUrl(scan.url)} testID="browser-scan-open" />
              ) : null}
              {scan.kind === 'text' ? (
                <Button
                  title={t('browserShare.scanSearch')}
                  onPress={() => searchScannedText(scan.text)}
                  testID="browser-scan-search"
                />
              ) : null}
              {scan.kind !== 'empty' ? (
                <Button
                  title={t('browserShare.scanCopy')}
                  variant="outline"
                  onPress={() => void copyScannedText(scan.kind === 'url' ? scan.url : scan.text)}
                  testID="browser-scan-copy"
                />
              ) : null}
            </View>
          ) : undefined
        }>
        {scan && scan.kind !== 'empty' ? (
          <View style={{ gap: 8 }}>
            {scan.kind === 'unsafe' ? (
              <Text variant="bodySmall" color="warning" style={{ textAlign: rtl.textAlign }}>
                {t('browserShare.scanUnsafe')}
              </Text>
            ) : null}
            <Text variant="body" selectable style={{ writingDirection: scan.kind === 'url' ? 'ltr' : undefined }}>
              {scan.kind === 'url' ? scan.url : scan.text}
            </Text>
          </View>
        ) : null}
      </SheetFrame>
    </>
  );
});
