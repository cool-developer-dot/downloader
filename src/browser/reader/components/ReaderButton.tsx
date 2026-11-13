import { memo } from 'react';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { useTranslation } from '@/localization';

import { readerMode, useReaderAvailable } from '../reader-mode.service';

/** B15 #161 — the address bar's reader button: only on pages that look like an article. */
export const ReaderButton = memo(function ReaderButton({ hidden }: { hidden: boolean }) {
  const { t } = useTranslation();
  const available = useReaderAvailable();
  if (hidden || !available) return null;
  return (
    <Pressable
      testID="browser-reader-button"
      onPress={() => readerMode.open()}
      accessibilityRole="button"
      accessibilityLabel={t('browserReader.buttonA11y')}
      hitSlop={4}
      style={{ width: BROWSER_TOUCH_TARGET, height: BROWSER_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="book-open-page-variant-outline" size="sm" color="secondary" />
    </Pressable>
  );
});
