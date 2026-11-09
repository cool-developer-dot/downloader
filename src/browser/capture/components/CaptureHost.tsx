import { memo, useState } from 'react';
import { Image, View } from 'react-native';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Switch } from '@/components/inputs/Switch';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTranslation } from '@/localization';

import { canSaveToPictures, closeCapture, exportCapture, useCapture } from '../capture.service';
import { cancelPdfChoice, choosePdf, usePdfChoice } from '../pdf.service';

/** B17 — the page-picture sheet (#174 / #175: Save to Pictures, Share) and the PDF open choice (#265). */
export const CaptureHost = memo(function CaptureHost() {
  return (
    <>
      <CaptureSheet />
      <PdfChoiceSheet />
    </>
  );
});

const CaptureSheet = memo(function CaptureSheet() {
  const { t, rtl } = useTranslation();
  const { capture } = useCapture();
  const canSave = canSaveToPictures();
  const ratio = capture && capture.width > 0 ? capture.height / capture.width : 1;
  return (
    <SheetFrame
      visible={capture != null}
      title={t('browserCapture.captureTitle')}
      onClose={closeCapture}
      testID="capture-sheet"
      footer={
        <View style={{ flexDirection: rtl.rowDirection, gap: 8, flexWrap: 'wrap' }}>
          {canSave ? <Button title={t('browserCapture.saveToPictures')} onPress={() => void exportCapture('save')} testID="capture-save" /> : null}
          <Button title={t('browserCapture.share')} variant={canSave ? 'outline' : 'primary'} onPress={() => void exportCapture('share')} testID="capture-share" />
        </View>
      }>
      {capture ? (
        <Image
          source={{ uri: capture.uri }}
          style={{ width: '100%', height: Math.min(360, 280 * ratio), alignSelf: 'center' }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          accessibilityLabel={t(capture.kind === 'fullPage' ? 'browserCapture.fullPage' : 'browserCapture.screenshot')}
        />
      ) : null}
    </SheetFrame>
  );
});

const PdfChoiceSheet = memo(function PdfChoiceSheet() {
  const { t, rtl } = useTranslation();
  const event = usePdfChoice();
  const [remember, setRemember] = useState(false);
  const name = event ? decodeURIComponent(event.url.split(/[?#]/)[0].split('/').pop() || 'PDF') : '';
  const pick = (choice: 'viewer' | 'download' | 'external') => {
    void choosePdf(choice, remember);
    setRemember(false);
  };
  return (
    <SheetFrame visible={event != null} title={t('browserCapture.pdfTitle')} onClose={cancelPdfChoice} testID="pdf-choice-sheet">
      <View style={{ gap: 8 }}>
        <Text variant="bodySmall" color="textSecondary" numberOfLines={2} style={{ textAlign: rtl.textAlign, writingDirection: 'ltr' }}>
          {name}
        </Text>
        <Button title={t('browserCapture.pdfOpenHere')} onPress={() => pick('viewer')} testID="pdf-choice-viewer" />
        <Button title={t('browserCapture.pdfDownload')} variant="outline" onPress={() => pick('download')} testID="pdf-choice-download" />
        <Button title={t('browserCapture.pdfOpenWith')} variant="outline" onPress={() => pick('external')} testID="pdf-choice-external" />
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 48, gap: 8 }}>
          <Text variant="body" style={{ flex: 1, textAlign: rtl.textAlign }}>
            {t('browserCapture.pdfRemember')}
          </Text>
          <Switch value={remember} onValueChange={setRemember} accessibilityLabel={t('browserCapture.pdfRemember')} testID="pdf-choice-remember" />
        </View>
      </View>
    </SheetFrame>
  );
});
