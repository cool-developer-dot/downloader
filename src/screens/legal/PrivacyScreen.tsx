import { memo } from 'react';

import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { privacyDocument } from '@/legal';
import { useTranslation } from '@/localization';

import { LegalDocumentView } from './LegalDocumentView';

export const PrivacyScreen = memo(function PrivacyScreen() {
  const { t } = useTranslation();

  return (
    <SafeAreaScreen testID="privacy-screen" padded scrollable>
      <LegalDocumentView
        document={privacyDocument}
        accessibilityLabel={t('privacy.title')}
        testID="privacy-document"
      />
    </SafeAreaScreen>
  );
});
