import { memo } from 'react';

import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { termsDocument } from '@/legal';
import { useTranslation } from '@/localization';

import { LegalDocumentView } from './LegalDocumentView';

export const TermsScreen = memo(function TermsScreen() {
  const { t } = useTranslation();

  return (
    <SafeAreaScreen testID="terms-screen" padded scrollable>
      <LegalDocumentView
        document={termsDocument}
        accessibilityLabel={t('terms.title')}
        testID="terms-document"
      />
    </SafeAreaScreen>
  );
});
